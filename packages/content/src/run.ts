import {
  DIRS,
  DIR_LIST,
  cellRules,
  checkStep,
  getLevel,
  inBounds,
  type ActionDef,
  type Ctx,
  type Dir,
  type Offer,
  type PlayerAction,
  type Pos,
  type TerrainDef,
} from '@nh/core';
import { monsterIdAt } from './combat';
import {
  beginSession,
  disturbed,
  heroPos,
  sessionOf,
  visibleMonsterAt,
  type Session,
} from './travel';

/**
 * NetHack's run modes (ref: include/context.h `context.run`, src/cmd.c set_move_cmd(), do_rush(),
 * do_run()). The names are ours; the numbers are `context.run`:
 *  - shift (1): Shift+direction ("run" in cmd.c). Moves until something interesting; follows
 *    corridors; does not stop beside doors or objects.
 *  - rush (2): the `g` prefix ("rush"). Moves in a straight line; stops where a corridor widens
 *    or branches and beside doors and other features.
 *  - run (3): the `G` prefix and Ctrl+direction. Like shift but stops for more things.
 */
export const RUN_MODES = { shift: 1, rush: 2, run: 3 } as const;
export type RunMode = keyof typeof RUN_MODES;

interface RunArgs {
  dir: Dir;
  mode: RunMode;
}

function parseArgs(action: PlayerAction): RunArgs | null {
  if (action.type !== 'mod') return null;
  const a = action.args as { dir?: unknown; mode?: unknown } | undefined;
  const dir = DIR_LIST.find((d) => d === a?.dir);
  const mode = (Object.keys(RUN_MODES) as RunMode[]).find((m) => m === a?.mode);
  return dir && mode ? { dir, mode } : null;
}

const dist2 = (ax: number, ay: number, bx: number, by: number): number =>
  (ax - bx) ** 2 + (ay - by) ** 2;

function terrainAt(ctx: Ctx, x: number, y: number): TerrainDef {
  const level = getLevel(ctx.state);
  const id = level.palette[level.cells[y * level.width + x] ?? 0];
  if (id === undefined) throw new Error('Unknown terrain');
  return ctx.defs.terrain(id);
}

/** ref: include/rm.h IS_OBSTRUCTED(): rock, walls and hidden doors/corridors. */
const obstructed = (t: TerrainDef): boolean => !t.passable && t.door === undefined;

/**
 * Stop running if we see something interesting next to us, and turn around a corner if that is the
 * only way to proceed (never turning more than twice the same way). Returns true to stop.
 * Ported: monsters, closed doors, corridors, other features. Not ported: traps, water and lava,
 * Blind, grid bugs, mimics (none exist yet).
 * ref: src/hack.c lookaround()
 */
function lookaround(ctx: Ctx, s: Session, run: number): boolean {
  const level = getLevel(ctx.state);
  const { x: ux, y: uy } = heroPos(ctx);
  let x0 = 0;
  let y0 = 0;
  let m0 = 1;
  let i0 = 9;
  let corrct = 0;
  let noturn = 0;
  const onRoom = terrainAt(ctx, ux, uy).id === 'nh:floor';
  for (let x = ux - 1; x <= ux + 1; x++) {
    for (let y = uy - 1; y <= uy + 1; y++) {
      const infront = x === ux + s.dx && y === uy + s.dy;
      if (!inBounds(level, x, y) || (x === ux && y === uy)) continue;
      const mtmp = monsterIdAt(ctx, { x, y }, level.id);
      // There are no pets, so no monster is a "safe" one.
      if (mtmp !== null && visibleMonsterAt(ctx, { x, y }) && (run !== 1 || infront)) return true;

      const t = terrainAt(ctx, x, y);
      if (t.id === 'nh:stone') continue; // stone is never interesting
      if (x === ux - s.dx && y === uy - s.dy) continue; // the square we are moving away from
      let corridor: boolean;
      if (obstructed(t) || t.id === 'nh:floor') continue; // more uninteresting terrain
      if (t.door === 'closed') {
        if (x !== ux && y !== uy) continue; // ignore if diagonal
        if (run !== 1) return true; // "You stop in front of the door."
        corridor = true; // orthogonal to a closed door, consider it a corridor
      } else if (t.id === 'nh:corr') {
        corridor = true;
      } else {
        // e.g. stairs, an open door or a doorway
        if (run === 1) corridor = true;
        else {
          if (mtmp !== null) continue;
          if ((x === ux - s.dx && y !== uy + s.dy) || (y === uy - s.dy && x !== ux + s.dx))
            continue;
          return true;
        }
      }
      if (corridor && !onRoom) {
        // running: x,y is a candidate for the way on
        if (run === 1 || run === 3) {
          // distance from x,y to the location we're moving to
          const i = dist2(x, y, ux + s.dx, uy + s.dy);
          if (i > 2) continue; // not on or directly adjacent to it
          // seen one corridor, and x,y is not directly orthogonally next to it: don't turn
          if (corrct === 1 && dist2(x, y, x0, y0) !== 1) noturn = 1;
          if (i < i0) {
            i0 = i;
            x0 = x;
            y0 = y;
            m0 = mtmp !== null ? 1 : 0;
          }
        }
        corrct++;
      }
    }
  }

  if (corrct > 1 && run === 2) return true; // "The corridor widens here."
  if (
    (run === 1 || run === 3) &&
    !noturn &&
    !m0 &&
    i0 &&
    (corrct === 1 || (corrct === 2 && i0 === 1))
  ) {
    // make sure that we do not turn too far
    let i: number;
    if (i0 === 2) {
      i = s.dx === y0 - uy && s.dy === ux - x0 ? 2 : -2; // straight turn right : left
    } else if (s.dx && s.dy) {
      i = (s.dx === s.dy && y0 === uy) || (s.dx !== s.dy && y0 !== uy) ? -1 : 1; // half turn left : right
    } else {
      i = (x0 - ux === y0 - uy && !s.dy) || (x0 - ux !== y0 - uy && s.dy) ? 1 : -1;
    }
    i += s.lastTurn;
    if (i <= 2 && i >= -2) {
      s.lastTurn = i;
      s.dx = x0 - ux;
      s.dy = y0 - uy;
    }
  }
  return false;
}

