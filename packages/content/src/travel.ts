import {
  DIRS,
  DIR_LIST,
  getPlayer,
  type ActionDef,
  type Ctx,
  type Dir,
  type PlayerAction,
  type Pos,
} from '@nh/core';

function heroPos(ctx: Ctx): Pos {
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
function visibleMonsterAt(ctx: Ctx, pos: Pos): { peaceful: boolean } | null {
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

// ref: src/cmd.c dotravel(), src/hack.c findtravelpath()
const travel: ActionDef = {
  id: 'nh:travel',
  labelKey: 'action.travel',
  handles: 'mod',
  offer(ctx, target) {
    if (target.kind !== 'cell') return [];
    const here = heroPos(ctx);
    const { x, y } = target.pos;
    if (Math.max(Math.abs(x - here.x), Math.abs(y - here.y)) <= 1) return []; // own or adjacent cell
    if (!ctx.query.describe(target.pos).remembered) return [];
    if (!ctx.query.pathTo(target.pos)) return [];
    return [
      { action: { type: 'mod', action: 'nh:travel', args: { x, y } }, labelKey: 'action.travel' },
    ];
  },
  perform(ctx, action) {
    const target = targetOf(action);
    if (!target) return 0;
    // DEVIATION: findtravelpath() falls back to "guess" mode (walk to the reachable cell nearest
    // the target); here an unreachable target does nothing and takes no time.
    const path = ctx.query.pathTo(target);
    const next = path?.[0];
    if (!next) return 0;
    const here = heroPos(ctx);
    const dir: Dir | undefined = DIR_LIST.find(
      (d) => here.x + DIRS[d].x === next.x && here.y + DIRS[d].y === next.y,
    );
    if (!dir) return 0;
    // ref: src/hack.c domove_core(): while running/traveling the hero never attacks a monster
    // she can see; the move is cancelled with no time passing.
    if (visibleMonsterAt(ctx, next)) return 0;
    const move = ctx.defs.actions.find((a) => a.handles === 'move');
    if (!move) return 0;
    // Delegating keeps door auto-open, diagonal rules etc. identical to walking.
    return move.perform(ctx, { type: 'move', dir });
  },
  continues(ctx, action) {
    const target = targetOf(action);
    if (!target) return false;
    const here = heroPos(ctx);
    if (here.x === target.x && here.y === target.y) return false;
    // ref: src/hack.c lookaround(): travel does not stop at doors or stairs, only for monsters.
    return !hostileAdjacent(ctx);
  },
};

export const TRAVEL_ACTIONS: readonly ActionDef[] = [travel];
