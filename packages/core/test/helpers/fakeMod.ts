import { DIR_LIST, DIRS } from '../../src/util';
import { cellRules, checkStep } from '../../src/movement';
import { VANILLA_TERRAIN } from '../../src/levelgen/index';
import { getLevel, getPlayer } from '../../src/state';
import type { Dir } from '../../src/types/action';
import type { DefId } from '../../src/types/common';
import type { Mod } from '../../src/types/mod';
import type { ActionOffer } from '../../src/types/query';

const STEP_COST = 12;

/** Minimal `nh` mod for core tests: all 15 vanilla terrain ids, one role, wait and move. */
export const fakeMod: Mod = {
  id: 'nh',
  version: '0.0.1',
  register(api) {
    const ids = Object.values(VANILLA_TERRAIN).sort();
    ids.forEach((id, i) => {
      const solid = /wall|corn|stone|closed/.test(id);
      api.defineTerrain({
        id,
        nameKey: `terrain.${id}`,
        passable: !solid,
        opaque: solid,
        ...(id.endsWith('door_closed') ? { door: 'closed' as const } : {}),
        glyph: { ch: String.fromCharCode(33 + i), fg: '#ccc' },
      });
    });
    api.defineRole({
      id: 'nh:tester',
      nameKey: 'role.tester',
      speed: 12,
      glyph: { ch: '@', fg: '#fff' },
    });
    api.defineAction({
      id: 'nh:wait',
      labelKey: 'action.wait',
      handles: 'wait',
      offer: (_ctx, target): ActionOffer[] =>
        target.kind === 'self'
          ? [{ action: { type: 'wait' }, labelKey: 'action.wait', source: 'nh' }]
          : [],
      perform: () => STEP_COST,
    });
    api.defineAction({
      id: 'nh:move',
      labelKey: 'action.move',
      handles: 'move',
      offer(ctx, target) {
        if (target.kind !== 'cell') return [];
        const p = getPlayer(ctx.state).c.pos;
        if (!p) return [];
        const dx = target.pos.x - p.x;
        const dy = target.pos.y - p.y;
        const dir = DIR_LIST.find((d) => DIRS[d].x === dx && DIRS[d].y === dy);
        return dir
          ? [{ action: { type: 'move', dir }, labelKey: 'action.move', source: 'nh' }]
          : [];
      },
      perform(ctx, action) {
        if (action.type !== 'move') return 0;
        const level = getLevel(ctx.state);
        const pos = getPlayer(ctx.state).c.pos;
        if (!pos) return 0;
        const dir: Dir = action.dir;
        if (!checkStep(level, cellRules(level, ctx.defs), pos, dir).ok) return 0;
        pos.x += DIRS[dir].x;
        pos.y += DIRS[dir].y;
        return STEP_COST;
      },
    });
  },
};

export const FAKE_ROLE: DefId = 'nh:tester';