// ref: src/cmd.c do_rush(), do_run(), set_move_cmd(); src/hack.c domove_core(), lookaround()
const run: ActionDef = {
  id: 'nh:run',
  labelKey: 'action.run.rush',
  handles: 'mod',
  offer(ctx, target) {
    if (target.kind !== 'cell') return [];
    const here = heroPos(ctx);
    const { x, y } = target.pos;
    if (!inBounds(getLevel(ctx.state), x, y)) return [];
    const dx = x - here.x;
    const dy = y - here.y;
    // Adjacent cells keep their move/attack offers alone; a run starts from two cells away.
    if (Math.max(Math.abs(dx), Math.abs(dy)) <= 1) return [];
    // The nearest of the eight directions: straight unless the cell is off by more than 2:1.
    const sx = 2 * Math.abs(dx) <= Math.abs(dy) ? 0 : Math.sign(dx);
    const sy = 2 * Math.abs(dy) <= Math.abs(dx) ? 0 : Math.sign(dy);
    const dir = DIR_LIST.find((d) => DIRS[d].x === sx && DIRS[d].y === sy);
    if (!dir) return [];
    const mk = (mode: RunMode): Offer => ({
      action: { type: 'mod', action: 'nh:run', args: { dir, mode } },
      labelKey: `action.run.${mode}`,
      params: { dir: `@dir.${dir}` },
    });
    // `g` first: it is the one a double tap uses.
    return [mk('rush'), mk('run'), mk('shift')];
  },
  perform(ctx, action) {
    const args = parseArgs(action);
    if (!args) return 0;
    const run = RUN_MODES[args.mode];
    const s = beginSession(ctx, { dx: DIRS[args.dir].x, dy: DIRS[args.dir].y });
    // The first step is taken straight away; later ones look around first.
    if (s.moved && lookaround(ctx, s, run)) return 0;
    const level = getLevel(ctx.state);
    const here = heroPos(ctx);
    const to: Pos = { x: here.x + s.dx, y: here.y + s.dy };
    const dir = DIR_LIST.find((d) => DIRS[d].x === s.dx && DIRS[d].y === s.dy);
    if (!dir) return 0;
    // ref: src/hack.c domove_core(): a running hero does not attack a monster she can see.
    if (visibleMonsterAt(ctx, to)) return 0;
    const attacking = monsterIdAt(ctx, to, level.id) !== null;
    const check = checkStep(level, cellRules(level, ctx.defs), here, dir);
    if (!attacking && !check.ok) {
      // ref: src/hack.c test_move(): no auto-open while running; orthogonally it says so.
      if (check.reason === 'closedDoor' && (s.dx === 0 || s.dy === 0))
        ctx.emit({ type: 'msg', key: 'door.closed' });
      return 0;
    }
    const move = ctx.defs.actions.find((a) => a.handles === 'move');
    if (!move) return 0;
    const cost = move.perform(ctx, { type: 'move', dir });
    s.moved = true;
    if (attacking) ctx.interrupt();
    else if (run < 8) {
      // ref: src/hack.c domove_core(): running stops on a door or furniture (stairs)
      const now = heroPos(ctx);
      const t = terrainAt(ctx, now.x, now.y);
      if (t.door !== undefined || t.stairs !== undefined) ctx.interrupt();
    }
    return cost;
  },
  continues(ctx) {
    const s = sessionOf(ctx);
    if (!s) return false;
    return !disturbed(ctx, s);
  },
};

export const RUN_ACTIONS: readonly ActionDef[] = [run];
