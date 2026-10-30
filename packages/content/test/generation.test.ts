import { createEngine, getPlayer, type Ctx, type GameState } from '@nh/core';
import { describe, expect, test } from 'vitest';
import { vanillaMod } from '../src/index';
import { adjLev, makemon, monmaxDifficulty, monminDifficulty, rndmonst } from '../src/generation';
import { MONSTERS } from '../src/monsters';

/** Runs `fn` with a real Ctx by hijacking the vanilla endOfTurn hook via a probe mod. */
function withCtx<T>(seed: number, fn: (ctx: Ctx, state: GameState) => T, xl = 1): T {
  let out: { v: T } | null = null;
  const probe = {
    id: 'probe',
    version: '0',
    dependsOn: ['nh'],
    register(api: import('@nh/core').ModApi) {
      api.on(
        'endOfTurn',
        (ctx) => {
          if (out === null) out = { v: fn(ctx, ctx.state) };
        },
        { priority: -100 },
      );
    },
  };
  const engine = createEngine([vanillaMod, probe]);
  const { state } = engine.newGame({ seed });
  const xp = getPlayer(state).c.experience;
  if (xp) xp.level = xl;
  engine.step(state, { type: 'wait' });
  if (out === null) throw new Error('probe did not run');
  return (out as { v: T }).v;
}

describe('rndmonst', () => {
  for (const [depth, xl] of [
    [1, 1],
    [5, 3],
  ] as const) {
    test(`depth ${depth} XL ${xl} respects difficulty bounds`, () => {
      const lo = Math.trunc(depth / 6);
      const hi = Math.trunc((depth + xl) / 2);
      expect(monminDifficulty(depth)).toBe(lo);
      expect(monmaxDifficulty(depth, xl)).toBe(hi);
      const counts = new Map<string, number>();
      withCtx(
        3,
        (ctx) => {
          for (let i = 0; i < 4000; i++) {
            const d = rndmonst(ctx, depth);
            expect(d).not.toBeNull();
            if (!d) continue;
            expect(d.difficulty).toBeGreaterThanOrEqual(lo);
            expect(d.difficulty).toBeLessThanOrEqual(hi);
            counts.set(d.id, (counts.get(d.id) ?? 0) + 1);
          }
        },
        xl,
      );
      const eligible = MONSTERS.filter((m) => m.difficulty >= lo && m.difficulty <= hi);
      const total = eligible.reduce((a, m) => a + m.frequency, 0);
      for (const m of eligible)
        expect(Math.abs((counts.get(m.id) ?? 0) / 4000 - m.frequency / total)).toBeLessThan(0.04);
    });
  }
});

describe('makemon', () => {
  test('hp and level within bounds', () => {
    const jackal = MONSTERS.find((m) => m.id === 'nh:jackal') as (typeof MONSTERS)[number];
    const rothe = MONSTERS.find((m) => m.id === 'nh:rothe') as (typeof MONSTERS)[number];
    withCtx(5, (ctx, state) => {
      for (let i = 0; i < 100; i++) {
        const id = makemon(ctx, jackal, null, { nogroup: true });
        const e = state.entities[String(id)];
        expect(e?.c.hp?.max).toBeGreaterThanOrEqual(2);
        expect(e?.c.hp?.max).toBeLessThanOrEqual(4 + 1);
        const rid = makemon(ctx, rothe, null);
        const r = state.entities[String(rid)];
        const lv = r?.c.monster?.level ?? 0;
        expect(lv).toBe(adjLev(rothe, 1, 1));
        expect(r?.c.hp?.max).toBeGreaterThanOrEqual(lv + 1);
        expect(r?.c.hp?.max).toBeLessThanOrEqual(lv * 8 + 1);
        expect(r?.c.actor?.energy).toBe(0);
      }
    });
  });

  test('adjLev examples', () => {
    const rothe = MONSTERS.find((m) => m.id === 'nh:rothe') as (typeof MONSTERS)[number];
    expect(adjLev(rothe, 1, 1)).toBe(1); // mlevel 2 > depth 1: decrement
    expect(adjLev(rothe, 12, 1)).toBe(3); // +1 per five levels, capped at 3*2/2
  });

  test('groups spawn several adjacent jackals at higher XL', () => {
    const jackal = MONSTERS.find((m) => m.id === 'nh:jackal') as (typeof MONSTERS)[number];
    withCtx(
      9,
      (ctx, state) => {
        const xp = getPlayer(state).c.experience;
        if (xp) xp.level = 5;
        let best = 0;
        for (let i = 0; i < 40; i++) {
          const before = new Set(Object.keys(state.entities));
          const id = makemon(ctx, jackal, null, { group: true });
          const fresh = Object.keys(state.entities).filter((k) => !before.has(k));
          best = Math.max(best, fresh.length);
          const pos = state.entities[String(id)]?.c.pos;
          for (const k of fresh) {
            const p = state.entities[k]?.c.pos;
            if (p && pos)
              expect(Math.max(Math.abs(p.x - pos.x), Math.abs(p.y - pos.y))).toBeLessThanOrEqual(
                10,
              );
          }
        }
        expect(best).toBeGreaterThan(1);
      },
      5,
    );
  });

  test('random placement is never in view of the hero', () => {
    withCtx(11, (ctx, state) => {
      const vis = new Set(state.visible);
      const level = state.levels[state.currentLevel];
      if (!level) throw new Error('no level');
      for (let i = 0; i < 200; i++) {
        const id = makemon(ctx, null, null, { nogroup: true });
        const p = state.entities[String(id)]?.c.pos;
        if (!p) continue;
        expect(vis.has(p.y * level.width + p.x)).toBe(false);
      }
    });
  });
});

describe('population', () => {
  test('average monsters per new level matches one third per room', () => {
    let rooms = 0;
    let mons = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const engine = createEngine([vanillaMod]);
      const { state } = engine.newGame({ seed });
      const level = state.levels['dlvl1'];
      rooms += level?.rooms.length ?? 0;
      mons += Object.values(state.entities).filter((e) => e.c.monster).length;
    }
    expect(Math.abs(mons / rooms - 1 / 3)).toBeLessThan(0.07);
  });
});

describe('full game', () => {
  test('2000 seeded random actions without exceptions', () => {
    const engine = createEngine([vanillaMod]);
    const { state } = engine.newGame({ seed: 4 });
    for (let i = 0; i < 2000 && !state.gameOver; i++) {
      const offers = [
        ...engine.query(state).actionsFor({ kind: 'self' }),
        ...[...Array(9).keys()].flatMap((k) => {
          const p = getPlayer(state).c.pos;
          return engine.query(state).actionsFor({
            kind: 'cell',
            pos: { x: (p?.x ?? 0) + (k % 3) - 1, y: (p?.y ?? 0) + Math.trunc(k / 3) - 1 },
          });
        }),
      ].filter(
        (o) => o.action.type === 'wait' || o.action.type === 'move' || o.action.type === 'search',
      );
      const pick = offers[((i * 2654435761) % Math.max(1, offers.length)) >>> 0] ?? {
        action: { type: 'wait' as const },
      };
      if (state.pendingPrompt) break;
      engine.step(state, pick.action);
    }
    expect(true).toBe(true);
  });
});
