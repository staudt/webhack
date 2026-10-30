import { describe, expect, test } from 'vitest';
import { createEngine } from '../src/engine';
import { isJsonPlain } from '../src/hash';
import { createRng, newRngStates } from '../src/rng';
import { SAVE_VERSION } from '../src/save';
import { getLevel, getPlayer } from '../src/state';
import { applyUpdate, buildSnapshot, diffSnapshot } from '../src/view';
import { computeVisible } from '../src/vision';
import { PAL, VANILLA_TERRAIN, generateLevel } from '../src/levelgen/index';
import type { Mod, MonsterDef } from '../src/types/mod';
import type { GameState } from '../src/types/state';
import { RULES, asciiLevel, idx } from './helpers/asciiLevel';
import { actionsMod, terrainMod } from './helpers/fakeMods';
import { objectsMod } from './helpers/objectMods';

describe('locked door generation', () => {
  const gen = (seed: number, depth: number) =>
    generateLevel(createRng(newRngStates(seed).core), {
      id: 'g',
      depth,
      width: 80,
      height: 21,
      terrain: VANILLA_TERRAIN,
    });

  test('about 1/3 * 4/5 * 1/6 of doors are locked (ref: mklev.c dosdoor)', () => {
    // Depth 1 has no secret doors, so every door is a visible one.
    let doors = 0;
    let locked = 0;
    for (let seed = 1; seed <= 300; seed++) {
      for (const c of gen(seed, 1).cells) {
        if (c === PAL.door_locked) locked++;
        if (
          c === PAL.door_locked ||
          c === PAL.door_closed ||
          c === PAL.door_open_v ||
          c === PAL.door_open_h ||
          c === PAL.doorway
        )
          doors++;
      }
    }
    expect(doors).toBeGreaterThan(1500);
    const expected = (1 / 3) * (4 / 5) * (1 / 6); // 2/45, about 4.4%
    expect(locked / doors).toBeGreaterThan(expected * 0.7);
    expect(locked / doors).toBeLessThan(expected * 1.3);
  });

  test('secret doors are locked 1 time in 5 below depth 2', () => {
    let secret = 0;
    let lockedSecret = 0;
    for (let seed = 1; seed <= 300; seed++) {
      for (const c of gen(seed, 5).cells) {
        if (c === PAL.sdoor_v || c === PAL.sdoor_h) secret++;
        if (c === PAL.sdoor_locked_v || c === PAL.sdoor_locked_h) {
          secret++;
          lockedSecret++;
        }
      }
    }
    expect(secret).toBeGreaterThan(200);
    expect(lockedSecret / secret).toBeGreaterThan(0.1);
    expect(lockedSecret / secret).toBeLessThan(0.3);
  });
});

describe('vision: the dark-corridor rule (ref: vision.c vision_recalc)', () => {
  const lit = (row: string) => [row];

  test('a lit wall at the end of a dark corridor is hidden from afar, seen when adjacent', () => {
    const l = asciiLevel(['#######|'], lit('       L'));
    const far = computeVisible(l, RULES, { x: 0, y: 0 });
    expect(far).not.toContain(idx(l, 7, 0));
    const near = computeVisible(l, RULES, { x: 6, y: 0 });
    expect(near).toContain(idx(l, 7, 0));
  });

  test('adjacent walls are always seen, lit or not', () => {
    for (const litRow of ['        ', 'LLLLLLLL']) {
      const l = asciiLevel(['#######|'], lit(litRow));
      expect(computeVisible(l, RULES, { x: 6, y: 0 })).toContain(idx(l, 7, 0));
    }
  });

  test('a lit wall whose neighbor toward the hero is lit is seen from afar', () => {
    const l = asciiLevel(['#d....|'], lit(' LLLLLL'));
    const v = computeVisible(l, RULES, { x: 0, y: 0 });
    expect(v).toContain(idx(l, 6, 0));
    expect(v).toContain(idx(l, 3, 0));
  });

  test('a lit closed or locked door follows the same rule', () => {
    for (const door of ['+', 'X']) {
      const l = asciiLevel([`###${door}`], lit('   L'));
      expect(computeVisible(l, RULES, { x: 0, y: 0 })).not.toContain(idx(l, 3, 0));
      expect(computeVisible(l, RULES, { x: 2, y: 0 })).toContain(idx(l, 3, 0));
    }
  });

  test('the rule looks diagonally toward the hero', () => {
    // wall at (5,2); hero at (0,0); the cell one step toward her is (4,1)
    const rows = ['######', '######', '#####|'];
    const hidden = asciiLevel(rows, ['      ', '      ', '     L']);
    expect(computeVisible(hidden, RULES, { x: 0, y: 0 })).not.toContain(idx(hidden, 5, 2));
    const shown = asciiLevel(rows, ['      ', '    L ', '     L']);
    expect(computeVisible(shown, RULES, { x: 0, y: 0 })).toContain(idx(shown, 5, 2));
  });
});

