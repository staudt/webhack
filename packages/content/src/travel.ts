import {
  DIRS,
  DIR_LIST,
  cellRules,
  checkStep,
  computeVisible,
  getLevel,
  getPlayer,
  inBounds,
  isVisible,
  sortedIds,
  type ActionDef,
  type Ctx,
  type Dir,
  type Level,
  type PlayerAction,
  type Pos,
} from '@nh/core';

export function heroPos(ctx: Ctx): Pos {
  const pos = getPlayer(ctx.state).c.pos;
  if (!pos) throw new Error('Player has no position');
  return { x: pos.x, y: pos.y };
}

function targetOf(action: PlayerAction): Pos | null {
  if (action.type !== 'mod') return null;
  const a = action.args as { x?: unknown; y?: unknown } | undefined;
  return typeof a?.x === 'number' && typeof a.y === 'number' ? { x: a.x, y: a.y } : null;
}

/** Is a monster the hero can currently see standing on `pos`? Returns it with its peaceful flag. */
export function visibleMonsterAt(ctx: Ctx, pos: Pos): { peaceful: boolean } | null {
  for (const e of ctx.query.describe(pos).entities) {
    const m = ctx.state.entities[String(e.id)]?.c.monster;
    if (m) return { peaceful: m.peaceful };
  }
  return null;
}

/**
 * ref: src/hack.c lookaround(), context.run == 8: any visible monster that is not a "safe"
 * (peaceful) one in the 8 neighbouring cells stops the multi-turn move.
 */
function hostileAdjacent(ctx: Ctx): boolean {
  const here = heroPos(ctx);
  return DIR_LIST.some((d) => {
    const m = visibleMonsterAt(ctx, { x: here.x + DIRS[d].x, y: here.y + DIRS[d].y });
    return m !== null && !m.peaceful;
  });
}

// ---------------------------------------------------------------------------------------------
// state of one multi-turn command (travel, run)

/** What the hero knew at the end of the last step, to notice disturbances. */
export interface Watch {
  hp: number;
  /** Visible, non-peaceful monsters within BOLT_LIM + 1. */
  seen: number[];
}

/**
 * Per-command state (NetHack's u.dx/u.dy, last_str_turn, gt.travelmap, multi). It is not part of
 * GameState: it lives only while the engine repeats one action object inside a single step() call.
 */
export interface Session {
  /** Set by continues(); a perform() that finds it false starts a fresh session. */
  live: boolean;
  watch: Watch;
  /** Travel: cell indices the hero has left during this travel (ref: gt.travelmap). */
  visited: Set<number>;
  /** Run: current direction (u.dx, u.dy), turn tally (u.last_str_turn) and whether it has moved. */
  dx: number;
  dy: number;
  lastTurn: number;
  moved: boolean;
}

const sessions = new WeakMap<object, Session>();

export function beginSession(
  ctx: Ctx,
  action: PlayerAction,
  init: Pick<Session, 'dx' | 'dy'> = { dx: 0, dy: 0 },
): Session {
  const prev = sessions.get(action);
  if (prev?.live) {
    prev.live = false;
    return prev;
  }
  const s: Session = {
    live: false,
    watch: watchOf(ctx),
    visited: new Set(),
    dx: init.dx,
    dy: init.dy,
    lastTurn: 0,
    moved: false,
  };
  sessions.set(action, s);
  return s;
}

export function sessionOf(action: PlayerAction): Session | undefined {
  return sessions.get(action);
}

/** ref: src/monmove.c dochugw(): BOLT_LIM + 1 */
const NOTICE_DIST2 = 9 * 9;

export function watchOf(ctx: Ctx): Watch {
  const hero = getPlayer(ctx.state);
  const here = heroPos(ctx);
  const level = getLevel(ctx.state);
  const seen: number[] = [];
  for (const id of sortedIds(ctx.state)) {
    const e = ctx.state.entities[String(id)];
    const m = e?.c.monster;
    const p = e?.c.pos;
    if (!e || !m || m.peaceful || !p || p.level !== level.id) continue;
    if (!isVisible(ctx.state, p.y * level.width + p.x)) continue;
    if ((p.x - here.x) ** 2 + (p.y - here.y) ** 2 > NOTICE_DIST2) continue;
    seen.push(id);
  }
  return { hp: hero.c.hp?.cur ?? 0, seen };
}

/**
 * Called after each step of a multi-turn command: true when the hero was hurt or a hostile
 * monster came into view, which ends the command. Refreshes the baseline either way.
 * ref: src/mhitu.c mattacku() stop_occupation(), src/monmove.c dochugw() (see DEVIATIONS.md)
 */
