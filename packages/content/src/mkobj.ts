// Random object generation: mkobj() and its helpers.
// ref: src/mkobj.c mkobj(), mkobj_at(), rndmonnum()
import type { Ctx, DefId, EntityId, LevelId, MonsterDef, ObjectClass, ObjectDef } from '@nh/core';
import { rndmonst } from './generation';
import { mksobj } from './items';
import { startCorpseTimeout } from './corpses';

/** What mkobj() needs from a Ctx (corpses schedule a rot timer). */
export type MkobjCtx = Pick<
  Ctx,
  'state' | 'rng' | 'defs' | 'emit' | 'spawn' | 'remove' | 'schedule'
>;

/**
 * The class probabilities of mkobj() on ordinary levels, in NetHack's order; they sum to 100.
 * `null` marks the classes this port does not have yet: rolling one generates nothing.
 * ref: src/mkobj.c mkobjprobs[]
 */
export const MKOBJ_PROBS: readonly { prob: number; cls: ObjectClass | null; name: string }[] = [
  { prob: 10, cls: 'weapon', name: 'weapon' },
  { prob: 11, cls: 'armor', name: 'armor' },
  { prob: 20, cls: 'food', name: 'food' },
  { prob: 8, cls: null, name: 'tool' },
  { prob: 7, cls: null, name: 'gem' },
  { prob: 16, cls: 'potion', name: 'potion' },
  { prob: 16, cls: 'scroll', name: 'scroll' },
  { prob: 4, cls: null, name: 'spellbook' },
  { prob: 4, cls: null, name: 'wand' },
  { prob: 3, cls: null, name: 'ring' },
  { prob: 1, cls: null, name: 'amulet' },
];

export interface MkobjOpts {
  /** Level whose depth matters (random corpses); default is the hero's current level. */
  level?: LevelId;
  /** Place the object on the floor here (mkobj_at). Otherwise it is returned detached. */
  at?: { level: LevelId; x: number; y: number };
  /** Called during level creation (gi.in_mklev): corpse timers vary more. */
  inMklev?: boolean;
}

/** The depth used as level_difficulty() for things made on `level`. */
function depthOf(ctx: Pick<MkobjCtx, 'state'>, level: LevelId | undefined): number {
  const id = level ?? ctx.state.currentLevel;
  return ctx.state.levels[id]?.depth ?? 1;
}

/**
 * A random monster type for a corpse, like the level's monsters.
 * ref: src/mkobj.c rndmonnum_adj(): plan A is rndmonst(); plan B (nothing eligible) is any
 * common monster, picked uniformly from the whole table (our table has no G_NOGEN/UNIQ rows to
 * skip except those flagged so).
 */
export function rndmonnum(ctx: MkobjCtx, depth: number): MonsterDef {
  const m = rndmonst(ctx, depth);
  if (m) return m;
  const all = ctx.defs.monsters.filter(
    (d) => !d.genFlags.includes('nogen') && !d.genFlags.includes('uniq'),
  );
  const pick = all[ctx.rng.rn2(Math.max(all.length, 1))] ?? ctx.defs.monsters[0];
  if (!pick) throw new Error('rndmonnum: no monsters registered');
  return pick;
}

/**
 * Picks an object type of class `cls` by probability. ref: src/mkobj.c mkobj():
 * `prob = rnd(oclass_prob_totals[oclass]); while ((prob -= objects[i].oc_prob) > 0) ++i;`
 * Our subset's probabilities do not sum to 1000, so the total is of the registered objects of
 * the class (see DEVIATIONS.md). Returns null when the class has no objects with prob > 0.
 */
export function pickObjectOfClass(
  ctx: Pick<MkobjCtx, 'rng' | 'defs'>,
  cls: ObjectClass,
): ObjectDef | null {
  const list = ctx.defs.objects.filter((o) => o.class === cls);
  const total = list.reduce((a, o) => a + o.prob, 0);
  if (total <= 0) return null;
  let prob = ctx.rng.rnd(total);
  for (const o of list) {
    prob -= o.prob;
    if (prob <= 0) return o;
  }
  return list[list.length - 1] ?? null;
}

/**
 * A random object of the given class, or of a random class (`'random'`) according to
 * mkobjprobs[]. Returns the new object's id, or null when the rolled class is not implemented
 * (the class roll is still made). With `opts.at` the object is placed on the floor.
 * ref: src/mkobj.c mkobj(), mkobj_at(), and mksobj() for a corpse (random monster).
 */
export function mkobj(
  ctx: MkobjCtx,
  oclass: ObjectClass | 'random',
  opts: MkobjOpts = {},
): EntityId | null {
  let cls: ObjectClass | null;
  if (oclass === 'random') {
    // for (tprob = rnd(100); (tprob -= iprobs->iprob) > 0; iprobs++) continue;
    let tprob = ctx.rng.rnd(100);
    let i = 0;
    while (tprob - (MKOBJ_PROBS[i]?.prob ?? 0) > 0) {
      tprob -= MKOBJ_PROBS[i]?.prob ?? 0;
      i++;
    }
    cls = MKOBJ_PROBS[i]?.cls ?? null;
  } else cls = oclass;
  if (cls === null) return null;
  const def = pickObjectOfClass(ctx, cls);
  if (!def) return null;
  const where = opts.at ? { at: opts.at } : {};
  if (def.id === 'nh:corpse') {
    // ref: src/mkobj.c mksobj() CORPSE: corpsenm = undead_to_corpse(rndmonnum()), up to 50
    // tries to avoid G_NOCORPSE types; then the rot timer (made with level-creation variance
    // when the level is not the current one, as in_mklev does).
    let mon = rndmonnum(ctx, depthOf(ctx, opts.level ?? opts.at?.level));
    for (let tries = 50; mon.genFlags.includes('nocorpse') && --tries > 0;)
      mon = rndmonnum(ctx, depthOf(ctx, opts.level ?? opts.at?.level));
    const id = mksobj(ctx, def, { corpseOf: mon.id as DefId, artif: true, ...where });
    startCorpseTimeout(ctx, id, opts.inMklev === true);
    return id;
  }
  return mksobj(ctx, def, { artif: true, ...where });
}

/** ref: src/mkobj.c mkobj_at() */
export function mkobjAt(
  ctx: MkobjCtx,
  oclass: ObjectClass | 'random',
  at: { level: LevelId; x: number; y: number },
  inMklev = false,
): EntityId | null {
  return mkobj(ctx, oclass, { at, inMklev });
}
