// Object instances: creation, weight, stacking and inventory handling.
import {
  inventoryOf,
  itemsAt,
  type Buc,
  type Ctx,
  type DefId,
  type Entity,
  type EntityId,
  type ItemComponent,
  type LevelId,
  type MonsterDef,
  type Msg,
  type ObjectDef,
  type Registry,
  type Rng,
} from '@nh/core';

/** What the item functions need from a `Ctx` (tests can supply a minimal one). */
export type ItemCtx = Pick<Ctx, 'state' | 'rng' | 'defs' | 'emit' | 'spawn' | 'remove'>;

/**
 * Number of successes of a 1/x chance, capped; ref: src/rnd.c rne().
 * `heroLevel` is u.ulevel: the cap is 5 below level 15, else level / 3.
 */
export function rne(rng: Rng, x: number, heroLevel: number): number {
  const utmp = heroLevel < 15 ? 5 : Math.trunc(heroLevel / 3);
  let tmp = 1;
  while (tmp < utmp && rng.rn2(x) === 0) tmp++;
  return tmp;
}

const heroLevelOf = (ctx: ItemCtx): number =>
  ctx.state.entities[String(ctx.state.playerId)]?.c.experience?.level ?? 1;

/** ref: src/mkobj.c blessorcurse() */
function blessorcurse(rng: Rng, it: ItemComponent, chance: number): void {
  if (it.buc !== 'uncursed') return;
  if (rng.rn2(chance) === 0) it.buc = rng.rn2(2) === 0 ? 'cursed' : 'blessed';
}

/**
 * Random initialization of an object's BUC, enchantment and quantity.
 * ref: src/mkobj.c mksobj_init() for weapon, food, potion, scroll, armor and coin classes.
 * Simplified: no is_multigen weapons (none of our weapons use ammo or missile skills), no
 * poison, no artifacts, no erosion; food has no corpse/egg/tin/slime-mold special cases (the
 * corpse is made through mkcorpse(), which supplies the monster).
 */
function mksobjInit(ctx: ItemCtx, def: ObjectDef, it: ItemComponent): void {
  const rng = ctx.rng;
  const lvl = heroLevelOf(ctx);
  switch (def.class) {
    case 'weapon':
      if (rng.rn2(11) === 0) {
        it.spe = rne(rng, 3, lvl);
        it.buc = rng.rn2(2) === 0 ? 'uncursed' : 'blessed';
      } else if (rng.rn2(10) === 0) {
        it.buc = 'cursed';
        it.spe = -rne(rng, 3, lvl);
      } else blessorcurse(rng, it, 10);
      break;
    case 'food':
      it.eaten = 0;
      if (def.id !== 'nh:corpse' && rng.rn2(6) === 0) it.quantity = 2;
      break;
    case 'potion':
    case 'scroll':
      blessorcurse(rng, it, 4);
      break;
    case 'armor':
      // The always-cursed armor types (fumbling, levitation...) are not in our subset.
      if (rng.rn2(10) !== 0 && rng.rn2(11) === 0) {
        it.buc = 'cursed';
        it.spe = -rne(rng, 3, lvl);
      } else if (rng.rn2(10) === 0) {
        it.buc = rng.rn2(2) === 0 ? 'uncursed' : 'blessed';
        it.spe = rne(rng, 3, lvl);
      } else blessorcurse(rng, it, 10);
      break;
    case 'coin':
      break;
  }
}

export interface MksobjOpts {
  /** Random BUC/enchantment/quantity (mksobj's `init`); default true. */
  init?: boolean;
  /** Overrides the quantity after init. */
  quantity?: number;
  /** Place on the floor (merging into a pile) ... */
  at?: { level: LevelId; x: number; y: number };
  /** ... or put into this entity's inventory (merging). Neither: the item is left detached. */
  carriedBy?: EntityId;
  /** Corpses only: the monster. */
  corpseOf?: DefId;
}

/**
 * Creates an object instance. ref: src/mkobj.c mksobj(). The returned id is the resulting stack:
 * if the object merged into an existing stack on the floor or in the inventory, that stack's id.
 * A detached item (no `at`/`carriedBy`) is in no place yet and must be placed by the caller
 * before the step ends. Corpses must pass `corpseOf` (random corpses are not implemented).
 */
