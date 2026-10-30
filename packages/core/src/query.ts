import { cellRules } from './movement';
import { findPath } from './path';
import { getLevel, isVisible, playerPos } from './state';
import type { Pos } from './types/common';
import type { Ctx, Registry } from './types/mod';
import type { CoreQuery, Description, Target } from './types/query';
import type { GameState } from './types/state';
import { cellIndex, inBounds, sortedIds } from './util';
import type { Rng } from './types/rng';

const NO_RNG: Rng = new Proxy({} as Rng, {
  get() {
    throw new Error('Queries must not use the RNG');
  },
});

/** Read-only queries, answered from player knowledge (memory + current vision). */
export function createQuery(registry: Registry, state: GameState): CoreQuery {
  const query: CoreQuery = {
    describe(pos: Pos): Description {
      const level = getLevel(state);
      const none: Description = { terrain: null, remembered: false, visible: false, entities: [] };
      if (!inBounds(level, pos.x, pos.y)) return none;
      const i = cellIndex(level, pos.x, pos.y);
      const mem = state.memory[level.id]?.[i] ?? -1;
      const visible = isVisible(state, i);
      const entities = visible
        ? sortedIds(state).flatMap((id) => {
            const e = state.entities[String(id)];
            const p = e?.c.pos;
            return e && p && p.level === level.id && p.x === pos.x && p.y === pos.y
              ? [{ id: e.id, def: e.def }]
              : [];
          })
        : [];
      return {
        terrain: mem >= 0 ? (level.palette[mem] ?? null) : null,
        remembered: mem >= 0,
        visible,
        entities,
      };
    },

    actionsFor(target: Target) {
      const t: Target =
        target.kind === 'entity' && target.id === state.playerId ? { kind: 'self' } : target;
      const ctx: Ctx = {
        state,
        rng: NO_RNG,
        cosmetic: NO_RNG,
        defs: registry,
        query,
        emit() {
          throw new Error('offer() must not emit events');
        },
        schedule() {
          throw new Error('offer() must not schedule timers');
        },
      };
      return registry.actions.flatMap((def) =>
        def.offer(ctx, t).map((o) => ({ ...o, source: def.mod })),
      );
    },

    pathTo(pos: Pos) {
      const level = getLevel(state);
      const memory = state.memory[level.id];
      if (!memory) return null;
      return findPath(level, cellRules(level, registry), memory, playerPos(state), pos);
    },
  };
  return query;
}