export function disturbed(ctx: Ctx, s: Session): boolean {
  const now = watchOf(ctx);
  const was = s.watch;
  s.watch = now;
  return now.hp < was.hp || now.seen.some((id) => !was.seen.includes(id));
}

// ---------------------------------------------------------------------------------------------
// findtravelpath()

/** ref: src/decl.c dirs_ord[]: the order findtravelpath() tries directions in */
const DIRS_ORD: readonly Dir[] = ['w', 'n', 'e', 's', 'nw', 'ne', 'se', 'sw'];

const sgn = (n: number): number => (n > 0 ? 1 : n < 0 ? -1 : 0);
const distmin = (a: Pos, b: Pos): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const dist2 = (a: Pos, b: Pos): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/** The level as the hero remembers it: remembered terrain wins over the real one. */
function knownLevel(ctx: Ctx, level: Level): Level {
  const memory = ctx.state.memory[level.id];
  return {
    ...level,
    cells: level.cells.map((c, i) => {
      const m = memory?.[i] ?? -1;
      return m >= 0 ? m : c;
    }),
  };
}

/** couldsee(): line of sight from the hero, whether lit or not. ref: src/vision.c */
function couldSee(ctx: Ctx, level: Level, here: Pos): Uint8Array {
  const rules = cellRules(level, ctx.defs);
  const lit = level.lit.map(() => 1 as const);
  const out = new Uint8Array(level.width * level.height);
  for (const i of computeVisible({ ...level, lit }, rules, here)) out[i] = 1;
  return out;
}

/**
 * The breadth-first search shared by both passes of findtravelpath(): `travel[]` holds the radius
 * at which each cell was reached from `from`. In guess mode only cells the hero could see are
 * entered and `skip` (the target) is never added.
 * ref: src/hack.c findtravelpath() label noguess
 */
function travelMatrix(
  ctx: Ctx,
  level: Level,
  known: Level,
  see: Uint8Array,
  from: Pos,
  guess: boolean,
  stopAt: Pos,
): { travel: Int32Array; step: Pos | null } {
  const { width } = level;
  const rules = cellRules(known, ctx.defs);
  const memory = ctx.state.memory[level.id];
  const travel = new Int32Array(width * level.height);
  let cur: number[] = [from.y * width + from.x];
  let radius = 1;
  while (cur.length > 0) {
    const next: number[] = [];
    for (const ci of cur) {
      const x = ci % width;
      const y = (ci - x) / width;
      let repeated = false;
      for (const d of DIRS_ORD) {
        const nx = x + DIRS[d].x;
        const ny = y + DIRS[d].y;
        if (!inBounds(level, nx, ny)) continue;
        const ni = ny * width + nx;
        if (guess && see[ni] !== 1) continue;
        // closed doors cause a delay, so prefer another path
        if (rules.closedDoor[known.cells[ci] ?? 0] && (travel[ci] ?? 0) > radius - 3) {
          if (!repeated) {
            next.push(ci);
            repeated = true;
          }
          continue;
        }
        const chk = checkStep(known, rules, { x, y }, d);
        if (!chk.ok && chk.reason !== 'closedDoor') continue;
        if ((memory?.[ni] ?? -1) < 0 && see[ni] !== 1) continue; // levl.seenv || couldsee
        if (nx === stopAt.x && ny === stopAt.y) {
          if (!guess) return { travel, step: { x, y } };
        } else if (!travel[ni]) {
          next.push(ni);
          travel[ni] = radius;
        }
      }
    }
    cur = next;
    radius++;
  }
  return { travel, step: null };
}

/**
 * Guess mode: the cell the hero could see and reach that is nearest to `target`, as findtravelpath()
 * picks it (Chebyshev distance first, then squared distance among equals, preferring short walks).
 * ref: src/hack.c findtravelpath() mode == TRAVP_GUESS
 */
export function guessPoint(ctx: Ctx, here: Pos, target: Pos): Pos {
  const level = getLevel(ctx.state);
  const known = knownLevel(ctx, level);
  const see = couldSee(ctx, level, here);
  const { travel } = travelMatrix(ctx, level, known, see, here, true, target);
  let best = { x: here.x, y: here.y };
  let dist = distmin(target, here);
  let d2 = dist2(target, here);
  let ptrav = level.width * level.height;
  for (let x = 0; x < level.width; x++) {
    for (let y = 0; y < level.height; y++) {
      const i = y * level.width + x;
      const ctrav = travel[i] ?? 0;
      if (see[i] !== 1 || ctrav <= 0) continue;
      const here2 = { x, y };
      const nxtdist = distmin(target, here2);
      if (nxtdist === dist && ctrav < ptrav) {
        const nd2 = dist2(target, here2);
        if (nd2 < d2) {
          // prefer non-zigzag path
          best = here2;
          d2 = nd2;
          ptrav = ctrav;
        }
      } else if (nxtdist < dist) {
        best = here2;
        dist = nxtdist;
        d2 = dist2(target, here2);
        ptrav = ctrav;
      }
    }
  }
  return best;
}

