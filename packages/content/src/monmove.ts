// Monster movement and turn logic: mcalcmove, disturb, mfndpos, m_move and dochug.
import {
  cellIndex,
  cellRules,
  getLevel,
  getPlayer,
  inBounds,
  isVisible,
  NORMAL_SPEED,
  type CellRules,
  type Ctx,
  type EntityId,
  type Json,
  type Level,
  type MonsterDef,
  type Pos,
  type Rng,
} from '@nh/core';
import { openDoorAt } from './actions';
import { monsterAttack } from './combat';

/** ref: include/hack.h BOLT_LIM */
export const BOLT_LIM = 8;
/** ref: include/mondata.h MTSZ (length of mtrack) */
export const MTSZ = 4;
/**
 * The stub hero is a Valkyrie, who gains the Stealth intrinsic at experience level 3.
 * ref: src/attrib.c val_abil[] `{ 3, &(HStealth), "stealthy", "" }`
 */
export const HERO_STEALTH_LEVEL = 3;

/** ref: include/hacklib.h dist2() */
export const dist2 = (x0: number, y0: number, x1: number, y1: number): number =>
  (x0 - x1) * (x0 - x1) + (y0 - y1) * (y0 - y1);

/**
 * Movement points a monster gains this turn: its speed randomly rounded to a multiple of
 * NORMAL_SPEED (so a speed-6 monster gets 12 half of the time, 0 otherwise).
 * ref: src/mon.c mcalcmove() with m_moving TRUE; no MSLOW/MFAST, no steed.
 */
export function mcalcmove(rng: Rng, speed: number): number {
  let mmove = speed;
  const mmoveAdj = mmove % NORMAL_SPEED;
  mmove -= mmoveAdj;
  if (rng.rn2(NORMAL_SPEED) < mmoveAdj) mmove += NORMAL_SPEED;
  return mmove;
}

/**
 * Whether the straight (Bresenham) line from (x1,y1) to (x2,y2) is free of opaque cells; the
 * end points themselves are not checked. Out-of-bounds counts as blocked.
 * ref: src/vision.c clear_path() / q1_path..q4_path()
 */
export function clearPath(
  level: Level,
  opaque: readonly boolean[],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): boolean {
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  const sx = Math.sign(x2 - x1);
  const sy = Math.sign(y2 - y1);
  let x = x1;
  let y = y1;
  const clear = (): boolean =>
    inBounds(level, x, y) && opaque[level.cells[cellIndex(level, x, y)] ?? 0] !== true;
  if (dy > dx) {
    let err = 2 * dx - dy;
    for (let k = dy - 1; k > 0; k--) {
      if (err >= 0) {
        x += sx;
        err -= 2 * dy;
      }
      y += sy;
      err += 2 * dx;
      if (!clear()) return false;
    }
  } else {
    let err = 2 * dy - dx;
    for (let k = dx - 1; k > 0; k--) {
      if (err >= 0) {
        y += sy;
        err -= 2 * dx;
      }
      x += sx;
      err += 2 * dy;
      if (!clear()) return false;
    }
  }
  return true;
}

/** ref: include/mondata.h verysmall(): msize < MZ_SMALL */
const verySmall = (def: MonsterDef): boolean => def.size === 'tiny';
/** ref: include/mondata.h bigmonst(): msize >= MZ_LARGE */
const bigMonst = (def: MonsterDef): boolean =>
  def.size === 'large' || def.size === 'huge' || def.size === 'gigantic';
/** ref: include/mondata.h is_wanderer() */
const isWanderer = (def: MonsterDef): boolean => def.flags.includes('wander');
/** ref: include/mondata.h S_BAT class (every 'B' in our roster). */
const isBatClass = (def: MonsterDef): boolean => def.glyph.ch === 'B';

/** ref: src/mon.c monnear() */
const monnear = (mx: number, my: number, x: number, y: number): boolean => dist2(mx, my, x, y) < 3;

const monCount = (ctx: Ctx, id: EntityId) => {
  const e = ctx.state.entities[String(id)];
  const m = e?.c.monster;
  const pos = e?.c.pos;
  if (!e || !m || !pos) throw new Error(`Entity ${id} is not a placed monster`);
  return { e, m, pos, def: ctx.defs.monster(e.def) };
};

/**
 * Possibly awaken a sleeping monster; true if it woke up.
 * ref: src/monmove.c disturb(). The hero's line of sight is `couldsee()` (ignores light).
 * The Stealth test uses the Valkyrie's XL 3 intrinsic. Not applicable to our roster: ettin,
 * nymph, jabberwock, leprechaun, mimics, Aggravate Monster.
 */
