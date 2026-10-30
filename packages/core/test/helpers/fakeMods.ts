import { VANILLA_TERRAIN } from '../../src/levelgen/index';
import type { DefId, Json } from '../../src/types/common';
import type { GameEvent } from '../../src/types/event';
import type { Mod, ModApi, TerrainDef } from '../../src/types/mod';
import { DIRS } from '../../src/util';
import { getPlayer } from '../../src/state';

const GLYPH = { ch: '.', fg: '#fff' };
const OPEN = new Set<string>(['door_open_v', 'door_open_h']);

/** A mod 'nh' that defines the 15 terrain ids the level generator needs. Core tests must not import @nh/content. */
export function terrainMod(
  roles: { id: DefId; speed: number }[] = [{ id: 'nh:hero', speed: 12 }],
): Mod {
  return {
    id: 'nh',
    version: '1.0.0',
    register(api) {
      for (const [name, id] of Object.entries(VANILLA_TERRAIN)) {
        const solid = [
          'stone',
          'vwall',
          'hwall',
          'tlcorn',
          'trcorn',
          'blcorn',
          'brcorn',
          'door_closed',
        ].includes(name);
        const def: TerrainDef = {
          id,
          nameKey: `terrain.${name}`,
          passable: !solid,
          opaque: solid,
          glyph: GLYPH,
        };
        if (name === 'doorway') def.door = 'doorway';
        if (OPEN.has(name)) def.door = 'open';
        if (name === 'door_closed') def.door = 'closed';
        if (name === 'stairs_up') def.stairs = 'up';
        if (name === 'stairs_down') def.stairs = 'down';
        api.defineTerrain(def);
      }
      for (const r of roles) {
        api.defineRole({
          id: r.id,
          nameKey: `role.${r.id.split(':')[1] ?? ''}`,
          speed: r.speed,
          glyph: GLYPH,
        });
      }
    },
  };
}

/** Simple actions: move/wait/search plus mod action 'fk:cost' whose args are `{ cost }`. */
export function actionsMod(extra: (api: ModApi) => void = () => undefined): Mod {
  return {
    id: 'fk',
    version: '1.0.0',
    register(api) {
      api.defineAction({
        id: 'fk:move',
        labelKey: 'a.move',
        handles: 'move',
        offer: (_ctx, t) =>
          t.kind === 'cell'
            ? [{ action: { type: 'move', dir: 'e' }, labelKey: 'a.move', source: 'ignored' }]
            : [],
        perform(ctx, a) {
          if (a.type !== 'move') return 0;
          const pos = getPlayer(ctx.state).c.pos;
          if (!pos) return 0;
          const from = { x: pos.x, y: pos.y };
          pos.x += DIRS[a.dir].x;
          pos.y += DIRS[a.dir].y;
          ctx.emit({ type: 'moved', id: ctx.state.playerId, from, to: { x: pos.x, y: pos.y } });
          return 12;
        },
      });
      api.defineAction({
        id: 'fk:wait',
        labelKey: 'a.wait',
        handles: 'wait',
        offer: (_ctx, t) =>
          t.kind === 'self' ? [{ action: { type: 'wait' }, labelKey: 'a.wait', source: 'x' }] : [],
        perform: () => 12,
      });
      api.defineAction({
        id: 'fk:cost',
        labelKey: 'a.cost',
        handles: 'mod',
        offer: () => [],
        perform(_ctx, a) {
          const args = (a.type === 'mod' ? a.args : null) as { cost?: Json } | null;
          return args?.cost as number;
        },
      });
      extra(api);
    },
  };
}

export const costAction = (cost: number) =>
  ({ type: 'mod', action: 'fk:cost', args: { cost } }) as const;

export type EventLog = GameEvent[];
