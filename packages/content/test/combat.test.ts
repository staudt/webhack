import {
  createEngine,
  getLevel,
  getPlayer,
  inventoryOf,
  newMemory,
  type DefId,
  type EntityId,
  type GameEvent,
  type GameState,
  type Level,
  type Mod,
  type Pos,
  type Entity,
  type ObjectDef,
} from '@nh/core';
import { describe, expect, test } from 'vitest';
import {
  MONSTERS,
  T,
  abon,
  acValue,
  dbon,
  dmgval,
  heroToHit,
  hitval,
  P_BASIC,
  P_UNSKILLED,
  P_SKILLED,
  P_EXPERT,
  weaponDamBonus,
  weaponHitBonus,
  messagesEn,
  monsterAttack,
  monsterToHit,
  vanillaMod,
} from '../src/index';

const def = (id: string) => {
  const m = MONSTERS.find((d) => d.id === id);
  if (!m) throw new Error(`missing ${id}`);
  return m;
};
const engine0 = createEngine([vanillaMod]);
const odef = (id: string): ObjectDef => engine0.registry.object(id as never);
/** A weapon entity (not placed anywhere) with the given enchantment. */
const wep = (id: string, spe = 0): Entity => ({
  id: 0,
  def: id as DefId,
  c: {
    item: {
      quantity: 1,
      buc: 'uncursed',
      spe,
      known: { buc: true, spe: true },
      carriedBy: null,
      letter: null,
      equipped: 'weapon',
      placed: 0,
    },
  },
});
const SPEAR = { item: wep('nh:spear', 1), def: odef('nh:spear'), skill: P_BASIC };
const STR_18_50 = 18 + 50;

/** Test-only mod: an action that makes the monster in `target.id` attack the hero. */
const target = { id: 0 };
const testMod: Mod = {
  id: 'test',
  version: '0',
  dependsOn: ['nh'],
  register(api) {
    api.defineAction({
      id: 'test:attack',
      labelKey: 'test.attack',
      handles: 'mod',
      offer: () => [],
      perform(ctx) {
        monsterAttack(ctx, target.id);
        return 12;
      },
    });
    // Repeats until something interrupts it (like travel does).
    api.defineAction({
      id: 'test:repeat',
      labelKey: 'test.repeat',
      handles: 'mod',
      offer: () => [],
      perform(ctx) {
        monsterAttack(ctx, target.id);
        return 12;
      },
      continues: () => true,
    });
  },
};

/** A 9x5 map: floor on row 2 (x 1..6) and row 1/3 (x 1..6); hero at (3,2). */
function setup(seed: number, opts: { str?: number; dex?: number; ac?: number } = {}) {
  const engine = createEngine([vanillaMod, testMod]);
  const { state } = engine.newGame({ seed });
  const width = 9;
  const height = 5;
  const palette: DefId[] = [T.stone, T.floor, T.door_open_h];
  const cells = new Array<number>(width * height).fill(0);
  for (let y = 1; y <= 3; y++) for (let x = 1; x <= 6; x++) cells[y * width + x] = 1;
  const level: Level = {
    id: 'dlvl1',
    depth: 1,
    width,
    height,
    palette,
    cells,
    lit: cells.map(() => 1),
    rooms: [],
    up: null,
    down: null,
  };
  state.levels['dlvl1'] = level;
  state.memory['dlvl1'] = newMemory(level);
  const hero = getPlayer(state);
  if (!hero.c.pos || !hero.c.attributes) throw new Error('hero incomplete');
  hero.c.pos.x = 3;
  hero.c.pos.y = 2;
  if (opts.str !== undefined) hero.c.attributes.str = opts.str;
  if (opts.dex !== undefined) hero.c.attributes.dex = opts.dex;
  if (opts.ac !== undefined) {
    // AC comes from the worn +3 small shield (1 + spe): pick its enchantment for the wanted AC
    const shield = inventoryOf(state, hero.id).find((o) => o.c.item?.equipped === 'shield');
    if (!shield?.c.item) throw new Error('no shield');
    shield.c.item.spe = 10 - opts.ac - 1;
  }
  return { engine, state, level, hero };
}