export function disturb(ctx: Ctx, id: EntityId): boolean {
  const { m, pos, def } = monCount(ctx, id);
  const hero = getPlayer(ctx.state);
  const hp = hero.c.pos;
  if (!hp) return false;
  const level = getLevel(ctx.state, pos.level);
  const stealth = (hero.c.experience?.level ?? 1) >= HERO_STEALTH_LEVEL;
  if (
    dist2(pos.x, pos.y, hp.x, hp.y) <= 100 &&
    !stealth &&
    clearPath(level, cellRules(level, ctx.defs).opaque, hp.x, hp.y, pos.x, pos.y) &&
    (def.glyph.ch === 'd' || def.glyph.ch === '@' || ctx.rng.rn2(7) === 0)
  ) {
    // ref: src/mon.c wake_msg()
    const idx = cellIndex(level, pos.x, pos.y);
    if (m.asleep && isVisible(ctx.state, idx)) {
      const e = ctx.state.entities[String(id)];
      ctx.emit({
        type: 'msg',
        key: m.peaceful ? 'mon.wakes_up_calm' : 'mon.wakes_up',
        params: { mon: `@${e?.def ?? ''}` },
      });
    }
    m.asleep = false;
    return true;
  }
  return false;
}

interface Candidate {
  x: number;
  y: number;
  /** The square holds the hero (ALLOW_U). */
  hero: boolean;
}

/**
 * Squares the monster could move to this turn, in mfndpos() order (x outer, y inner).
 * ref: src/mon.c mfndpos() with mon_allowflags(): hostile monsters may "move" onto the hero
 * (ALLOW_U), monsters that can open doors may enter closed doors (OPENDOOR). Walls, other
 * monsters, intact-door diagonals and tight squeezes for big monsters are rejected. Not
 * ported: water/lava, traps, boulders, scary squares, long worms, NODIAG, digging, wall-walking.
 */
export function mfndpos(
  ctx: Ctx,
  level: Level,
  rules: CellRules,
  id: EntityId,
  heroPos: Pos,
): Candidate[] {
  const { m, pos, def } = monCount(ctx, id);
  const canOpen = !(def.flags.includes('nohands') || verySmall(def));
  const taken = new Set<number>();
  for (const [key, ent] of Object.entries(ctx.state.entities)) {
    const p = ent.c.pos;
    if (p && p.level === level.id && Number(key) !== id) taken.add(cellIndex(level, p.x, p.y));
  }
  const rock = (x: number, y: number): boolean => {
    if (!inBounds(level, x, y)) return true;
    const i = level.cells[cellIndex(level, x, y)] ?? 0;
    return !rules.passable[i] && !rules.closedDoor[i];
  };
  const here = level.cells[cellIndex(level, pos.x, pos.y)] ?? 0;
  const out: Candidate[] = [];
  for (let nx = pos.x - 1; nx <= pos.x + 1; nx++) {
    for (let ny = pos.y - 1; ny <= pos.y + 1; ny++) {
      if ((nx === pos.x && ny === pos.y) || !inBounds(level, nx, ny)) continue;
      const to = level.cells[cellIndex(level, nx, ny)] ?? 0;
      const closed = rules.closedDoor[to] === true;
      if (!rules.passable[to] && !closed) continue;
      if (closed && !canOpen) continue;
      const diagonal = nx !== pos.x && ny !== pos.y;
      // ref: mfndpos() "first diagonal checks": no diagonal moves into or out of an intact door
      if (diagonal && (rules.intactDoor[here] || rules.intactDoor[to])) continue;
      const isHero = nx === heroPos.x && ny === heroPos.y;
      if (isHero) {
        if (m.peaceful) continue; // no ALLOW_U
      } else if (taken.has(cellIndex(level, nx, ny))) {
        continue; // no ALLOW_M / ALLOW_MDISP
      }
      // ref: mfndpos() tight squeeze: bad_rock on both sides and cant_squeeze_thru() (too big)
      if (diagonal && rock(pos.x, ny) && rock(nx, pos.y) && bigMonst(def)) continue;
      out.push({ x: nx, y: ny, hero: isHero });
    }
  }
  return out;
}

/** The monster's recent positions, newest first, flat [x0,y0,x1,y1,...]. ref: mtmp->mtrack */
function getTrack(ctx: Ctx, id: EntityId): number[] {
  const nh = ctx.state.modData['nh'];
  if (nh === null || typeof nh !== 'object' || Array.isArray(nh)) return [];
  const all = nh['mtrack'];
  if (all === null || typeof all !== 'object' || Array.isArray(all)) return [];
  const t = all[String(id)];
  return Array.isArray(t) ? (t.filter((v) => typeof v === 'number') as number[]) : [];
}

/** ref: src/monmove.c mon_track_add() */
function trackAdd(ctx: Ctx, id: EntityId, x: number, y: number): void {
  const t = [x, y, ...getTrack(ctx, id)].slice(0, MTSZ * 2);
  const md = ctx.state.modData;
  const nh = md['nh'];
  const root: { [k: string]: Json } =
    nh !== null && typeof nh === 'object' && !Array.isArray(nh) ? nh : {};
  const prev = root['mtrack'];
  const all: { [k: string]: Json } =
    prev !== null && typeof prev === 'object' && !Array.isArray(prev) ? prev : {};
  all[String(id)] = t;
  root['mtrack'] = all;
  md['nh'] = root;
}

