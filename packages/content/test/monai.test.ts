import { createRng, getPlayer, seedRng, type GameEvent } from '@nh/core';
import { describe, expect, test } from 'vitest';
import { mcalcmove } from '../src/monmove';
import { addMon, posOf, setup } from './helpers';

const room = (w: number, extra: string[] = []) => [
  '-'.repeat(w + 2),
  `|@${'.'.repeat(w)}|`,
  ...extra,
  '-'.repeat(w + 2),
];

function run(t: ReturnType<typeof setup>, n: number): GameEvent[] {
  const ev: GameEvent[] = [];
  for (let i = 0; i < n && !t.state.gameOver; i++) ev.push(...t.wait().events);
  return ev;
}

describe('mcalcmove', () => {
  test('multiples of 12, mean equals speed, speed 12 constant', () => {
    const rng = createRng(seedRng(7));
    for (const speed of [3, 6, 9, 12, 15, 18, 22]) {
      let sum = 0;
      const N = 20000;
      for (let i = 0; i < N; i++) {
        const m = mcalcmove(rng, speed);
        expect(m % 12).toBe(0);
        if (speed === 12) expect(m).toBe(12);
        sum += m;
      }
      expect(Math.abs(sum / N - speed)).toBeLessThan(0.3);
    }
  });
});

describe('monster brain', () => {
  test('hostile jackal approaches and attacks', () => {
    const t = setup(room(12));
    addMon(t.state, 'nh:jackal', 12, 1);
    const ev = run(t, 15);
    expect(ev.some((e) => e.type === 'msg' && e.key.startsWith('combat.mon_'))).toBe(true);
  });

  test('sleeping monster far away stays put', () => {
    const t = setup(room(30));
    const id = addMon(t.state, 'nh:jackal', 30, 1, { asleep: true });
    run(t, 20);
    expect(posOf(t.state, id)).toEqual({ x: 30, y: 1 });
    expect(t.state.entities[String(id)]?.c.monster?.asleep).toBe(true);
  });

  test('disturb wakes a sleeping dog when the hero is near and not stealthy', () => {
    const t = setup(room(12));
    const id = addMon(t.state, 'nh:jackal', 6, 1, { asleep: true });
    run(t, 3);
    expect(t.state.entities[String(id)]?.c.monster?.asleep).toBe(false);
  });

  test('a stealthy hero (XL3) does not wake sleepers', () => {
    const t = setup(room(12));
    const xp = getPlayer(t.state).c.experience;
    if (xp) xp.level = 3;
    const id = addMon(t.state, 'nh:jackal', 6, 1, { asleep: true });
    run(t, 10);
    expect(t.state.entities[String(id)]?.c.monster?.asleep).toBe(true);
  });

  test('peaceful monsters never attack', () => {
    const t = setup(room(6));
    addMon(t.state, 'nh:jackal', 3, 1, { peaceful: true });
    const ev = run(t, 40);
    expect(ev.some((e) => e.type === 'msg' && e.key.startsWith('combat.mon_'))).toBe(false);
  });

  test('newt cannot open a closed door, kobold can', () => {
    const rows = ['-----', '|@.+.|', '-----'];
    const a = setup(rows);
    const newt = addMon(a.state, 'nh:newt', 4, 1);
    run(a, 30);
    expect(posOf(a.state, newt).x).toBe(4);
    const b = setup(['------', '|@..+.|', '------']);
    const kobold = addMon(b.state, 'nh:kobold', 5, 1);
    const ev = run(b, 10);
    expect(ev.some((e) => e.type === 'doorOpened')).toBe(true);
    expect(posOf(b.state, kobold).x).toBeLessThan(4);
  });

  test('never steps diagonally through a doorway with a door, never into walls or entities', () => {
    // open door at (3,2): monster at (4,3) below-right must not cut the corner
    const t = setup(['-----', '|.@.|', '--+--', '|...|', '-----']);
    const ids = [addMon(t.state, 'nh:kobold', 1, 3), addMon(t.state, 'nh:kobold', 3, 3)];
    for (let i = 0; i < 30 && !t.state.gameOver; i++) {
      const before = ids.map((id) => posOf(t.state, id));
      t.wait();
      ids.forEach((id, k) => {
        const a = before[k] as { x: number; y: number };
        const b = posOf(t.state, id);
        const idx = b.y * t.level.width + b.x;
        const terr = t.level.palette[t.level.cells[idx] ?? 0];
        expect(terr === 'nh:stone' || terr === 'nh:hwall' || terr === 'nh:vwall').toBe(false);
        if (a.x !== b.x && a.y !== b.y) {
          const wasDoor = a.x === 2 && a.y === 2;
          const toDoor = b.x === 2 && b.y === 2;
          expect(wasDoor || toDoor).toBe(false);
        }
      });
      const p = ids.map((id) => JSON.stringify(posOf(t.state, id)));
      expect(new Set(p).size).toBe(ids.length);
      expect(p).not.toContain(JSON.stringify(posOf(t.state, t.state.playerId)));
    }
  });

  test('bats move erratically', () => {
    let toward = 0;
    let total = 0;
    for (let s = 1; s <= 30; s++) {
      const t = setup(room(30), s);
      const id = addMon(t.state, 'nh:bat', 30, 1, { energy: 0 });
      // make the bat permanently hostile and keep the hero far away
      let prev = posOf(t.state, id);
      for (let i = 0; i < 6; i++) {
        t.wait();
        const p = posOf(t.state, id);
        if (p.x !== prev.x || p.y !== prev.y) {
          total++;
          if (p.x < prev.x) toward++;
        }
        prev = p;
      }
    }
    expect(total).toBeGreaterThan(50);
    expect(toward / total).toBeLessThan(0.95);
    expect(toward / total).toBeGreaterThan(0.4);
  });
});