function spawn(state: GameState, defId: DefId, pos: Pos, hp = 3, asleep = false): EntityId {
  const d = def(defId);
  const id = state.nextEntityId++;
  state.entities[String(id)] = {
    id,
    def: defId,
    c: {
      pos: { level: 'dlvl1', ...pos },
      actor: { energy: 0, speed: d.speed },
      hp: { cur: hp, max: hp },
      monster: { level: d.level, peaceful: false, asleep, lastHero: null },
    },
  };
  return id;
}

const msgs = (events: GameEvent[]): string[] =>
  events.flatMap((e) => (e.type === 'msg' ? [e.key] : []));

describe('formulas', () => {
  test('abon', () => {
    expect(abon(STR_18_50, 14, 1)).toBe(3); // 2 (18/50) + 1 (level < 3) + 0
    expect(abon(STR_18_50, 14, 3)).toBe(2);
    expect(abon(10, 18, 5)).toBe(4);
    expect(abon(5, 3, 1)).toBe(-2 + 1 - 3);
    expect(abon(18 + 49, 10, 5)).toBe(1);
  });

  test('dbon table', () => {
    const table: [number, number][] = [
      [5, -1],
      [6, 0],
      [15, 0],
      [16, 1],
      [17, 1],
      [18, 2],
      [19, 3],
      [18 + 75, 3],
      [18 + 76, 4],
      [18 + 90, 4],
      [18 + 91, 5],
      [18 + 99, 5],
      [18 + 100, 6],
    ];
    for (const [str, bonus] of table) expect(dbon(str), String(str)).toBe(bonus);
  });

  test('hero to-hit: Str 18/50 Dex 14 Valkyrie L1 with +1 spear', () => {
    const hero = { str: STR_18_50, dex: 14, level: 1 };
    // 1 + abon 3 + AC 8 + level 1 + spe 1 + Basic 0 = 14
    expect(heroToHit(hero, def('nh:newt'), { asleep: false }, SPEAR)).toBe(14);
    // 1 + 3 + 3 + 1 + 1 = 9
    expect(heroToHit(hero, def('nh:giant_ant'), { asleep: false }, SPEAR)).toBe(9);
    expect(heroToHit(hero, def('nh:newt'), { asleep: true }, SPEAR)).toBe(16);
    // Unskilled: -4
    expect(
      heroToHit(hero, def('nh:newt'), { asleep: false }, { ...SPEAR, skill: P_UNSKILLED }),
    ).toBe(10);
    // bare-handed Unskilled: 13 + ((1 - 1) + 2) / 2 = 14
    expect(heroToHit(hero, def('nh:newt'), { asleep: false }, null)).toBe(14);
    // encumbrance: Burdened -1, Stressed -3
    expect(heroToHit({ ...hero, encumbrance: 1 }, def('nh:newt'), { asleep: false }, SPEAR)).toBe(
      13,
    );
    expect(heroToHit({ ...hero, encumbrance: 2 }, def('nh:newt'), { asleep: false }, SPEAR)).toBe(
      11,
    );
  });

  test('hitval: enchantment, the weapon hit bonus and the spear bonus on giants', () => {
    // dagger oc_hitbon +2, mattock -1
    expect(hitval(wep('nh:dagger', 0), odef('nh:dagger'), def('nh:newt'))).toBe(2);
    expect(hitval(wep('nh:dagger', 3), odef('nh:dagger'), def('nh:newt'))).toBe(5);
    expect(
      hitval(wep('nh:dwarvish_mattock', -2), odef('nh:dwarvish_mattock'), def('nh:newt')),
    ).toBe(-3);
    expect(hitval(wep('nh:spear', 1), odef('nh:spear'), def('nh:newt'))).toBe(1);
    const giant = { ...def('nh:newt'), glyph: { ch: 'H', fg: '#fff' } };
    expect(hitval(wep('nh:spear', 1), odef('nh:spear'), giant)).toBe(3);
    // a non-weapon contributes nothing
    expect(hitval(wep('nh:food_ration', 5), odef('nh:food_ration'), def('nh:newt'))).toBe(0);
  });

  test('skill bonuses (weapon_hit_bonus / weapon_dam_bonus)', () => {
    const sp = odef('nh:spear');
    expect([0, 1, 2, 3, 4].map((l) => weaponHitBonus(l, sp))).toEqual([-4, -4, 0, 2, 3]);
    expect([0, 1, 2, 3, 4].map((l) => weaponDamBonus(l, sp))).toEqual([-2, -2, 0, 1, 2]);
    // bare hands: unskilled +1/0, basic +1/+1, skilled +2/+1, expert +2/+2
    expect([P_UNSKILLED, P_BASIC, P_SKILLED, P_EXPERT].map((l) => weaponHitBonus(l, null))).toEqual(
      [1, 1, 2, 2],
    );
    expect([P_UNSKILLED, P_BASIC, P_SKILLED, P_EXPERT].map((l) => weaponDamBonus(l, null))).toEqual(
      [0, 1, 1, 2],
    );
    expect(weaponHitBonus(P_UNSKILLED, odef('nh:food_ration'))).toBe(0);
  });

  test('dmgval: dice by target size, special extras, enchantment, clamped at 0', () => {
    const rngFor = (v: number) => ({
      next: () => 0,
      rn2: () => 0,
      rnd: () => v,
      d: (n: number, s: number) => s * n, // maximum rolls
    });
    const sp = odef('nh:spear');
    expect(dmgval(rngFor(0), wep('nh:spear', 1), sp, def('nh:newt'))).toBe(7); // d6 max 6 + 1
    expect(dmgval(rngFor(0), wep('nh:spear', 1), sp, def('nh:rothe'))).toBe(9); // d8 max 8 + 1
    expect(dmgval(rngFor(0), wep('nh:spear', -9), sp, def('nh:newt'))).toBe(0);
    // mace: d6 + 1 vs small only
    expect(dmgval(rngFor(0), wep('nh:mace'), odef('nh:mace'), def('nh:newt'))).toBe(7);
    expect(dmgval(rngFor(0), wep('nh:mace'), odef('nh:mace'), def('nh:rothe'))).toBe(6);
    // dwarvish mattock: d12 vs small, d8 + 2d6 vs large
    const mat = odef('nh:dwarvish_mattock');
    expect(dmgval(rngFor(0), wep('nh:dwarvish_mattock'), mat, def('nh:newt'))).toBe(12);
    expect(dmgval(rngFor(0), wep('nh:dwarvish_mattock'), mat, def('nh:rothe'))).toBe(8 + 12);
  });

  test('monster to-hit: level and AC, AC_VALUE for negative AC', () => {
    const rng = { next: () => 0, rn2: () => 0, rnd: () => 1, d: () => 1 };
    expect(monsterToHit(rng, 6, 0)).toBe(16);
    expect(monsterToHit(rng, 6, 2)).toBe(18);
    expect(acValue(rng, 6)).toBe(6);
    expect(acValue(rng, -3)).toBe(-1); // -rnd(3) with rnd = 1
    expect(monsterToHit(rng, -3, 0)).toBe(9);
    expect(monsterToHit({ ...rng, rnd: () => 20 }, -30, 0)).toBe(1); // clamped to 1
    for (let i = 0; i < 50; i++) {
      const v = acValue({ ...rng, rnd: (x: number) => 1 + (i % x) }, -3);
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThanOrEqual(-1);
    }
  });
});