export function mksobj(ctx: ItemCtx, def: ObjectDef, opts: MksobjOpts = {}): EntityId {
  const { state } = ctx;
  const it: ItemComponent = {
    quantity: 1,
    buc: 'uncursed',
    spe: 0,
    known: { buc: false, spe: false },
    carriedBy: null,
    letter: null,
    equipped: null,
    placed: state.seq++,
    age: Math.max(state.turn, 1),
  };
  if (def.id === 'nh:corpse') {
    if (!opts.corpseOf) throw new Error('mksobj: a corpse needs corpseOf (use mkcorpse)');
    it.corpseOf = opts.corpseOf;
  }
  if (opts.init ?? true) mksobjInit(ctx, def, it);
  if (opts.quantity !== undefined) it.quantity = opts.quantity;
  const id = ctx.spawn({ def: def.id, c: { item: it } });
  if (opts.at) return placeOnFloor(ctx, id, opts.at.level, opts.at.x, opts.at.y);
  if (opts.carriedBy !== undefined) return addToInventory(ctx, opts.carriedBy, id);
  return id;
}

/**
 * A corpse of `mon`. ref: src/mkobj.c mkcorpstat(). Simplified: no gender (corpse spe), no rot
 * timer yet (the age is recorded for it), no revive timer.
 */
export function mkcorpse(
  ctx: ItemCtx,
  mon: MonsterDef,
  where: Pick<MksobjOpts, 'at' | 'carriedBy'>,
): EntityId {
  return mksobj(ctx, ctx.defs.object('nh:corpse'), {
    init: false,
    corpseOf: mon.id,
    ...where,
  });
}

/**
 * A pile of gold on the floor, added to gold already there. ref: src/mkobj.c mkgold():
 * `amount <= 0` rolls the amount from the level depth.
 */
export function mkgold(
  ctx: ItemCtx,
  amount: number,
  at: { level: LevelId; x: number; y: number },
): EntityId {
  if (amount <= 0) {
    const depth = ctx.state.levels[at.level]?.depth ?? 1;
    const mul = ctx.rng.rnd(Math.trunc(30 / Math.max(12 - depth, 2)));
    amount = 1 + ctx.rng.rnd(depth + 2) * mul;
  }
  return mksobj(ctx, ctx.defs.object('nh:gold_piece'), { init: false, quantity: amount, at });
}

// ---------------------------------------------------------------------------------------------
// weight

/** ref: src/eat.c eaten_stat(): weight of partly eaten food scales with the nutrition left. */
function eatenStat(base: number, full: number, left: number): number {
  const uneaten = Math.min(left, full);
  const w = full ? Math.trunc((base * uneaten) / full) : 0;
  return w < 1 ? 1 : w;
}

/**
 * ref: src/mkobj.c weight(). Gold weighs (n + 50) / 100, at least 1; a corpse weighs its
 * monster's corpse weight; partly eaten food is scaled by eaten_stat() (full nutrition is the
 * def's, or the monster's for a corpse; ref: src/eat.c obj_nutrition(), without the lembas/cram
 * race adjustments).
 */
export function weight(defs: Registry, item: Entity): number {
  const it = item.c.item;
  if (!it) return 0;
  const def = defs.object(item.def);
  if (def.id === 'nh:corpse' && it.corpseOf && defs.isMonster(it.corpseOf)) {
    const mon = defs.monster(it.corpseOf);
    const wt = it.quantity * mon.weight;
    return it.eaten ? eatenStat(wt, mon.nutrition, it.eaten) : wt;
  }
  if (def.class === 'food' && it.eaten) {
    return eatenStat(it.quantity * def.weight, def.food?.nutrition ?? 0, it.eaten);
  }
  if (def.class === 'coin') return Math.max(Math.trunc((it.quantity + 50) / 100), 1);
  return def.weight ? def.weight * it.quantity : (it.quantity + 1) >> 1;
}

// ---------------------------------------------------------------------------------------------
// stacking

/**
 * Whether `obj` could merge into the stack `into`. ref: src/invent.c mergable(). Our fields:
 * same def, `merge` flag, same BUC and enchantment (coins always merge), same eaten amount for
 * food, same monster for corpses. Differences in the known flags do not prevent merging (they
 * only would when blind or hallucinating, which is not implemented). Worn status does not
 * matter: a picked-up dagger joins the wielded stack, as in NetHack.
 * Not ported: erosion, grease, light, names, shop state, artifacts, eggs/tins, reviving corpses.
 */
