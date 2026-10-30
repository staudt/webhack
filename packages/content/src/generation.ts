// Monster generation: rndmonst, makemon, level population and random spawning.
import {
  cellIndex,
  cellRules,
  getLevel,
  getPlayer,
  inBounds,
  isVisible,
  type CellRules,
  type Ctx,
  type EntityId,
  type Level,
  type LevelId,
  type ModApi,
  type MonsterDef,
  type Pos,
} from '@nh/core';
import { givePossessions } from './mongear';

/**
 * The stub hero is a neutral human Valkyrie; neutral is alignment type 0 and the Valkyrie's
 * initial alignment record is 0 (it never changes in this port).
 * ref: src/role.c roles[] Valkyrie initrecord 0; include/align.h A_NEUTRAL
 */
export const HERO_ALIGN_TYPE = 0;
export const HERO_ALIGN_RECORD = 0;
/** ref: src/allmain.c maybe_generate_rnd_mon(): 1 in 70 per turn above the Castle's depth */
export const SPAWN_ODDS = 70;

const heroLevel = (ctx: Pick<Ctx, 'state'>): number =>
  getPlayer(ctx.state).c.experience?.level ?? 1;

/** ref: include/monst.h monmin_difficulty() */
export const monminDifficulty = (levdif: number): number => Math.trunc(levdif / 6);
/** ref: include/monst.h monmax_difficulty() */
export const monmaxDifficulty = (levdif: number, ulevel: number): number =>
  Math.trunc((levdif + ulevel) / 2);

/**
 * ref: src/makemon.c uncommon(): not randomly generated (nogen/unique), or Gehennom-only
 * ('hell' genFlag). We are never in Gehennom.
 */
function uncommon(def: MonsterDef): boolean {
  return (
    def.genFlags.includes('nogen') || def.genFlags.includes('uniq') || def.genFlags.includes('hell')
  );
}

/** ref: src/makemon.c align_shift(): the Dungeons of Doom are unaligned (AM_NONE), so 0. */
function alignShift(_def: MonsterDef): number {
  return 0;
}

/**
 * A random monster type appropriate for a level of difficulty `depth` (and the hero's level).
 * ref: src/makemon.c rndmonst_adj() weighted reservoir sampling; returns null if none qualify.
 */
export function rndmonst(
  ctx: Pick<Ctx, 'state' | 'rng' | 'defs'>,
  depth: number,
): MonsterDef | null {
  const minmlev = monminDifficulty(depth);
  const maxmlev = monmaxDifficulty(depth, heroLevel(ctx));
  let total = 0;
  let selected: MonsterDef | null = null;
  for (const def of ctx.defs.monsters) {
    if (def.difficulty < minmlev || def.difficulty > maxmlev) continue; // montooweak/strong
    if (uncommon(def)) continue;
    const weight = def.frequency + alignShift(def);
    if (weight > 0) {
      total += weight;
      if (ctx.rng.rn2(total) < weight) selected = def;
    }
  }
  return selected;
}

/** ref: src/makemon.c adj_lev() */
export function adjLev(def: MonsterDef, depth: number, ulevel: number): number {
  let tmp = def.level;
  let tmp2 = depth - tmp;
  if (tmp2 < 0) tmp--;
  else tmp += Math.trunc(tmp2 / 5);
  tmp2 = ulevel - def.level;
  if (tmp2 > 0) tmp += Math.trunc(tmp2 / 4);
  tmp2 = Math.trunc((3 * def.level) / 2);
  return tmp > tmp2 ? tmp2 : tmp > 0 ? tmp : 0;
}

/** ref: src/makemon.c newmonhp() (ordinary monsters only; no golems, dragons, riders). */
export function newmonhp(ctx: Ctx, mlev: number): number {
  let basehp: number;
  let hp: number;
  if (!mlev) {
    basehp = 1;
    hp = ctx.rng.rnd(4);
  } else {
    basehp = mlev;
    hp = ctx.rng.d(basehp, 8);
  }
  if (hp === basehp) hp += 1;
  return hp;
}

/**
 * Alignment toward the hero decides peacefulness.
 * ref: src/makemon.c peace_minded(). Race: human hates gnomes and orcs, loves nothing.
 * Not ported: minions, quest/guardian sounds, Amulet, Erinys.
 */