const mmMod: Mod = {
  id: 'mm',
  version: '1.0.0',
  register(api) {
    api.defineBrain({ id: 'mm:idle', act: () => undefined });
    const def: MonsterDef = {
      id: 'mm:mon',
      nameKey: 'mon.mon',
      glyph: { ch: 'x', fg: '#f00' },
      level: 1,
      speed: 12,
      ac: 7,
      mr: 0,
      alignment: 0,
      attacks: [],
      size: 'small',
      flags: [],
      frequency: 1,
      group: null,
      genFlags: [],
      difficulty: 1,
      resists: [],
      conveys: [],
      weight: 100,
      nutrition: 100,
      brain: 'mm:idle',
    };
    api.defineMonster(def);
  },
};

const engine = createEngine([terrainMod(), actionsMod(), objectsMod(), mmMod]);
const fresh = (): GameState => engine.newGame({ seed: 5, width: 40, height: 15 }).state;
const WAIT = { type: 'wait' } as const;
const at = (s: GameState, p: { x: number; y: number }): number => p.y * getLevel(s).width + p.x;

function addMonster(s: GameState, p: { x: number; y: number }): number {
  const id = s.nextEntityId++;
  s.entities[String(id)] = {
    id,
    def: 'mm:mon',
    c: {
      pos: { level: s.currentLevel, x: p.x, y: p.y },
      monster: { level: 1, peaceful: false, asleep: true, lastHero: null },
    },
  };
  return id;
}

/** Puts the hero somewhere she can't see `target` from, then lets vision refresh. */
function moveAway(s: GameState, target: { x: number; y: number }): { x: number; y: number } {
  const hero = getPlayer(s).c.pos!;
  const home = { x: hero.x, y: hero.y };
  for (const r of getLevel(s).rooms) {
    for (const [x, y] of [
      [r.lx, r.ly],
      [r.hx, r.hy],
    ] as const) {
      hero.x = x;
      hero.y = y;
      engine.step(s, WAIT);
      if (!s.visible.includes(at(s, target))) return home;
    }
  }
  throw new Error('no hidden spot');
}

describe('monster memory', () => {
  test('a seen monster is remembered as m once the hero looks away', () => {
    const s = fresh();
    const hero = getPlayer(s).c.pos!;
    const p = { x: hero.x, y: hero.y };
    const id = addMonster(s, p);
    engine.step(s, WAIT);
    expect(s.monsterMemory[s.currentLevel]?.[String(at(s, p))]).toBe('mm:mon');
    // live and visible: an entity, never an m
    let v = buildSnapshot(engine.registry, s);
    expect(v.entities.some((e) => e.id === id)).toBe(true);
    expect(v.cells[at(s, p)]?.m).toBeUndefined();

    moveAway(s, p);
    v = buildSnapshot(engine.registry, s);
    expect(v.cells[at(s, p)]).toMatchObject({ v: false, m: 'mm:mon' });
    expect(v.entities.some((e) => e.id === id)).toBe(false);
    expect(v.legend['mm:mon']).toBeDefined();
  });

  test('the memory stays even if the monster left while unseen, and seeing the cell empty clears it', () => {
    const s = fresh();
    const hero = getPlayer(s).c.pos!;
    const p = { x: hero.x, y: hero.y };
    const id = addMonster(s, p);
    engine.step(s, WAIT);
    moveAway(s, p);
    delete s.entities[String(id)]; // it wandered off unseen
    expect(buildSnapshot(engine.registry, s).cells[at(s, p)]?.m).toBe('mm:mon');
    // come back and look
    hero.x = p.x;
    hero.y = p.y;
    engine.step(s, WAIT);
    expect(s.monsterMemory[s.currentLevel]?.[String(at(s, p))]).toBeUndefined();
    expect(buildSnapshot(engine.registry, s).cells[at(s, p)]?.m).toBeUndefined();
  });

  test('live monsters are never duplicated as m', () => {
    const s = fresh();
    const hero = getPlayer(s).c.pos!;
    const level = getLevel(s);
    for (const r of level.rooms) addMonster(s, { x: r.lx, y: r.ly });
    addMonster(s, { x: hero.x, y: hero.y });
    for (let i = 0; i < 4; i++) {
      engine.step(s, WAIT);
      const v = buildSnapshot(engine.registry, s);
      const shown = new Set(v.entities.map((e) => e.y * getLevel(s).width + e.x));
      v.cells.forEach((c, i2) => {
        if (c.v) expect(c.m, `visible cell ${String(i2)}`).toBeUndefined();
        if (c.m !== undefined) expect(shown.has(i2)).toBe(false);
      });
      // move to the next room so memory builds up over several views
      const r = level.rooms[(i + 1) % level.rooms.length];
      if (r) {
        hero.x = r.hx;
        hero.y = r.hy;
      }
    }
  });

  test('deltas carry m changes and applying them equals a fresh snapshot', () => {
    const s = fresh();
    const hero = getPlayer(s).c.pos!;
    const p = { x: hero.x, y: hero.y };
    addMonster(s, p);
    engine.step(s, WAIT);
    const before = buildSnapshot(engine.registry, s);
    moveAway(s, p);
    const after = buildSnapshot(engine.registry, s);
    const update = diffSnapshot(before, after);
    expect(update.kind).toBe('delta');
    if (update.kind !== 'delta') return;
    const changed = update.cells.find(([i]) => i === at(s, p));
    expect(changed?.[1].m).toBe('mm:mon');
    expect(applyUpdate(before, update)).toEqual(after);
    // only the m differs on a cell that is otherwise unchanged
    const other = structuredClone(after);
    const cell = other.cells[at(s, p)];
    if (cell) delete cell.m;
    const d2 = diffSnapshot(other, after);
    expect(d2.kind === 'delta' && d2.cells.map(([i]) => i)).toEqual([at(s, p)]);
  });
});