describe('hero attacks', () => {
  const fight = (seed: number) => {
    const s = setup(seed);
    const newt = spawn(s.state, 'nh:newt', { x: 4, y: 2 }, 3);
    const log: string[] = [];
    let kills = 0;
    for (let i = 0; i < 60 && s.state.entities[String(newt)]; i++) {
      const before = getPlayer(s.state).c.experience?.points ?? 0;
      const r = s.engine.step(s.state, { type: 'move', dir: 'e' });
      const m = msgs(r.events);
      log.push(...m.filter((k) => k.startsWith('combat.you_'))); // the newt may bite back
      if (m.includes('combat.you_kill')) {
        kills++;
        expect(getPlayer(s.state).c.experience?.points).toBeGreaterThan(before);
      }
      expect(getPlayer(s.state).c.pos?.x).toBe(3); // attacking never moves the hero
    }
    return { s, newt, log, kills };
  };

  test('repeated attacks kill a newt, award XP and remove it', () => {
    const { s, newt, log, kills } = fight(7);
    expect(kills).toBe(1);
    expect(s.state.entities[String(newt)]).toBeUndefined();
    expect(log.at(-1)).toBe('combat.you_kill');
    for (const k of log) expect(k.startsWith('combat.you_')).toBe(true);
    expect(getPlayer(s.state).c.experience?.points).toBeGreaterThan(0);
    for (const k of log) expect(messagesEn).toHaveProperty([k]);
  });

  test('a seed with a miss and a hit shows both messages; a hit wakes a sleeper', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed < 40; seed++) for (const k of fight(seed).log) seen.add(k);
    expect(seen).toContain('combat.you_miss');
    expect(seen).toContain('combat.you_kill');
    const s = setup(3);
    const rothe = spawn(s.state, 'nh:rothe', { x: 4, y: 2 }, 500, true);
    s.engine.step(s.state, { type: 'move', dir: 'e' });
    expect(s.state.entities[String(rothe)]?.c.monster?.asleep).toBe(false);
  });

  test('determinism: same seed gives the same combat log', () => {
    expect(fight(11).log).toEqual(fight(11).log);
  });

  test('offers: visible adjacent monster turns the move offer into an attack', () => {
    const s = setup(2);
    spawn(s.state, 'nh:newt', { x: 4, y: 2 });
    s.engine.step(s.state, { type: 'wait' }); // refresh vision
    const offers = s.engine.query(s.state).actionsFor({ kind: 'cell', pos: { x: 4, y: 2 } });
    expect(offers.map((o) => o.labelKey)).toEqual(['action.attack']);
    expect(offers[0]?.params).toEqual({ target: '@nh:newt' });
    expect(offers[0]?.action).toEqual({ type: 'move', dir: 'e' });
    const plain = s.engine.query(s.state).actionsFor({ kind: 'cell', pos: { x: 2, y: 2 } });
    expect(plain.map((o) => o.labelKey)).toEqual(['action.move']);
    expect(messagesEn['action.attack']).toBe('Attack the {target}');
  });

  test('attacks work diagonally out of a doorway where moving does not', () => {
    const s = setup(2);
    const lvl = getLevel(s.state);
    lvl.cells[2 * lvl.width + 3] = 2; // hero stands in an open door
    // plain diagonal move is refused
    const before = { ...s.hero.c.pos };
    const r = s.engine.step(s.state, { type: 'move', dir: 'ne' });
    expect(s.hero.c.pos).toMatchObject({ x: before.x, y: before.y });
    expect(r.events.some((e) => e.type === 'blocked')).toBe(true);
    const newt = spawn(s.state, 'nh:newt', { x: 4, y: 1 }, 1000);
    const r2 = s.engine.step(s.state, { type: 'move', dir: 'ne' });
    expect(msgs(r2.events).some((k) => k.startsWith('combat.you_'))).toBe(true);
    expect(s.state.entities[String(newt)]?.c.monster?.asleep).toBe(false);
    expect(s.hero.c.pos).toMatchObject({ x: 3, y: 2 });
  });
});