export function peaceMinded(ctx: Ctx, def: MonsterDef): boolean {
  if (def.flags.includes('peaceful')) return true;
  if (def.flags.includes('hostile')) return false;
  if (def.flags.includes('gnome') || def.flags.includes('orc')) return false;
  const mal = def.alignment;
  if (Math.sign(mal) !== Math.sign(HERO_ALIGN_TYPE)) return false;
  return (
    ctx.rng.rn2(16 + (HERO_ALIGN_RECORD < -15 ? -15 : HERO_ALIGN_RECORD)) !== 0 &&
    ctx.rng.rn2(2 + Math.abs(mal)) !== 0
  );
}

const occupiedSet = (ctx: Ctx, level: Level): Set<number> => {
  const s = new Set<number>();
  for (const e of Object.values(ctx.state.entities)) {
    const p = e.c.pos;
    if (p && p.level === level.id && e.c.item === undefined) s.add(cellIndex(level, p.x, p.y));
  }
  return s;
};

/** ref: src/teleport.c goodpos(): passable, not a closed door, nobody there. */
function goodpos(
  level: Level,
  rules: CellRules,
  taken: Set<number>,
  x: number,
  y: number,
): boolean {
  if (!inBounds(level, x, y)) return false;
  const i = cellIndex(level, x, y);
  const t = level.cells[i] ?? 0;
  return rules.passable[t] === true && !rules.closedDoor[t] && !taken.has(i);
}

/**
 * The nearest good square to `from`: rings of increasing Chebyshev radius, each searched in
 * random order. ref: src/teleport.c enexto_core() (collect_coords)
 */
function enexto(
  ctx: Ctx,
  level: Level,
  rules: CellRules,
  taken: Set<number>,
  from: Pos,
): Pos | null {
  const maxR = Math.max(level.width, level.height);
  for (let r = 1; r <= maxR; r++) {
    const ring: Pos[] = [];
    for (let x = from.x - r; x <= from.x + r; x++)
      for (let y = from.y - r; y <= from.y + r; y++)
        if (Math.max(Math.abs(x - from.x), Math.abs(y - from.y)) === r) ring.push({ x, y });
    for (let i = ring.length - 1; i > 0; i--) {
      const j = ctx.rng.rn2(i + 1);
      const t = ring[i] as Pos;
      ring[i] = ring[j] as Pos;
      ring[j] = t;
    }
    for (const p of ring) if (goodpos(level, rules, taken, p.x, p.y)) return p;
  }
  return null;
}

/**
 * A random square for a new monster, out of the hero's sight.
 * ref: src/makemon.c makemon_rnd_goodpos(): 50 random tries, then a scan of the whole map
 * (first skipping visible squares, then not). Coordinates exclude the outermost columns/rows
 * like NetHack's rn1(COLNO-3, 2) / rn2(ROWNO).
 */
function randomGoodPos(ctx: Ctx, level: Level, rules: CellRules, taken: Set<number>): Pos | null {
  const sees = (x: number, y: number): boolean =>
    level.id === ctx.state.currentLevel && isVisible(ctx.state, cellIndex(level, x, y));
  let nx = 0;
  let ny = 0;
  for (let tries = 0; tries < 50; tries++) {
    nx = 1 + ctx.rng.rn2(Math.max(1, level.width - 3));
    ny = ctx.rng.rn2(level.height);
    if (!sees(nx, ny) && goodpos(level, rules, taken, nx, ny)) return { x: nx, y: ny };
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let dx = 0; dx < level.width; dx++)
      for (let dy = 0; dy < level.height; dy++) {
        const x = (dx + nx) % level.width;
        const y = (dy + ny) % level.height;
        if (pass === 0 && sees(x, y)) continue;
        if (goodpos(level, rules, taken, x, y)) return { x, y };
      }
  }
  return null;
}