describe('save v5', () => {
  const replay = { seed: 5, width: 40, height: 15, mods: [], actions: [] };

  test('SAVE_VERSION is 5 and state is JSON-plain with monsterMemory', () => {
    const s = fresh();
    expect(SAVE_VERSION).toBe(5);
    expect(s.version).toBe(5);
    expect(s.monsterMemory[s.currentLevel]).toEqual({});
    expect(isJsonPlain(s)).toBe(true);
  });

  test('monster memory survives a round trip', () => {
    const s = fresh();
    const hero = getPlayer(s).c.pos!;
    addMonster(s, { x: hero.x, y: hero.y });
    engine.step(s, WAIT);
    expect(Object.keys(s.monsterMemory[s.currentLevel] ?? {})).toHaveLength(1);
    expect(engine.load(engine.save(s, replay)).state).toEqual(s);
  });

  test.each([3, 4])('a v%i save migrates to v5 with occupation and monsterMemory', (old) => {
    const s = fresh();
    const raw = JSON.parse(engine.save(s, replay)) as {
      version: number;
      state: { version: number; occupation?: unknown; monsterMemory?: unknown };
    };
    raw.version = old;
    raw.state.version = old;
    delete raw.state.occupation;
    delete raw.state.monsterMemory;
    const loaded = engine.load(JSON.stringify(raw)).state;
    expect(loaded.version).toBe(5);
    expect(loaded.occupation).toBeNull();
    expect(loaded.monsterMemory).toEqual({});
  });

  test('a v4 save that already has an occupation keeps it', () => {
    const s = fresh();
    const raw = JSON.parse(engine.save(s, replay)) as {
      version: number;
      state: { version: number; occupation: unknown; monsterMemory?: unknown };
    };
    raw.version = 4;
    raw.state.version = 4;
    raw.state.occupation = { action: 'x:y', args: null };
    delete raw.state.monsterMemory;
    const loaded = engine.load(JSON.stringify(raw)).state;
    expect(loaded.occupation).toEqual({ action: 'x:y', args: null });
  });

  test('props round-trip through a save', () => {
    const s = fresh();
    const hero = getPlayer(s);
    hero.c.props = {
      cold_res: { intrinsic: true, timeout: 0 },
      stunned: { intrinsic: false, timeout: 57 },
    };
    expect(isJsonPlain(s)).toBe(true);
    const back = engine.load(engine.save(s, replay)).state;
    expect(getPlayer(back).c.props).toEqual({
      cold_res: { intrinsic: true, timeout: 0 },
      stunned: { intrinsic: false, timeout: 57 },
    });
    expect(back).toEqual(s);
  });
});

describe('prompt contract', () => {
  test('text prompts and count answers are plain data', () => {
    const prompt = {
      id: 'p',
      kind: 'text',
      key: 'name.what',
      maxLength: 20,
    } as const;
    const menu = {
      id: 'm',
      kind: 'menu',
      key: 'drop.what',
      multi: true,
      options: [{ value: 1, key: 'x', max: 5 }],
    } as const;
    expect(isJsonPlain(prompt)).toBe(true);
    expect(isJsonPlain(menu)).toBe(true);
    expect(isJsonPlain({ type: 'answer', promptId: 'm', value: [{ value: 1, count: 3 }] })).toBe(
      true,
    );
  });
});
