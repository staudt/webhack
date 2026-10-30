import {
  VANILLA_TERRAIN,
  computeVisible,
  cellRules,
  createEngine,
  getLevel,
  getPlayer,
  buildSnapshot,
  inventoryOf,
  itemsAt,
  sortedIds,
  newMemory,
  updateMemory,
  type AttributesComponent,
  type CoreQuery,
  type Buc,
  type DefId,
  type EquipSlot,
  type Engine,
  type HungerState,
  type ItemComponent,
  type GameEvent,
  type GameOver,
  type GameState,
  type Level,
  type Mod,
  type PlayerAction,
  type Pos,
} from '@nh/core';
import { test } from 'vitest';

/** ASCII char -> terrain def. '@' is reserved: floor plus the player start. */
export type AsciiLegend = Record<string, DefId>;

export const DEFAULT_LEGEND: AsciiLegend = {
  ' ': VANILLA_TERRAIN.stone,
  '|': VANILLA_TERRAIN.vwall,
  '-': VANILLA_TERRAIN.hwall,
  '.': VANILLA_TERRAIN.floor,
  '#': VANILLA_TERRAIN.corr,
  '+': VANILLA_TERRAIN.door_closed,
  '<': VANILLA_TERRAIN.stairs_up,
  '>': VANILLA_TERRAIN.stairs_down,
  D: VANILLA_TERRAIN.doorway,
  v: VANILLA_TERRAIN.door_open_v,
  h: VANILLA_TERRAIN.door_open_h,
  '@': VANILLA_TERRAIN.floor,
};

/** Options for `s.item()`. Everything is exact: nothing is randomized. */
export interface ItemOpts {
  /** Default 1. */
  quantity?: number;
  /** Default 'uncursed'. */
  buc?: Buc;
  /** Enchantment or charges, default 0. */
  spe?: number;
  /** What the hero knows: true = BUC and enchantment, or choose each. Default: nothing. */
  known?: boolean | { buc?: boolean; spe?: boolean };
  /** Inventory only: wielded ('weapon') or worn in this armor slot. */
  equipped?: EquipSlot;
  /** Corpses: the monster def. */
  corpseOf?: DefId;
}

/** One expected inventory stack. A bare def id matches by def alone. */
export type ItemSpec =
  | DefId
  | {
      def: DefId;
      quantity?: number;
      letter?: string;
      /** A slot, or `null` for "not equipped". Omit to not care. */
      equipped?: EquipSlot | null;
      buc?: Buc;
      spe?: number;
    };

export interface ScenarioBuilder {
  /** Replace dlvl1 with a hand-built level; '@' marks the player. */
  level(ascii: string | string[], opts?: { lit?: boolean }): void;
  player(pos: Pos): void;
  act(action: PlayerAction | PlayerAction[]): void;
  /** Matches any event from the most recent act() (deep partial match). */
  expectEvent(partial: Partial<GameEvent> & { type: GameEvent['type'] }): void;
  expectNoEvent(type: GameEvent['type']): void;
  expectPos(pos: Pos): void;
  expectTurn(turn: number): void;
  expectTerrain(pos: Pos, id: DefId): void;
  check(fn: (state: GameState, query: CoreQuery) => void): void;

  /**
   * Choose the game seed (default 1). Call it FIRST: it restarts the game, discarding anything
   * built so far. There is no RNG rigging: to get a deterministic combat outcome, pick a seed
   * (search seeds in the test helper, then assert with the one found).
   */
  seed(n: number): void;
  /**
   * Spawn a monster like content's makemon would: speed and level from the registry def, energy 0,
   * awake and hostile unless opted otherwise. hp defaults to `opts.hp ?? max(1, level * 4)` (cur = max).
   * Vision is refreshed afterwards. The cell must be passable and free.
   */
  monster(
    def: DefId,
    pos: Pos,
    opts?: { hp?: number; level?: number; asleep?: boolean; peaceful?: boolean; speed?: number },
  ): void;
  /** Remove every non-hero entity. `level()` already does this for the level it replaces. */
  clearMonsters(): void;
  setHero(opts: {
    hp?: number;
    maxHp?: number;
    attributes?: Partial<AttributesComponent>;
    ac?: number;
    level?: number;
  }): void;
  expectHp(n: number | { min?: number; max?: number }): void;
  /** The game ended in death; optionally by this monster def. */
  expectDead(killer?: DefId): void;
  expectAlive(): void;
  expectMonsterAt(pos: Pos, def?: DefId): void;
  expectNoMonsterAt(pos: Pos): void;
  expectGameOver(kind?: GameOver['kind']): void;