export interface MakemonOpts {
  /** Level to create on; defaults to the hero's current level. */
  level?: LevelId;
  /** Never make a group (MM_NOGRP). */
  nogroup?: boolean;
  /** Make a group even though the type was given (random types always may). */
  group?: boolean;
  /** Start asleep (MM_ASLEEP). */
  asleep?: boolean;
  /** Always hostile (MM_ANGRY). */
  angry?: boolean;
  /** Use enexto() when the spot is taken (MM_ADJACENTOK). */
  adjacentOk?: boolean;
  /** No starting weapons, armor or gold (MM_NOINVENT). */
  noInventory?: boolean;
}

/**
 * Creates a monster; null def means a random type, null pos a random out-of-sight spot.
 * ref: src/makemon.c makemon(). New monsters have 0 movement (zeroed struct). Gender, items,
 * special-class setup and group chains of peaceful members follow only what applies here.
 */
export function makemon(
  ctx: Ctx,
  def: MonsterDef | null,
  pos: Pos | null,
  opts: MakemonOpts = {},
): EntityId | null {
  const level = getLevel(ctx.state, opts.level);
  const rules = cellRules(level, ctx.defs);
  const taken = occupiedSet(ctx, level);
  const anymon = def === null;

  let at: Pos;
  if (pos === null) {
    const p = randomGoodPos(ctx, level, rules, taken);
    if (!p) return null;
    at = p;
  } else if (taken.has(cellIndex(level, pos.x, pos.y))) {
    if (!opts.adjacentOk) return null;
    const p = enexto(ctx, level, rules, taken, pos);
    if (!p) return null;
    at = p;
  } else at = pos;
  if (!inBounds(level, at.x, at.y)) return null;

  const mdef = def ?? rndmonst(ctx, level.depth);
  if (!mdef) return null;

  const ulevel = heroLevel(ctx);
  const mlev = adjLev(mdef, level.depth, ulevel);
  const hp = newmonhp(ctx, mlev);
  const peaceful = opts.angry ? false : peaceMinded(ctx, mdef);
  const id = ctx.spawn({
    def: mdef.id,
    c: {
      pos: { level: level.id, x: at.x, y: at.y },
      actor: { energy: 0, speed: mdef.speed },
      hp: { cur: hp, max: hp },
      monster: { level: mlev, peaceful, asleep: opts.asleep === true, lastHero: null },
    },
  });

  if ((anymon || opts.group === true) && !opts.nogroup) {
    if (mdef.group === 'small' && ctx.rng.rn2(2) === 0) initgrp(ctx, mdef, at, 3, opts, level.id);
    else if (mdef.group === 'large') {
      if (ctx.rng.rn2(3) !== 0) initgrp(ctx, mdef, at, 10, opts, level.id);
      else initgrp(ctx, mdef, at, 3, opts, level.id);
    }
  }
  // ref: makemon(): after any group, "equip with weapons / armor" (m_initweap, m_initinv,
  // m_dowear(creation))
  if (!opts.noInventory) givePossessions(ctx, id, level.depth);
  return id;
}

/**
 * Extra members of a group around (x,y), each placed next to the previous one.
 * ref: src/makemon.c m_initgrp()
 */
function initgrp(
  ctx: Ctx,
  def: MonsterDef,
  at: Pos,
  n: number,
  opts: MakemonOpts,
  levelId: LevelId,
): void {
  const ul = heroLevel(ctx);
  let cnt = ctx.rng.rnd(n);
  cnt = Math.trunc(cnt / (ul < 3 ? 4 : ul < 5 ? 2 : 1));
  if (!cnt) cnt++;
  const level = getLevel(ctx.state, levelId);
  const rules = cellRules(level, ctx.defs);
  let mm = at;
  while (cnt-- > 0) {
    if (peaceMinded(ctx, def)) continue;
    const p = enexto(ctx, level, rules, occupiedSet(ctx, level), mm);
    if (!p) continue;
    mm = p;
    makemon(ctx, def, p, { ...opts, level: levelId, nogroup: true, angry: true });
  }
}

/**
 * Registers random spawning. (Level population is in mklev.ts, which fills each room.)
 */
export function registerGeneration(api: ModApi): void {
  // ref: src/allmain.c maybe_generate_rnd_mon()
  api.on('endOfTurn', (ctx) => {
    if (ctx.state.gameOver === null && ctx.rng.rn2(SPAWN_ODDS) === 0) makemon(ctx, null, null);
  });
}
