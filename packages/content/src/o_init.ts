// Randomized appearances and discoveries. ref: src/o_init.c
import {
  type Ctx,
  type DefId,
  type GameState,
  type ModApi,
  type ObjectClass,
  type ObjectDef,
  type Registry,
} from '@nh/core';

/** Classes whose descriptions are shuffled per game. ref: src/o_init.c shuffle_all() */
const SHUFFLED: readonly ObjectClass[] = ['potion', 'scroll'];

/**
 * Assigns each shuffled object (potions except water, scrolls) a distinct random appearance of
 * its class. ref: src/o_init.c shuffle_all(), shuffle(): for each object j in order, swap its
 * description with that of a random object i in j..last. NetHack shuffles the descriptions of
 * its full object list; our object set is a subset, so drawing distinct descriptions from the
 * full appearance pool (a partial Fisher-Yates over it, the same swap loop) gives each of our
 * objects a uniformly random distinct description, equivalent to a full permutation restricted
 * to our objects.
 */
export function shuffleAll(ctx: Pick<Ctx, 'state' | 'rng' | 'defs'>): void {
  const { state, defs, rng } = ctx;
  for (const cls of SHUFFLED) {
    const pool = defs.appearances.filter((a) => a.class === cls).map((a) => a.id);
    const objs = defs.objects.filter((o) => o.class === cls && o.descKey === undefined);
    if (objs.length > pool.length) throw new Error(`shuffleAll: too few ${cls} appearances`);
    for (let j = 0; j < objs.length; j++) {
      const i = j + rng.rn2(pool.length - j);
      const a = pool[j];
      const b = pool[i];
      if (a === undefined || b === undefined) continue;
      pool[j] = b;
      pool[i] = a;
      const o = objs[j];
      if (o) state.appearances[o.id] = b;
    }
  }
}

/** Whether the hero knows what the object is. ref: objects[].oc_name_known (set at game start for objects with no description) */
export function isKnown(
  state: Readonly<GameState>,
  _defs: Registry,
  def: ObjectDef | DefId,
): boolean {
  const id = typeof def === 'string' ? def : def.id;
  if (state.discovered.includes(id)) return true;
  const d = typeof def === 'string' ? _defs.object(def) : def;
  return d.descKey === undefined && state.appearances[d.id] === undefined;
}

/** Marks the object type as identified, keeping `discovered` sorted. ref: src/o_init.c discover_object() */
export function discover(ctx: Pick<Ctx, 'state'>, def: ObjectDef | DefId): void {
  const id = typeof def === 'string' ? def : def.id;
  const list = ctx.state.discovered;
  if (list.includes(id)) return;
  list.push(id);
  list.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Registers the appearance shuffle, which runs first in newGame so later hooks see appearances. */
export function registerShuffle(api: ModApi): void {
  // ref: src/o_init.c init_objects() -> shuffle_all(), at game start
  api.on('newGame', (ctx) => shuffleAll(ctx), { priority: 100 });
}