  /**
   * Create an object with exactly the given fields and put it on the floor at `pos` or into the
   * hero's inventory (it gets the first free letter a-z then A-Z, gold is '$'). Items never merge
   * here, so two calls make two stacks. The level cell must be passable.
   */
  item(def: DefId, where: Pos | 'inventory', opts?: ItemOpts): void;
  /** Remove everything the hero carries (the starting kit included). */
  clearInventory(): void;
  /**
   * The hero's inventory must be exactly these stacks, in any order (each spec matches a distinct
   * stack). Pass `{ only: false }` to allow additional stacks. `[]` means empty.
   */
  expectInventory(spec: readonly ItemSpec[], opts?: { only?: boolean }): void;
  /** The wielded item's def, or `null` for bare hands. */
  expectWielded(def: DefId | null): void;
  /** The hero's armor class as the status line shows it. */
  expectAc(n: number): void;
  /** The pile at `pos` contains an object of this def (and, with `quantity`, that stack size). */
  expectItemAt(pos: Pos, def: DefId, quantity?: number): void;
  expectNoItemAt(pos: Pos): void;
  /** Set u.uhunger and the matching hunger state (silently: no messages, no strength change). */
  setHunger(nutrition: number): void;
  expectHunger(state: HungerState): void;
}

export interface ScenarioResult {
  state: GameState;
  engine: Engine;
  events: GameEvent[];
}

export type ScenarioFn = (name: string, build: (s: ScenarioBuilder) => void) => void;
export interface ScenarioOptions {
  legend?: Partial<AsciiLegend>;
}

const SCENARIO_SEED = 1;

function isSubset(want: unknown, have: unknown): boolean {
  if (want === null || typeof want !== 'object') return want === have;
  if (have === null || typeof have !== 'object') return false;
  if (Array.isArray(want)) {
    return (
      Array.isArray(have) &&
      want.length === have.length &&
      want.every((w, i) => isSubset(w, have[i]))
    );
  }
  const h = have as Record<string, unknown>;
  return Object.keys(want).every((k) => isSubset((want as Record<string, unknown>)[k], h[k]));
}

function render(
  level: Level,
  legend: AsciiLegend,
  at: Pos,
  mons: readonly { pos: Pos; ch: string }[] = [],
): string {
  const monAt = new Map(mons.map((m) => [`${m.pos.x},${m.pos.y}`, m.ch]));
  const byId = new Map<string, string>();
  for (const ch of Object.keys(legend).sort()) {
    if (ch === '@') continue;
    const id = legend[ch] as string;
    if (!byId.has(id)) byId.set(id, ch);
  }
  const rows: string[] = [];
  for (let y = 0; y < level.height; y++) {
    let row = '';
    for (let x = 0; x < level.width; x++) {
      if (x === at.x && y === at.y) {
        row += '@';
        continue;
      }
      const mch = monAt.get(`${x},${y}`);
      if (mch) {
        row += mch;
        continue;
      }
      const id = level.palette[level.cells[y * level.width + x] ?? 0] ?? '';
      row += byId.get(id) ?? '?';
    }
    rows.push(row);
  }
  return rows.join('\n');
}

