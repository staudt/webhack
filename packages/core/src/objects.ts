import type { DefId, EntityId, LevelId } from './types/common';
import type { Entity } from './types/entity';
import type { Level } from './types/level';
import type { Registry } from './types/mod';
import type { GameState } from './types/state';
import { sortedIds } from './util';

/** The id a player sees for an object def: its per-game appearance, or the def itself. */
export function shownId(state: Readonly<GameState>, def: DefId): DefId {
  return state.appearances[def] ?? def;
}

/** True for an entity whose def is a registered object. */
export function isItem(registry: Registry, e: Entity): boolean {
  return e.c.item !== undefined && registry.isObject(e.def);
}

/** Objects on the floor at (x, y) of `level`, top of the pile first. */
export function itemsAt(
  registry: Registry,
  state: Readonly<GameState>,
  level: LevelId,
  x: number,
  y: number,
): Entity[] {
  const out: Entity[] = [];
  for (const id of sortedIds(state)) {
    const e = state.entities[String(id)];
    const p = e?.c.pos;
    if (e && p && p.level === level && p.x === x && p.y === y && isItem(registry, e)) out.push(e);
  }
  return out.sort((a, b) => (b.c.item?.placed ?? 0) - (a.c.item?.placed ?? 0) || a.id - b.id);
}

/** Cell index -> the top object's shown id, for every floor object on `level`. */
export function topObjects(
  registry: Registry,
  state: Readonly<GameState>,
  level: Level,
): Map<number, DefId> {
  const best = new Map<number, { placed: number; id: EntityId; shown: DefId }>();
  for (const id of sortedIds(state)) {
    const e = state.entities[String(id)];
    const p = e?.c.pos;
    if (!e || !p || p.level !== level.id || !isItem(registry, e)) continue;
    const i = p.y * level.width + p.x;
    const placed = e.c.item?.placed ?? 0;
    const cur = best.get(i);
    // Ties go to the lower id, matching itemsAt.
    if (!cur || placed > cur.placed) best.set(i, { placed, id, shown: shownId(state, e.def) });
  }
  const out = new Map<number, DefId>();
  for (const [i, v] of best) out.set(i, v.shown);
  return out;
}

const letterRank = (l: string | null): number => {
  if (l === null) return 1000;
  if (l === '$') return 0;
  const c = l.charCodeAt(0);
  if (c >= 97 && c <= 122) return c - 96; // a-z: 1..26
  if (c >= 65 && c <= 90) return c - 64 + 26; // A-Z: 27..52
  return 100 + c;
};

/** Items carried by `owner`, in inventory-letter order ('$', a-z, A-Z), then by id. */
export function inventoryOf(state: Readonly<GameState>, owner: EntityId): Entity[] {
  const out: Entity[] = [];
  for (const id of sortedIds(state)) {
    const e = state.entities[String(id)];
    if (e?.c.item?.carriedBy === owner) out.push(e);
  }
  return out.sort(
    (a, b) =>
      letterRank(a.c.item?.letter ?? null) - letterRank(b.c.item?.letter ?? null) || a.id - b.id,
  );
}