describe('monster attacks', () => {
  const bite = { type: 'mod', action: 'test:attack' } as const;

  test('hits reduce hp, interrupt, and use NetHack wording', () => {
    let hit = false;
    for (let seed = 1; seed < 30 && !hit; seed++) {
      const s = setup(seed);
      const hp0 = s.hero.c.hp?.cur ?? 0;
      target.id = spawn(s.state, 'nh:jackal', { x: 4, y: 2 });
      const r = s.engine.step(s.state, bite);
      const m = msgs(r.events);
      expect(m).toHaveLength(1);
      if (m[0] === 'combat.mon_bites') {
        hit = true;
        expect(s.hero.c.hp?.cur).toBeLessThan(hp0);
        expect(s.hero.c.hp?.cur).toBeGreaterThanOrEqual(hp0 - 2);
      } else {
        expect(['combat.mon_misses', 'combat.mon_just_misses']).toContain(m[0]);
        expect(s.hero.c.hp?.cur).toBe(hp0);
      }
    }
    expect(hit).toBe(true);
    expect(messagesEn['combat.mon_bites']).toBe('The {mon} bites!');
  });

  test('a hit interrupts multi-turn actions', () => {
    const s = setup(5, { ac: 10 });
    if (s.hero.c.hp) s.hero.c.hp.cur = s.hero.c.hp.max = 1000;
    target.id = spawn(s.state, 'nh:jackal', { x: 4, y: 2 });
    const r = s.engine.step(s.state, { type: 'mod', action: 'test:repeat' });
    const m = msgs(r.events);
    expect(m.at(-1)).toBe('combat.mon_bites'); // stopped right after the first hit
    expect(m.slice(0, -1).every((k) => k.endsWith('misses'))).toBe(true);
    expect(s.hero.c.hp?.cur).toBeLessThan(1000);
  });

  test('multi-attack monsters roll each attack with rnd(20 + i)', () => {
    const counts = new Map<string, number>();
    for (let seed = 1; seed < 60; seed++) {
      const s = setup(seed, { ac: 6 });
      target.id = spawn(s.state, 'nh:rothe', { x: 4, y: 2 });
      const r = s.engine.step(s.state, bite);
      const m = msgs(r.events);
      expect(m).toHaveLength(3); // three attacks, each hits or misses
      for (const k of m) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    expect(counts.has('combat.mon_hits') || counts.has('combat.mon_bites')).toBe(true);
    expect(counts.has('combat.mon_bites_again')).toBe(true);
    for (const k of counts.keys()) expect(messagesEn).toHaveProperty([k]);
  });

  test('negative AC reduces damage but never below 1', () => {
    for (let seed = 1; seed < 40; seed++) {
      const s = setup(seed, { ac: -5 });
      const hp0 = s.hero.c.hp?.cur ?? 0;
      target.id = spawn(s.state, 'nh:rothe', { x: 4, y: 2 });
      s.engine.step(s.state, bite);
      expect(s.hero.c.hp?.cur ?? 0).toBeLessThanOrEqual(hp0);
    }
  });

  test('hero death ends the game', () => {
    for (let seed = 1; seed < 50; seed++) {
      const s = setup(seed, { ac: 10 });
      if (s.hero.c.hp) s.hero.c.hp.cur = 1;
      target.id = spawn(s.state, 'nh:rothe', { x: 4, y: 2 });
      const r = s.engine.step(s.state, bite);
      if (!s.state.gameOver) continue;
      expect(s.state.gameOver).toMatchObject({
        kind: 'died',
        killer: '@nh:rothe',
        depth: 1,
        level: 1,
      });
      expect(msgs(r.events)).toContain('combat.you_die');
      expect(messagesEn['combat.you_die']).toBe('You die...');
      expect(() => s.engine.step(s.state, { type: 'wait' })).toThrow();
      return;
    }
    throw new Error('hero never died');
  });
});