/** The cell to step onto on the way to `goal`, searching from the goal back to the hero. */
function stepToward(ctx: Ctx, here: Pos, goal: Pos): Pos | null {
  const level = getLevel(ctx.state);
  const known = knownLevel(ctx, level);
  const see = couldSee(ctx, level, here);
  return travelMatrix(ctx, level, known, see, goal, false, here).step;
}

/**
 * Where travel goes next from `here` toward `target`, or null. Tries the remembered path first,
 * then the guess: the nearest reachable point, or one step in the target's general direction when
 * the hero is already the nearest point.
 * ref: src/hack.c domove_core() findtravelpath(TRAVP_TRAVEL) then findtravelpath(TRAVP_GUESS)
 */
function nextTravelCell(ctx: Ctx, here: Pos, target: Pos): { cell: Pos; revisit: boolean } | null {
  const path = ctx.query.pathTo(target);
  const first = path?.[0];
  if (first) return { cell: first, revisit: true };
  if (here.x === target.x && here.y === target.y) return null;
  const guess = guessPoint(ctx, here, target);
  if (guess.x === here.x && guess.y === here.y) {
    // no guesses, just go in the general direction
    const dx = sgn(target.x - here.x);
    const dy = sgn(target.y - here.y);
    const dir = DIR_LIST.find((d) => DIRS[d].x === dx && DIRS[d].y === dy);
    if (!dir) return null;
    const level = getLevel(ctx.state);
    if (!checkStep(level, cellRules(level, ctx.defs), here, dir).ok) return null; // TEST_MOVE
    return { cell: { x: here.x + dx, y: here.y + dy }, revisit: false };
  }
  const cell = stepToward(ctx, here, guess);
  return cell ? { cell, revisit: true } : null;
}

// ref: src/cmd.c dotravel(), src/hack.c findtravelpath()
const travel: ActionDef = {
  id: 'nh:travel',
  labelKey: 'action.travel',
  handles: 'mod',
  offer(ctx, target) {
    if (target.kind !== 'cell') return [];
    const here = heroPos(ctx);
    const { x, y } = target.pos;
    if (!inBounds(getLevel(ctx.state), x, y)) return [];
    if (Math.max(Math.abs(x - here.x), Math.abs(y - here.y)) <= 1) return []; // own or adjacent cell
    // Any other cell: a target that cannot be reached makes the hero walk toward it as far as
    // she knows the way (the "guess" of findtravelpath()).
    return [
      { action: { type: 'mod', action: 'nh:travel', args: { x, y } }, labelKey: 'action.travel' },
    ];
  },
  perform(ctx, action) {
    const target = targetOf(action);
    if (!target) return 0;
    const session = beginSession(ctx, action);
    const here = heroPos(ctx);
    const found = nextTravelCell(ctx, here, target);
    if (!found) return 0;
    const next = found.cell;
    const dir: Dir | undefined = DIR_LIST.find(
      (d) => here.x + DIRS[d].x === next.x && here.y + DIRS[d].y === next.y,
    );
    if (!dir) return 0;
    // ref: src/hack.c domove_core(): while running/traveling the hero never attacks a monster
    // she can see; the move is cancelled with no time passing.
    if (visibleMonsterAt(ctx, next)) return 0;
    const move = ctx.defs.actions.find((a) => a.handles === 'move');
    if (!move) return 0;
    // ref: src/hack.c findtravelpath(): stepping onto a cell already left during this travel
    // means going in circles: take this step and stop.
    const width = getLevel(ctx.state).width;
    if (found.revisit && session.visited.has(next.y * width + next.x)) {
      ctx.emit({ type: 'msg', key: 'travel.unsure' });
      ctx.interrupt();
    }
    session.visited.add(here.y * width + here.x);
    // Delegating keeps door auto-open, diagonal rules etc. identical to walking.
    return move.perform(ctx, { type: 'move', dir });
  },
  continues(ctx, action) {
    const target = targetOf(action);
    if (!target) return false;
    const here = heroPos(ctx);
    if (here.x === target.x && here.y === target.y) return false;
    // ref: src/hack.c lookaround(): travel does not stop at doors or stairs, only for monsters.
    if (hostileAdjacent(ctx)) return false;
    const s = sessionOf(action);
    if (!s) return false;
    s.live = true;
    return !disturbed(ctx, s);
  },
};

export const TRAVEL_ACTIONS: readonly ActionDef[] = [travel];