export function mergable(defs: Registry, into: Entity, obj: Entity): boolean {
  const a = into.c.item;
  const b = obj.c.item;
  if (!a || !b || into.id === obj.id || into.def !== obj.def) return false;
  const def = defs.object(obj.def);
  if (!def.merge) return false;
  if (def.class === 'coin') return true;
  if (a.buc !== b.buc || a.spe !== b.spe) return false;
  if (def.class === 'food' && (a.eaten ?? 0) !== (b.eaten ?? 0)) return false;
  if (def.id === 'nh:corpse' && a.corpseOf !== b.corpseOf) return false;
  return true;
}

/**
 * Merges `obj` into `into` if they are mergable, removing `obj`; returns whether it did.
 * ref: src/invent.c merged(). The age becomes the quantity-weighted average (so corpses
 * merge), known flags are ORed (with the "learn more by comparing" message when the hero
 * carries the stack and something was learned), and a worn `obj` passes its slot on.
 */
export function merged(ctx: ItemCtx, into: Entity, obj: Entity): boolean {
  if (!mergable(ctx.defs, into, obj)) return false;
  const a = into.c.item;
  const b = obj.c.item;
  if (!a || !b) return false;
  a.age = Math.trunc(
    ((a.age ?? 0) * a.quantity + (b.age ?? 0) * b.quantity) / (a.quantity + b.quantity),
  );
  a.quantity += b.quantity;
  const isCoin = ctx.defs.object(into.def).class === 'coin';
  let learned = false;
  if (isCoin) {
    a.known.buc = false;
  } else {
    if (b.known.spe !== a.known.spe) {
      a.known.spe = true;
      learned = true;
    }
    if (b.known.buc !== a.known.buc) {
      a.known.buc = true;
      learned = true;
    }
  }
  if (b.equipped !== null && a.carriedBy !== null && a.equipped === null) a.equipped = b.equipped;
  ctx.remove(obj.id);
  if (learned && a.carriedBy === ctx.state.playerId) ctx.emit({ type: 'msg', key: 'item.compare' });
  return true;
}

// ---------------------------------------------------------------------------------------------
// inventory

interface NhData {
  lastinvnr: number;
  /** Hero skill levels by skill name (ref: u.weapon_skills); absent = restricted. */
  skills?: Record<string, number>;
  /** The hero's last encumbrance level, for encumber_msg(). */
  oldcap?: number;
  /** Message shown when the current helplessness ends (ref: nomovemsg). */
  nomovemsg?: Msg | null;
}

/** The content mod's persistent data (gl.lastinvnr and friends). */
export function nhData(ctx: Pick<ItemCtx, 'state'>): NhData {
  const md = ctx.state.modData;
  let d = md['nh'] as unknown as NhData | undefined;
  if (typeof d !== 'object' || d === null || Array.isArray(d)) {
    // ref: src/nhlua.c: gl.lastinvnr = 51 -- the next letter tried is 'a'
    d = { lastinvnr: 51 };
    md['nh'] = d as unknown as (typeof md)[string];
  }
  return d;
}

const INVLET_BASIC = 52;
const letterIndex = (l: string | null): number => {
  if (l === null || l.length !== 1) return -1;
  const c = l.charCodeAt(0);
  if (c >= 97 && c <= 122) return c - 97;
  if (c >= 65 && c <= 90) return c - 65 + 26;
  return -1;
};
const indexLetter = (i: number): string =>
  i < 26 ? String.fromCharCode(97 + i) : String.fromCharCode(65 + i - 26);

/** The marker for "no free letter". ref: include/hack.h NOINVSYM */
export const NOINVSYM = '#';

/**
 * Gives `itemId` an inventory letter (it must not be in `owner`'s inventory yet or must be
 * excluded). ref: src/invent.c assigninvlet() with the default `fixinv`: coins are '$'; the
 * item's old letter (obj->invlet, kept while it lay on the floor) is reused when free among
 * the owner's items; otherwise the first free letter after the last one assigned, cycling a-z
 * then A-Z.
 */
export function assigninvlet(ctx: ItemCtx, owner: EntityId, itemId: EntityId): void {
  const item = ctx.state.entities[String(itemId)];
  const it = item?.c.item;
  if (!item || !it) return;
  if (ctx.defs.object(item.def).class === 'coin') {
    it.letter = '$';
    return;
  }
  const data = nhData(ctx);
  const inuse: boolean[] = Array.from({ length: INVLET_BASIC }, () => false);
  for (const o of inventoryOf(ctx.state, owner)) {
    if (o.id === itemId) continue;
    const i = letterIndex(o.c.item?.letter ?? null);
    if (i >= 0) inuse[i] = true;
  }
  const want = it.letter;
  const wi = letterIndex(want);
  if (wi >= 0 && !inuse[wi]) {
    it.letter = want;
    return;
  }
  let i = data.lastinvnr + 1;
  for (; i !== data.lastinvnr; i++) {
    if (i === INVLET_BASIC) {
      i = -1;
      continue;
    }
    if (!inuse[i]) break;
  }
  it.letter = inuse[i] ? NOINVSYM : indexLetter(i);
  data.lastinvnr = i;
}