type MoveStatus = 'moved' | 'nothing';

/**
 * Chooses and performs one step. ref: src/monmove.c m_move() and postmov().
 * The goal is where the monster thinks the hero is (set_apparxy: the true position, since we
 * have no invisibility or displacement). appr is 1 (approach) for hostiles, 0 (wander) for
 * peacefuls and, one time in three, for bats. Not ported: fleeing, item pickup, ranged
 * "balking", tracking the hero's trail, tunneling, special movers, traps.
 */
function mMove(ctx: Ctx, id: EntityId, heroPos: Pos): MoveStatus {
  const { m, pos, def } = monCount(ctx, id);
  const level = getLevel(ctx.state, pos.level);
  const rules = cellRules(level, ctx.defs);
  const ggx = heroPos.x;
  const ggy = heroPos.y;

  let appr = 1;
  if (m.peaceful || (isBatClass(def) && ctx.rng.rn2(3) === 0)) appr = 0;

  const cands = mfndpos(ctx, level, rules, id, heroPos);
  const cnt = cands.length;
  if (cnt === 0) return 'nothing'; // MMOVE_NOMOVES
  const track = getTrack(ctx, id);
  const jcnt = Math.min(MTSZ, cnt - 1);
  let chcnt = 0;
  let chosen: Candidate | null = null;
  let nidist = dist2(pos.x, pos.y, ggx, ggy);
  for (const c of cands) {
    if (appr !== 0) {
      // ref: m_move() "mtrack" avoidance of recently visited squares
      let skip = false;
      for (let j = 0; j < jcnt && !skip; j++) {
        if (track[2 * j] === c.x && track[2 * j + 1] === c.y && ctx.rng.rn2(4 * (cnt - j)) !== 0)
          skip = true;
      }
      if (skip) continue;
    }
    const ndist = dist2(c.x, c.y, ggx, ggy);
    const nearer = ndist < nidist;
    if ((appr === 1 && nearer) || (appr === 0 && ctx.rng.rn2(++chcnt) === 0) || chosen === null) {
      chosen = c;
      nidist = ndist;
    }
  }
  if (chosen === null) return 'nothing';
  // ref: m_move() "if ALLOW_U, attack this spot": the monster stays put and attacks in dochug()
  if (chosen.hero) return 'nothing';

  const from = { x: pos.x, y: pos.y };
  trackAdd(ctx, id, from.x, from.y);
  pos.x = chosen.x;
  pos.y = chosen.y;
  ctx.emit({ type: 'moved', id, from, to: { x: chosen.x, y: chosen.y } });

  // ref: postmov(): open a closed door the monster just stepped onto
  const here = level.cells[cellIndex(level, pos.x, pos.y)] ?? 0;
  if (rules.closedDoor[here]) {
    openDoorAt(ctx, level, pos);
    const seen = isVisible(ctx.state, cellIndex(level, pos.x, pos.y));
    ctx.emit({ type: 'doorOpened', pos: { x: pos.x, y: pos.y } });
    ctx.emit(
      seen
        ? { type: 'msg', key: 'door.mon_opens', params: { mon: `@${def.id}` } }
        : { type: 'msg', key: 'door.hear_open' },
    );
  }
  return 'moved';
}

/**
 * One monster action. ref: src/monmove.c dochug().
 * Phase one: sleeping monsters stay asleep unless disturb() wakes them. Phase three: a monster
 * that is not next to the hero, is peaceful, or (wanderers, e.g. bats) rolls 1/4, moves via
 * m_move(); one that moved does not attack in the same action. Phase four: a hostile adjacent
 * monster attacks. Not ported: fleeing/scared, confusion, invisibility, spellcasting,
 * defensive/misc item use, weapon wielding, special per-monster behavior.
 */
export function dochug(ctx: Ctx, id: EntityId): void {
  const { m, pos } = monCount(ctx, id);
  const hero = getPlayer(ctx.state);
  const hp = hero.c.pos;
  if (!hp || hp.level !== pos.level) return;
  if (m.asleep && !disturb(ctx, id)) return;

  // ref: set_apparxy(): the monster knows where the hero is
  const heroPos = { x: hp.x, y: hp.y };
  m.lastHero = heroPos;

  const def = ctx.defs.monster(ctx.state.entities[String(id)]?.def ?? 'nh:none');
  const inrange = dist2(pos.x, pos.y, heroPos.x, heroPos.y) <= BOLT_LIM * BOLT_LIM;
  const nearby = inrange && monnear(pos.x, pos.y, heroPos.x, heroPos.y);

  if (!nearby || (isWanderer(def) && ctx.rng.rn2(4) === 0) || m.peaceful) {
    if (mMove(ctx, id, heroPos) === 'moved') return;
  }
  if (!m.peaceful && inrange && monnear(pos.x, pos.y, heroPos.x, heroPos.y)) {
    monsterAttack(ctx, id);
  }
}