export function runScenario(
  mods: readonly Mod[],
  build: (s: ScenarioBuilder) => void,
  opts: ScenarioOptions = {},
): ScenarioResult {
  const legend: AsciiLegend = { ...DEFAULT_LEGEND };
  for (const [k, v] of Object.entries(opts.legend ?? {})) if (v !== undefined) legend[k] = v;
  const engine = createEngine(mods);
  let state = engine.newGame({ seed: SCENARIO_SEED }).state;
  let events: GameEvent[] = [];
  let step = 0;

  const refresh = (): void => {
    const level = getLevel(state);
    const visible = computeVisible(level, cellRules(level, engine.registry), playerAt());
    const memory = (state.memory[level.id] ??= newMemory(level));
    updateMemory(memory, level, visible);
    state.visible = visible;
  };
  const playerAt = (): Pos => {
    const p = getPlayer(state).c.pos;
    if (!p) throw new Error('player has no pos');
    return { x: p.x, y: p.y };
  };
  const monstersOnLevel = (): { id: number; def: DefId; pos: Pos; hp: string; ch: string }[] => {
    const out: { id: number; def: DefId; pos: Pos; hp: string; ch: string }[] = [];
    for (const id of sortedIds(state)) {
      const e = state.entities[String(id)];
      const p = e?.c.pos;
      if (!e || !p || id === state.playerId || p.level !== state.currentLevel) continue;
      const hp = e.c.hp ? `${e.c.hp.cur}/${e.c.hp.max}` : '-';
      const ch = engine.registry.isMonster(e.def) ? engine.registry.monster(e.def).glyph.ch : '&';
      out.push({ id, def: e.def, pos: { x: p.x, y: p.y }, hp, ch });
    }
    return out;
  };
  const fail = (msg: string): never => {
    const level = getLevel(state);
    const mons = monstersOnLevel();
    const hero = getPlayer(state).c.hp;
    throw new Error(
      `Scenario step ${step}: ${msg}\nturn ${state.turn}, player at ${JSON.stringify(playerAt())}, ` +
        `hero hp ${hero ? `${hero.cur}/${hero.max}` : '-'}, gameOver ${JSON.stringify(state.gameOver)}\n` +
        `monsters: ${mons.length === 0 ? 'none' : mons.map((m) => `${m.def}#${m.id}@${m.pos.x},${m.pos.y} hp ${m.hp}`).join('; ')}\n` +
        `events: ${JSON.stringify(events)}\n${render(level, legend, playerAt(), mons)}`,
    );
  };
  const describeInventory = (): string =>
    inventoryOf(state, state.playerId)
      .map(
        (e) =>
          `${e.c.item?.letter ?? '?'}: ${e.def} x${e.c.item?.quantity ?? 0}` +
          (e.c.item?.equipped ? ` (${e.c.item.equipped})` : ''),
      )
      .join('; ') || 'empty';
  /** The first free letter a-z then A-Z among the hero's items. */
  const freeLetter = (): string => {
    const used = new Set(inventoryOf(state, state.playerId).map((e) => e.c.item?.letter));
    for (let i = 0; i < 52; i++) {
      const l = String.fromCharCode(i < 26 ? 97 + i : 65 + i - 26);
      if (!used.has(l)) return l;
    }
    return fail('item(): the inventory is full (52 letters)');
  };
  const clearMonsters = (levelId?: string): void => {
    for (const id of sortedIds(state)) {
      if (id === state.playerId) continue;
      const p = state.entities[String(id)]?.c.pos;
      if (levelId === undefined || p?.level === levelId) delete state.entities[String(id)];
    }
  };

  const buildLevel = (ascii: string | string[], lit: boolean): void => {
    const rows = typeof ascii === 'string' ? ascii.split('\n') : ascii;
    const width = Math.max(...rows.map((r) => r.length));
    const height = rows.length;
    const palette: DefId[] = [...Object.values(VANILLA_TERRAIN)];
    const cells: number[] = [];
    let start: Pos | null = null;
    let up: Pos | null = null;
    let down: Pos | null = null;
    for (let y = 0; y < height; y++) {
      const row = (rows[y] as string).padEnd(width, ' ');
      for (let x = 0; x < width; x++) {
        const ch = row.charAt(x);
        const id = legend[ch];
        if (id === undefined)
          throw new Error(`level(): character '${ch}' at ${x},${y} is not in the legend`);
        if (ch === '@') {
          if (start) throw new Error('level(): more than one @');
          start = { x, y };
        }
        if (id === VANILLA_TERRAIN.stairs_up) up = { x, y };
        if (id === VANILLA_TERRAIN.stairs_down) down = { x, y };
        let pi = palette.indexOf(id);
        if (pi === -1) pi = palette.push(id) - 1;
        cells.push(pi);
      }
    }
    const old = getLevel(state);
    const level: Level = {
      id: old.id,
      depth: old.depth,
      width,
      height,
      palette,
      cells,
      lit: cells.map(() => (lit ? 1 : 0)),
      rooms: [],
      up,
      down,
    };
    state.levels[level.id] = level;
    delete state.memory[level.id];
    clearMonsters(level.id);
    const pos = getPlayer(state).c.pos;
    const at = start ?? up ?? down;
    if (!pos || !at) throw new Error('level(): mark the player start with @');
    pos.x = at.x;
    pos.y = at.y;
    refresh();
  };

  const mustHaveHp = (): { cur: number; max: number } => {
    const hp = getPlayer(state).c.hp;
    if (!hp) return fail('hero has no hp component');
    return hp;
  };

  const s: ScenarioBuilder = {
    seed(n) {
      state = engine.newGame({ seed: n }).state;
      events = [];
    },
    monster(def, pos, o) {
      if (!engine.registry.isMonster(def)) fail(`monster(): '${def}' is not a registered monster`);
      const d = engine.registry.monster(def);
      const level = getLevel(state);
      const lvl = o?.level ?? d.level;
      const hp = o?.hp ?? Math.max(1, lvl * 4);
      const terr = level.palette[level.cells[pos.y * level.width + pos.x] ?? -1];
      if (terr === undefined || !engine.registry.terrain(terr).passable) {
        fail(`monster(): ${JSON.stringify(pos)} is not passable terrain`);
      }
      const clash = monstersOnLevel().find((m) => m.pos.x === pos.x && m.pos.y === pos.y);
      if (clash || (playerAt().x === pos.x && playerAt().y === pos.y)) {
        fail(`monster(): ${JSON.stringify(pos)} is occupied`);
      }
      const id = state.nextEntityId++;
      state.entities[String(id)] = {
        id,
        def,
        c: {
          pos: { level: level.id, x: pos.x, y: pos.y },
          actor: { energy: 0, speed: o?.speed ?? d.speed },
          hp: { cur: hp, max: hp },
          monster: {
            level: lvl,
            peaceful: o?.peaceful ?? false,
            asleep: o?.asleep ?? false,
            lastHero: null,
          },
        },
      };
      refresh();
    },
    clearMonsters() {
      clearMonsters();
    },
    setHero(o) {
      const hero = getPlayer(state);
      const hp = mustHaveHp();
      if (o.maxHp !== undefined) hp.max = o.maxHp;
      if (o.hp !== undefined) {
        hp.cur = o.hp;
        if (o.maxHp === undefined && hp.max < o.hp) hp.max = o.hp;
      }
      if (o.attributes) {
        const a = (hero.c.attributes ??= { str: 10, int: 10, wis: 10, dex: 10, con: 10, cha: 10 });
        for (const k of Object.keys(o.attributes).sort() as (keyof AttributesComponent)[]) {
          const v = o.attributes[k];
          if (v !== undefined) a[k] = v;
        }
      }
      if (o.ac !== undefined) {
        // AC comes from worn armor now: shift the enchantment of the first worn piece so the
        // total is `o.ac` (10 needs no armor at all, so any worn piece is adjusted to +0 effect).
        const worn = sortedIds(state)
          .map((id) => state.entities[String(id)])
          .filter((e) => e?.c.item?.carriedBy === hero.id && e.c.item.equipped !== null)
          .filter(
            (e) => e && engine.registry.isObject(e.def) && engine.registry.object(e.def).armor,
          );
        let bonus = 0;
        for (const e of worn)
          bonus += (engine.registry.object(e?.def ?? 'x:y').armor?.ac ?? 0) + (e?.c.item?.spe ?? 0);
        const first = worn[0]?.c.item;
        if (first) first.spe += 10 - o.ac - bonus;
        else if (o.ac !== 10) fail(`cannot set AC ${o.ac}: the hero wears no armor`);
      }
      if (o.level !== undefined) {
        const x = (hero.c.experience ??= { level: 1, points: 0 });
        x.level = o.level;
      }
    },
    expectHp(n) {
      const hp = mustHaveHp();
      if (typeof n === 'number') {
        if (hp.cur !== n) fail(`expected hero hp ${n}, found ${hp.cur}`);
      } else if (
        (n.min !== undefined && hp.cur < n.min) ||
        (n.max !== undefined && hp.cur > n.max)
      ) {
        fail(`expected hero hp within ${JSON.stringify(n)}, found ${hp.cur}`);
      }
    },
    expectDead(killer) {
      const g = state.gameOver;
      if (g?.kind !== 'died')
        fail(`expected the hero to be dead, gameOver is ${JSON.stringify(g)}`);
      if (killer !== undefined && g?.killer !== `@${killer}`) {
        fail(`expected killer '@${killer}', found '${g?.killer}'`);
      }
    },
    expectAlive() {
      if (state.gameOver)
        fail(`expected the hero to be alive, gameOver is ${JSON.stringify(state.gameOver)}`);
    },
    expectMonsterAt(p, def) {
      const m = monstersOnLevel().find((x) => x.pos.x === p.x && x.pos.y === p.y);
      if (!m) fail(`expected a monster at ${JSON.stringify(p)}, found none`);
      else if (def !== undefined && m.def !== def)
        fail(`expected '${def}' at ${JSON.stringify(p)}, found '${m.def}'`);
    },
    expectNoMonsterAt(p) {
      const m = monstersOnLevel().find((x) => x.pos.x === p.x && x.pos.y === p.y);
      if (m) fail(`expected no monster at ${JSON.stringify(p)}, found '${m.def}'`);
    },
    expectGameOver(kind) {
      const g = state.gameOver;
      if (!g) fail('expected the game to be over');
      else if (kind !== undefined && g.kind !== kind)
        fail(`expected game over '${kind}', found '${g.kind}'`);
    },
    item(def, where, o) {
      if (!engine.registry.isObject(def)) fail(`item(): '${def}' is not a registered object`);
      const id = state.nextEntityId++;
      const k = o?.known;
      const comp: ItemComponent = {
        quantity: o?.quantity ?? 1,
        buc: o?.buc ?? 'uncursed',
        spe: o?.spe ?? 0,
        known: {
          buc: typeof k === 'object' ? (k.buc ?? false) : (k ?? false),
          spe: typeof k === 'object' ? (k.spe ?? false) : (k ?? false),
        },
        carriedBy: null,
        letter: null,
        equipped: null,
        placed: state.seq++,
        age: Math.max(state.turn, 1),
      };
      if (o?.corpseOf !== undefined) comp.corpseOf = o.corpseOf;
      if (def === 'nh:corpse' && comp.corpseOf === undefined)
        fail('item(): a corpse needs the corpseOf option');
      if (where === 'inventory') {
        comp.carriedBy = state.playerId;
        comp.letter = engine.registry.object(def).class === 'coin' ? '$' : freeLetter();
        if (o?.equipped !== undefined) {
          const taken = inventoryOf(state, state.playerId).find(
            (e) => e.c.item?.equipped === o.equipped,
          );
          if (taken) fail(`item(): slot '${o.equipped}' is already occupied by ${taken.def}`);
          comp.equipped = o.equipped;
        }
        state.entities[String(id)] = { id, def, c: { item: comp } };
      } else {
        if (o?.equipped !== undefined) fail('item(): only inventory items can be equipped');
        const level = getLevel(state);
        const terr = level.palette[level.cells[where.y * level.width + where.x] ?? -1];
        if (terr === undefined || !engine.registry.terrain(terr).passable)
          fail(`item(): ${JSON.stringify(where)} is not passable terrain`);
        state.entities[String(id)] = {
          id,
          def,
          c: { item: comp, pos: { level: level.id, x: where.x, y: where.y } },
        };
      }
      refresh();
    },
    clearInventory() {
      for (const e of inventoryOf(state, state.playerId)) delete state.entities[String(e.id)];
    },
    expectInventory(spec, o) {
      const left = inventoryOf(state, state.playerId);
      const missing: string[] = [];
      for (const sp of spec) {
        const w = typeof sp === 'string' ? { def: sp } : sp;
        const at = left.findIndex((e) => {
          const it = e.c.item;
          return (
            it !== undefined &&
            e.def === w.def &&
            ('quantity' in w ? it.quantity === w.quantity : true) &&
            ('letter' in w ? it.letter === w.letter : true) &&
            ('equipped' in w ? it.equipped === w.equipped : true) &&
            ('buc' in w ? it.buc === w.buc : true) &&
            ('spe' in w ? it.spe === w.spe : true)
          );
        });
        if (at < 0) missing.push(JSON.stringify(sp));
        else left.splice(at, 1);
      }
      if (missing.length > 0)
        fail(`inventory lacks ${missing.join(', ')}\ninventory: ${describeInventory()}`);
      if ((o?.only ?? true) && left.length > 0)
        fail(`inventory has unexpected items\ninventory: ${describeInventory()}`);
    },
    expectWielded(def) {
      const w = inventoryOf(state, state.playerId).find((e) => e.c.item?.equipped === 'weapon');
      if ((w?.def ?? null) !== def)
        fail(`expected wielded ${def ?? 'nothing'}, found ${w?.def ?? 'nothing'}`);
    },
    expectAc(n) {
      const ac = buildSnapshot(engine.registry, state).status['ac'];
      if (ac !== n) fail(`expected AC ${n}, found ${String(ac)}`);
    },
    expectItemAt(p, def, quantity) {
      const here = itemsAt(engine.registry, state, state.currentLevel, p.x, p.y);
      const hit = here.find(
        (e) => e.def === def && (quantity === undefined || e.c.item?.quantity === quantity),
      );
      if (!hit)
        fail(
          `expected ${def}${quantity === undefined ? '' : ` x${quantity}`} at ${JSON.stringify(p)}, ` +
            `found [${here.map((e) => `${e.def} x${e.c.item?.quantity ?? 0}`).join(', ')}]`,
        );
    },
    expectNoItemAt(p) {
      const here = itemsAt(engine.registry, state, state.currentLevel, p.x, p.y);
      if (here.length > 0)
        fail(
          `expected no items at ${JSON.stringify(p)}, found [${here.map((e) => e.def).join(', ')}]`,
        );
    },
    setHunger(nutrition) {
      const h = getPlayer(state).c.hunger;
      if (!h) return fail('hero has no hunger component');
      h.nutrition = nutrition;
      // ref: src/eat.c newuhs() thresholds
      h.state =
        nutrition > 1000
          ? 'satiated'
          : nutrition > 150
            ? 'not_hungry'
            : nutrition > 50
              ? 'hungry'
              : nutrition > 0
                ? 'weak'
                : 'fainting';
    },
    expectHunger(want) {
      const h = getPlayer(state).c.hunger;
      if (h?.state !== want)
        fail(
          `expected hunger '${want}', found '${h?.state ?? 'none'}' (nutrition ${h?.nutrition ?? '-'})`,
        );
    },
    level(ascii, o) {
      buildLevel(ascii, o?.lit ?? true);
    },
    player(p) {
      const pos = getPlayer(state).c.pos;
      if (!pos) throw new Error('player has no pos');
      pos.x = p.x;
      pos.y = p.y;
      refresh();
    },
    act(action) {
      events = [];
      for (const a of Array.isArray(action) ? action : [action]) {
        if (state.gameOver) break; // later actions are moot once the hero is dead
        events.push(...engine.stepAll(state, a).events);
      }
    },
    expectEvent(partial) {
      if (!events.some((e) => isSubset(partial, e)))
        fail(`expected event ${JSON.stringify(partial)} was not emitted`);
    },
    expectNoEvent(type) {
      const e = events.find((x) => x.type === type);
      if (e) fail(`unexpected '${type}' event ${JSON.stringify(e)}`);
    },
    expectPos(p) {
      const a = playerAt();
      if (a.x !== p.x || a.y !== p.y)
        fail(`expected player at ${JSON.stringify(p)}, found ${JSON.stringify(a)}`);
    },
    expectTurn(t) {
      if (state.turn !== t) fail(`expected turn ${t}, found ${state.turn}`);
    },
    expectTerrain(p, id) {
      const level = getLevel(state);
      const got = level.palette[level.cells[p.y * level.width + p.x] ?? -1];
      if (got !== id)
        fail(`expected terrain '${id}' at ${JSON.stringify(p)}, found '${got ?? 'out of bounds'}'`);
    },
    check(fn) {
      fn(state, engine.query(state));
    },
  };

  // Record builder calls, then execute them in order.
  const recorded: ((real: ScenarioBuilder) => void)[] = [];
  const recorder = {} as ScenarioBuilder;
  for (const key of Object.keys(s) as (keyof ScenarioBuilder)[]) {
    (recorder as unknown as Record<string, unknown>)[key] = (...args: unknown[]) => {
      recorded.push((real) => (real[key] as (...a: unknown[]) => void)(...args));
    };
  }
  build(recorder);
  for (const run of recorded) {
    step++;
    run(s);
  }
  return { state, engine, events };
}

export function createScenario(mods: readonly Mod[], opts: ScenarioOptions = {}): ScenarioFn {
  return (name, build) => {
    test(name, () => {
      runScenario(mods, build, opts);
    });
  };
}