/** Number of items (stacks) `owner` carries. ref: src/invent.c inv_cnt() */
export function invCount(ctx: Pick<ItemCtx, 'state'>, owner: EntityId, incGold = false): number {
  return inventoryOf(ctx.state, owner).filter((e) => incGold || e.c.item?.letter !== '$').length;
}

/**
 * Puts the item into `owner`'s inventory, merging into an existing stack when possible, and
 * returns the id of the resulting stack. ref: src/invent.c addinv_core0()/addinv(). Only the
 * hero gets letters. The item may be detached or on the floor; it leaves the floor.
 */
export function addToInventory(ctx: ItemCtx, owner: EntityId, itemId: EntityId): EntityId {
  const item = ctx.state.entities[String(itemId)];
  const it = item?.c.item;
  if (!item || !it) throw new Error(`addToInventory: ${itemId} is not an item`);
  if (it.carriedBy !== null) removeFromInventory(ctx, itemId);
  delete item.c.pos;
  for (const other of inventoryOf(ctx.state, owner)) {
    if (merged(ctx, other, item)) return other.id;
  }
  it.carriedBy = owner;
  it.equipped = null;
  it.placed = ctx.state.seq++;
  if (owner === ctx.state.playerId) assigninvlet(ctx, owner, itemId);
  else it.letter = null;
  return itemId;
}

/**
 * Takes the item out of its carrier's inventory and leaves it detached (no place): the caller
 * must place it (placeOnFloor, addToInventory) or `ctx.remove` it. ref: src/invent.c freeinv().
 * Unequips it; it keeps its letter (obj->invlet) so picking it up again restores it if free.
 */
export function removeFromInventory(ctx: ItemCtx, itemId: EntityId): void {
  const it = ctx.state.entities[String(itemId)]?.c.item;
  if (!it) return;
  it.carriedBy = null;
  it.equipped = null;
}

/**
 * Drops the item on the floor at (x, y), merging into a mergable stack there, and returns the
 * resulting stack's id. ref: src/mkobj.c place_object() followed by src/mkobj.c stackobj().
 * A new object is the top of the pile; a merged one keeps its stack's position.
 */
export function placeOnFloor(
  ctx: ItemCtx,
  itemId: EntityId,
  level: LevelId,
  x: number,
  y: number,
): EntityId {
  const item = ctx.state.entities[String(itemId)];
  const it = item?.c.item;
  if (!item || !it) throw new Error(`placeOnFloor: ${itemId} is not an item`);
  if (it.carriedBy !== null) removeFromInventory(ctx, itemId);
  it.equipped = null;
  delete item.c.pos;
  for (const other of itemsAt(ctx.defs, ctx.state, level, x, y)) {
    if (merged(ctx, other, item)) return other.id;
  }
  item.c.pos = { level, x, y };
  it.placed = ctx.state.seq++;
  return itemId;
}

/**
 * Splits `n` items off a stack and returns the new, detached stack (the caller places it, as
 * with removeFromInventory). The original keeps quantity - n and stays where it was, worn
 * status stays with it. ref: src/invent.c splitobj(); requires 0 < n < quantity.
 */
export function splitStack(ctx: ItemCtx, itemId: EntityId, n: number): EntityId {
  const it = ctx.state.entities[String(itemId)]?.c.item;
  if (!it) throw new Error(`splitStack: ${itemId} is not an item`);
  if (n <= 0 || it.quantity <= n)
    throw new Error(`splitStack: cannot split ${n} of ${it.quantity}`);
  const child: ItemComponent = {
    ...it,
    known: { ...it.known },
    quantity: n,
    carriedBy: null,
    equipped: null,
    placed: ctx.state.seq++,
  };
  it.quantity -= n;
  const def = ctx.state.entities[String(itemId)]?.def;
  if (!def) throw new Error('splitStack: missing def');
  return ctx.spawn({ def, c: { item: child } });
}

/** Buc as a number: blessed +1, cursed -1. ref: src/mkobj.c bcsign() */
export function bcsign(buc: Buc): number {
  return buc === 'blessed' ? 1 : buc === 'cursed' ? -1 : 0;
}
