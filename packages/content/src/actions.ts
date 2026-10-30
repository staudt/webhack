import {
  DIRS,
  DIR_LIST,
  NORMAL_SPEED,
  cellIndex,
  cellRules,
  checkStep,
  getLevel,
  getPlayer,
  inBounds,
  type ActionDef,
  type Offer,
  type Ctx,
  type Dir,
  type PlayerAction,
  type Pos,
} from '@nh/core';
import { T } from './terrain';

function playerAt(ctx: Ctx): Pos {
  const pos = getPlayer(ctx.state).c.pos;
  if (!pos) throw new Error('Player has no position');
  return { x: pos.x, y: pos.y };
}

/** The direction from `from` to an adjacent cell, or null if not adjacent (or the same cell). */
function dirTo(from: Pos, to: Pos): Dir | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) !== 1) return null;
  return DIR_LIST.find((d) => DIRS[d].x === dx && DIRS[d].y === dy) ?? null;
}

const move: ActionDef = {
  id: 'nh:move',
  labelKey: 'action.move',
  handles: 'move',
  offer(ctx, target) {
    if (target.kind !== 'cell') return [];
    const from = playerAt(ctx);
    const dir = dirTo(from, target.pos);
    if (!dir) return [];
    const level = getLevel(ctx.state);
    const check = checkStep(level, cellRules(level, ctx.defs), from, dir);
    if (!check.ok && check.reason !== 'closedDoor') return [];
    const offer: Offer = {
      action: { type: 'move', dir },
      labelKey: 'action.move',
      params: { dir: `@dir.${dir}` },
    };
    return [offer];
  },
  perform(ctx, action: PlayerAction) {
    if (action.type !== 'move') throw new Error('nh:move can only perform move actions');
    const player = getPlayer(ctx.state);
    const pos = player.c.pos;
    if (!pos) throw new Error('Player has no position');
    const level = getLevel(ctx.state, pos.level);
    const from = { x: pos.x, y: pos.y };
    const d = DIRS[action.dir];
    const to = { x: from.x + d.x, y: from.y + d.y };
    const check = checkStep(level, cellRules(level, ctx.defs), from, action.dir);
    if (check.ok) {
      // ref: src/hack.c domove()
      pos.x = to.x;
      pos.y = to.y;
      ctx.emit({ type: 'moved', id: player.id, from, to });
      return NORMAL_SPEED;
    }
    switch (check.reason) {
      case 'closedDoor': {
        // ref: src/hack.c test_move() flags.autoopen -> src/lock.c doopen_indir()
        // A door in a vertical wall has rock/wall to its north and south.
        const passableAt = (x: number, y: number): boolean => {
          if (!inBounds(level, x, y)) return false;
          const id = level.palette[level.cells[cellIndex(level, x, y)] ?? 0];
          return id !== undefined && ctx.defs.terrain(id).passable;
        };
        const vertical = !passableAt(to.x, to.y - 1) && !passableAt(to.x, to.y + 1);
        const open = vertical ? T.door_open_v : T.door_open_h;
        let pi = level.palette.indexOf(open);
        if (pi === -1) pi = level.palette.push(open) - 1;
        level.cells[cellIndex(level, to.x, to.y)] = pi;
        ctx.emit({ type: 'doorOpened', pos: to });
        ctx.emit({ type: 'msg', key: 'door.opens' });
        return NORMAL_SPEED;
      }
      case 'blocked':
      case 'diagonalDoor': {
        // ref: src/hack.c domove() context.move = 0; nothing is printed without mention_walls
        const id = level.palette[level.cells[cellIndex(level, to.x, to.y)] ?? 0];
        if (id !== undefined) ctx.emit({ type: 'blocked', pos: to, terrain: id });
        return 0;
      }
      case 'bounds':
        return 0;
    }
  },
};

const wait: ActionDef = {
  id: 'nh:wait',
  labelKey: 'action.wait',
  handles: 'wait',
  offer: (_ctx, target) =>
    target.kind === 'self'
      ? [{ action: { type: 'wait' }, labelKey: 'action.wait' }]
      : [],
  // ref: src/cmd.c donull()
  perform: () => NORMAL_SPEED,
};

const search: ActionDef = {
  id: 'nh:search',
  labelKey: 'action.search',
  handles: 'search',
  offer: (_ctx, target) =>
    target.kind === 'self'
      ? [{ action: { type: 'search' }, labelKey: 'action.search' }]
      : [],
  perform(ctx) {
    // ref: src/detect.c dosearch0(); M1 has no secret doors, traps or hidden monsters to find
    ctx.emit({ type: 'searched' });
    return NORMAL_SPEED;
  },
};

export const ACTIONS: readonly ActionDef[] = [move, wait, search];
