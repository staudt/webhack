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
  type DefId,
  type Dir,
  type Level,
  type PlayerAction,
  type Pos,
  type TerrainDef,
  rnl,
} from '@nh/core';
import { heroAttack, monsterIdAt } from './combat';
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
    // A visible monster there turns the move into an attack (allowed diagonally through doors).
    const seen = ctx.query
      .describe(target.pos)
      .entities.find((e) => ctx.defs.isMonster(e.def));
    if (seen)
      return [
        {
          action: { type: 'move', dir },
          labelKey: 'action.attack',
          params: { target: `@${seen.def}` },
        },
      ];
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
    // ref: src/hack.c domove(): a monster at the target is attacked before test_move() is
    // consulted, so attacks work diagonally through doorways. (domove_core's "don't attack if
    // running" check belongs to travel/run, which is a different action.)
    const victim = monsterIdAt(ctx, to, pos.level);
    if (victim !== null) return heroAttack(ctx, victim);
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

/** Terrain def under the hero. */
function terrainUnderHero(ctx: Ctx): TerrainDef {
  const pos = playerAt(ctx);
  const level = getLevel(ctx.state);
  const id = level.palette[level.cells[cellIndex(level, pos.x, pos.y)] ?? 0];
  if (id === undefined) throw new Error('Hero stands on unknown terrain');
  return ctx.defs.terrain(id);
}

/** Sets a cell to terrain `id`, adding it to the level palette when missing. */
function setTerrain(level: Level, x: number, y: number, id: DefId): void {
  let pi = level.palette.indexOf(id);
  if (pi === -1) pi = level.palette.push(id) - 1;
  level.cells[cellIndex(level, x, y)] = pi;
}

const search: ActionDef = {
  id: 'nh:search',
  labelKey: 'action.search',
  handles: 'search',
  offer: (_ctx, target) =>
    target.kind === 'self'
      ? [{ action: { type: 'search' }, labelKey: 'action.search' }]
      : [],
  perform(ctx) {
    // ref: src/detect.c dosearch0(): x outer, y inner over the 3x3 around the hero. Hidden monsters
    // and traps are not implemented; there is no Luck or lenses/artifact bonus (fund = 0, Luck = 0).
    const here = playerAt(ctx);
    const level = getLevel(ctx.state);
    ctx.emit({ type: 'searched' });
    for (let x = here.x - 1; x <= here.x + 1; x++) {
      for (let y = here.y - 1; y <= here.y + 1; y++) {
        if (!inBounds(level, x, y) || (x === here.x && y === here.y)) continue;
        const id = level.palette[level.cells[cellIndex(level, x, y)] ?? 0];
        if (id === T.sdoor_v || id === T.sdoor_h) {
          if (rnl(ctx.rng, 7) !== 0) continue;
          // ref: cvt_sdoor_to_door(): a closed door (locked doors are closed in this port)
          setTerrain(level, x, y, T.door_closed);
          ctx.emit({ type: 'msg', key: 'search.found_door' });
        } else if (id === T.scorr) {
          if (rnl(ctx.rng, 7) !== 0) continue;
          setTerrain(level, x, y, T.corr);
          ctx.emit({ type: 'msg', key: 'search.found_passage' });
        }
      }
    }
    return NORMAL_SPEED;
  },
};

// ref: src/do.c dodown()
const down: ActionDef = {
  id: 'nh:down',
  labelKey: 'action.down',
  handles: 'mod',
  offer: (ctx, target) =>
    target.kind === 'self' && terrainUnderHero(ctx).stairs === 'down'
      ? [{ action: { type: 'mod', action: 'nh:down' }, labelKey: 'action.down' }]
      : [],
  perform(ctx) {
    if (terrainUnderHero(ctx).stairs !== 'down') {
      ctx.emit({ type: 'msg', key: 'stairs.cant_down' });
      return 0;
    }
    // Arrive on the up stairs of the next level (ref: goto_level() u_on_newpos(xupstair)).
    ctx.goToLevel(getLevel(ctx.state).depth + 1, 'up');
    return NORMAL_SPEED;
  },
};

// ref: src/do.c doup()
const up: ActionDef = {
  id: 'nh:up',
  labelKey: 'action.up',
  handles: 'mod',
  offer: (ctx, target) =>
    target.kind === 'self' && terrainUnderHero(ctx).stairs === 'up'
      ? [{ action: { type: 'mod', action: 'nh:up' }, labelKey: 'action.up' }]
      : [],
  perform(ctx) {
    if (terrainUnderHero(ctx).stairs !== 'up') {
      ctx.emit({ type: 'msg', key: 'stairs.cant_up' });
      return 0;
    }
    const depth = getLevel(ctx.state).depth;
    if (depth > 1) {
      ctx.goToLevel(depth - 1, 'down');
      return NORMAL_SPEED;
    }
    // ref: doup(): ledger_no == 1 -> y_n("Beware, there will be no return!  Still climb?")
    ctx.ask({ id: 'leave-dungeon', kind: 'yn', key: 'stairs.leave_confirm' }, 'nh:up', null);
    return 0;
  },
  answer(ctx, value) {
    // Anything but 'y' returns ECMD_OK: no message, no time.
    if (value !== true) return 0;
    // ref: src/do.c doup() -> prev_level() -> done(ESCAPED)
    ctx.endGame({
      kind: 'escaped',
      killer: 'escaped',
      turn: ctx.state.turn,
      depth: 1,
      level: getPlayer(ctx.state).c.experience?.level ?? 1,
    });
    return 0;
  },
};

export const ACTIONS: readonly ActionDef[] = [move, wait, search, down, up];
