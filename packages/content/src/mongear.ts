// Monster inventories: starting gear, wearing armor, wielding weapons, picking things up and
// dropping everything on death.
// ref: src/makemon.c m_initweap(), m_initinv(), mongets(); src/worn.c m_dowear();
// src/weapon.c select_hwep(), mon_wield_item(); src/mon.c mpickstuff(); src/steal.c relobj()
import {
  cellIndex,
  inventoryOf,
  isVisible,
  itemsAt,
  type DefId,
  type Entity,
  type EntityId,
  type ItemComponent,
  type Json,
  type MonsterDef,
  type ObjectDef,
} from '@nh/core';
import {
  addToInventory,
  mksobj,
  mksobjInit,
  placeOnFloor,
  removeFromInventory,
  splitStack,
  weight,
  type ItemCtx,
} from './items';
import { doname, xnameOf } from './objnam';

/** What these functions need: a Ctx without the hero-facing parts. */
export type GearCtx = ItemCtx;

const hasFlag = (def: MonsterDef, f: string): boolean => def.flags.includes(f);
const isArmed = (def: MonsterDef): boolean => def.attacks.some((a) => a.at === 'weapon');
const isStrong = (def: MonsterDef): boolean => hasFlag(def, 'strong');
const isLord = (def: MonsterDef): boolean => hasFlag(def, 'lord');
/** ref: include/mondata.h likes_gold() */
export const likesGold = (def: MonsterDef): boolean => hasFlag(def, 'greedy');
/** ref: include/mondata.h likes_gems() */
export const likesGems = (def: MonsterDef): boolean => hasFlag(def, 'jewels');
/** ref: include/mondata.h likes_objs(): M2_COLLECT or armed */
export const likesObjs = (def: MonsterDef): boolean => hasFlag(def, 'collect') || isArmed(def);

const monOf = (ctx: Pick<GearCtx, 'state' | 'defs'>, id: EntityId) => {
  const e = ctx.state.entities[String(id)];
  if (!e?.c.monster) throw new Error(`Entity ${id} is not a monster`);
  return { e, def: ctx.defs.monster(e.def) };
};

// ---------------------------------------------------------------------------------------------
// per-monster flags kept in modData (JSON), keyed by entity id

type JsonObj = { [k: string]: Json };
const isObj = (v: Json | undefined): v is JsonObj =>
  v !== null && v !== undefined && typeof v === 'object' && !Array.isArray(v);

function flagTable(ctx: Pick<GearCtx, 'state'>, key: string, create: boolean): JsonObj | null {
  const md = ctx.state.modData;
  let root = md['nh'];
  if (!isObj(root)) {
    if (!create) return null;
    root = {};
    md['nh'] = root;
  }
  let t = root[key];
  if (!isObj(t)) {
    if (!create) return null;
    t = {};
    root[key] = t;
  }
  return t;
}

/** Whether monster `id` has the named flag set (gearchk, nowep). */
export function monFlag(ctx: Pick<GearCtx, 'state'>, key: string, id: EntityId): boolean {
  return flagTable(ctx, key, false)?.[String(id)] === true;
}

/** Sets or clears a flag. */
export function setMonFlag(
  ctx: Pick<GearCtx, 'state'>,
  key: string,
  id: EntityId,
  on: boolean,
): void {
  if (on) {
    const t = flagTable(ctx, key, true);
    if (t) t[String(id)] = true;
  } else {
    const t = flagTable(ctx, key, false);
    if (t) delete t[String(id)];
  }
}

/** Forgets everything stored about a dead monster. */
export function forgetMonster(ctx: Pick<GearCtx, 'state'>, id: EntityId): void {
  for (const k of ['gearchk', 'nowep', 'mtrack']) {
    const t = flagTable(ctx, k, false);
    if (t) delete t[String(id)];
  }
}

// ---------------------------------------------------------------------------------------------
// the inventory

/**
 * The monster's items in minvent order: newest first (add_to_minv prepends, and merging keeps
 * the old stack's place). ref: src/mkobj.c add_to_minv()
 */
export function minvent(ctx: Pick<GearCtx, 'state'>, id: EntityId): Entity[] {
  return inventoryOf(ctx.state, id).sort(
    (a, b) => (b.c.item?.placed ?? 0) - (a.c.item?.placed ?? 0) || b.id - a.id,
  );
}

/** The monster's wielded weapon, if any. ref: include/monst.h MON_WEP() */
export function monWep(ctx: Pick<GearCtx, 'state'>, id: EntityId): Entity | null {
  return minvent(ctx, id).find((o) => o.c.item?.equipped === 'weapon') ?? null;
}

/** The item worn in an armor slot, if any. ref: src/worn.c which_armor() */
export function whichArmor(
  ctx: Pick<GearCtx, 'state'>,
  id: EntityId,
  slot: NonNullable<ItemComponent['equipped']>,
): Entity | null {
  return minvent(ctx, id).find((o) => o.c.item?.equipped === slot) ?? null;
}

/** Gold the monster carries. ref: src/invent.c findgold() */
function findGold(ctx: Pick<GearCtx, 'state' | 'defs'>, id: EntityId): Entity | null {
  return inventoryOf(ctx.state, id).find((o) => ctx.defs.object(o.def).class === 'coin') ?? null;
}

const objDef = (ctx: Pick<GearCtx, 'defs'>, id: string): ObjectDef | null =>
  ctx.defs.isObject(id as DefId) ? ctx.defs.object(id as DefId) : null;

/**
 * Gives the monster a new object of type `otyp`; returns its stack, or null when the object
 * does not exist in this port (the caller has already made any rolls C makes before it).
 * ref: src/makemon.c mongets(). No demon, minion, player-monster or prince special cases
 * (none are in the roster).
 */
export function mongets(ctx: GearCtx, monId: EntityId, otyp: string): EntityId | null {
  const def = objDef(ctx, otyp);
  if (!def) return null;
  return mksobj(ctx, def, { carriedBy: monId });
}

/**
 * Rolls mksobj_init() for an object this port lacks, to keep the random stream in step.
 * `multigen` and `poisonable` are the ammo/dart/missile cases.
 */
function burnWeapon(ctx: GearCtx, multigen = false): void {
  if (multigen) ctx.rng.rn2(6); // quan = rn1(6, 6)
  const dummy = { id: 'nh:none' as DefId, class: 'weapon' as const };
  const it = { quantity: 1, buc: 'uncursed', spe: 0 } as ItemComponent;
  mksobjInit(ctx, dummy, it);
  if (multigen) ctx.rng.rn2(100); // is_poisonable && !rn2(100)
}

/**
 * A stack of 3..(oquan+2) missiles. ref: src/makemon.c m_initthrow(). Objects this port lacks
 * (darts, arrows, bolts, flint, rocks) still make their rolls: the object's own init and the
 * quantity.
 */
function mInitThrow(
  ctx: GearCtx,
  monId: EntityId,
  otyp: string,
  oquan: number,
  kind: 'ammo' | 'gem' | 'weapon' = 'weapon',
): void {
  const def = objDef(ctx, otyp);
  if (!def) {
    if (kind === 'ammo') burnWeapon(ctx, true);
    else if (kind === 'gem') ctx.rng.rn2(6); // rock quan = rn1(6, 6) / flint 1 in 6 pair
    ctx.rng.rn2(oquan); // otmp->quan = rn1(oquan, 3)
    return;
  }
  const id = mksobj(ctx, def, {});
  const it = ctx.state.entities[String(id)]?.c.item;
  if (it) it.quantity = ctx.rng.rn2(oquan) + 3;
  addToInventory(ctx, monId, id);
}

/** mongets() of a weapon: when the object is missing, its init rolls are still made. */
function getsOrBurn(ctx: GearCtx, monId: EntityId, otyp: string): void {
  if (mongets(ctx, monId, otyp) === null) burnWeapon(ctx);
}

/** ref: src/makemon.c mkmonmoney() */
export function mkmonmoney(ctx: GearCtx, monId: EntityId, amount: number): void {
  if (amount <= 0) return;
  const def = objDef(ctx, 'nh:gold_piece');
  if (def) mksobj(ctx, def, { init: false, quantity: amount, carriedBy: monId });
}

/**
 * The starting weapons and armor of an armed monster.
 * ref: src/makemon.c m_initweap(), for the roster's kobolds, gnomes, hobbit, hill orc and
 * dwarf. Objects missing from the object table (launchers, ammunition, darts, pick-axe,
 * crossbows) are not given, but the rolls C makes for them are.
 */
export function mInitWeap(ctx: GearCtx, monId: EntityId): void {
  const { def } = monOf(ctx, monId);
  const rng = ctx.rng;
  const ch = def.glyph.ch;
  if (ch === 'h' && def.id === 'nh:hobbit') {
    switch (rng.rn2(3)) {
      case 0:
        mongets(ctx, monId, 'nh:dagger');
        break;
      case 1:
        mongets(ctx, monId, 'nh:elven_dagger');
        break;
      default:
        burnWeapon(ctx); // a sling
        mInitThrow(ctx, monId, rng.rn2(4) === 0 ? 'nh:flint' : 'nh:rock', 6, 'gem');
        break;
    }
    if (rng.rn2(10) === 0) mongets(ctx, monId, 'nh:elven_mithril_coat');
    if (rng.rn2(10) === 0) mongets(ctx, monId, 'nh:dwarvish_cloak');
  } else if (ch === 'h' && hasFlag(def, 'dwarf')) {
    if (rng.rn2(7) !== 0) mongets(ctx, monId, 'nh:dwarvish_cloak');
    if (rng.rn2(7) !== 0) mongets(ctx, monId, 'nh:iron_shoes');
    if (rng.rn2(4) === 0) {
      mongets(ctx, monId, 'nh:dwarvish_short_sword');
      // note: you can't use a mattock with a shield
      if (rng.rn2(2) !== 0) mongets(ctx, monId, 'nh:dwarvish_mattock');
      else {
        mongets(ctx, monId, rng.rn2(2) !== 0 ? 'nh:axe' : 'nh:dwarvish_spear');
        mongets(ctx, monId, 'nh:dwarvish_roundshield');
      }
      mongets(ctx, monId, 'nh:dwarvish_iron_helm');
      if (rng.rn2(3) === 0) mongets(ctx, monId, 'nh:dwarvish_mithril_coat');
    } else {
      // pick-axe (not in the table; a tool without init rolls) 1 time in 3, else a dagger
      if (rng.rn2(3) === 0) mongets(ctx, monId, 'nh:pick_axe');
      else mongets(ctx, monId, 'nh:dagger');
    }
  } else if (ch === 'h') {
    // other S_HUMANOID monsters get nothing here
  } else if (ch === 'o') {
    if (rng.rn2(2) !== 0) mongets(ctx, monId, 'nh:orcish_helm');
    // Only the plain orc branch (default) is in the roster: hill orcs. A goblin always gets the
    // orcish dagger; others pick the dagger or a scimitar.
    if (def.id !== 'nh:orc_shaman' && rng.rn2(2) !== 0) {
      mongets(
        ctx,
        monId,
        def.id === 'nh:goblin' || rng.rn2(2) === 0 ? 'nh:orcish_dagger' : 'nh:scimitar',
      );
    }
  } else if (ch === 'k') {
    if (rng.rn2(4) === 0) mInitThrow(ctx, monId, 'nh:dart', 12, 'ammo');
  } else {
    // The general case. ref: m_initweap() `default:` (gnomes and any other armed monster)
    const bias = isLord(def) ? 1 : 0;
    switch (rng.rnd(14 - 2 * bias)) {
      case 1:
        if (isStrong(def)) getsOrBurn(ctx, monId, 'nh:battle_axe');
        else mInitThrow(ctx, monId, 'nh:dart', 12, 'ammo');
        break;
      case 2:
        if (isStrong(def)) getsOrBurn(ctx, monId, 'nh:two_handed_sword');
        else {
          burnWeapon(ctx); // crossbow
          mInitThrow(ctx, monId, 'nh:crossbow_bolt', 12, 'ammo');
        }
        break;
      case 3:
        burnWeapon(ctx); // bow
        mInitThrow(ctx, monId, 'nh:arrow', 12, 'ammo');
        break;
      case 4:
        if (isStrong(def)) mongets(ctx, monId, 'nh:long_sword');
        else mInitThrow(ctx, monId, 'nh:dagger', 3);
        break;
      case 5:
        if (isStrong(def)) getsOrBurn(ctx, monId, 'nh:lucern_hammer');
        else mongets(ctx, monId, 'nh:aklys');
        break;
      default:
        break;
    }
  }
  // `if ((int) mtmp->m_lev > rn2(75)) mongets(mtmp, rnd_offensive_item(mtmp));`
  // (offensive items are wands, potions and scrolls this port cannot choose yet)
  rng.rn2(75); // the roll is made against m_lev; the item it would give is not
}

/**
 * The extra items of a monster, and its pocket money.
 * ref: src/makemon.c m_initinv(); `depth` is level_difficulty(). The roster has no
 * mercenaries, nymphs, leprechauns or demons; gnomes roll for a candle (not in the table).
 */
export function mInitInv(ctx: GearCtx, monId: EntityId, depth: number): void {
  const { def } = monOf(ctx, monId);
  const rng = ctx.rng;
  // candle for gnomes (not in the table; not in the Mines), then the defensive and misc item
  // rolls (wands, potions and scrolls this port cannot choose yet): only the rolls are made
  if (def.glyph.ch === 'G') rng.rn2(60);
  rng.rn2(50);
  rng.rn2(100);
  if (likesGold(def) && !findGold(ctx, monId) && rng.rn2(5) === 0) {
    const has = inventoryOf(ctx.state, monId).length > 0;
    mkmonmoney(ctx, monId, rng.d(depth, has ? 5 : 10));
  }
}

// ---------------------------------------------------------------------------------------------
// armor

const armorBonus = (ctx: Pick<GearCtx, 'defs'>, o: Entity): number =>
  (ctx.defs.object(o.def).armor?.ac ?? 0) + (o.c.item?.spe ?? 0);

/** ref: include/mondata.h cantweararm(): small (or tiny) monsters slip out of suits. */
const sliparm = (def: MonsterDef): boolean => def.size === 'tiny' || def.size === 'small';
const breakarm = (def: MonsterDef): boolean =>
  !sliparm(def) &&
  (def.size === 'large' ||
    def.size === 'huge' ||
    def.size === 'gigantic' ||
    (def.size !== 'small' && !hasFlag(def, 'humanoid')));
const cantWearArm = (def: MonsterDef): boolean => breakarm(def) || sliparm(def);
/** ref: include/obj.h WrappingAllowed() (cloaks): humanoid, small to huge */
const wrappingAllowed = (def: MonsterDef): boolean =>
  hasFlag(def, 'humanoid') && def.size !== 'tiny' && def.size !== 'gigantic';

type ArmorSlotName = 'shirt' | 'cloak' | 'helm' | 'shield' | 'gloves' | 'boots' | 'body';

/** One slot of m_dowear(); returns the item newly worn, if any. ref: src/worn.c m_dowear_type() */
function mDoWearType(
  ctx: GearCtx,
  monId: EntityId,
  slot: ArmorSlotName,
  creation: boolean,
  racialException: boolean,
): boolean {
  const { def } = monOf(ctx, monId);
  const items = minvent(ctx, monId);
  const old = items.find((o) => o.c.item?.equipped === slot) ?? null;
  if (old?.c.item?.buc === 'cursed') return false;
  let best: Entity | null = old;
  for (const o of items) {
    const od = ctx.defs.object(o.def);
    if (od.armor?.slot !== slot) continue;
    // mummy wrapping is the only cloak for monsters bigger than human: none in the table
    if (
      slot === 'cloak' &&
      (def.size === 'large' || def.size === 'huge' || def.size === 'gigantic')
    )
      continue;
    // ref: m_dowear_type() W_ARM with the racial exception: hobbits wear elven armor
    if (slot === 'body' && racialException && !(def.id === 'nh:hobbit' && /elven/.test(o.def)))
      continue;
    if (o.c.item?.equipped) continue;
    if (best && armorBonus(ctx, best) >= armorBonus(ctx, o)) continue;
    best = o;
  }
  if (!best || best === old) return false;

  if (!creation) {
    const pos = ctx.state.entities[String(monId)]?.c.pos;
    if (pos && sees(ctx, pos)) {
      ctx.emit(
        old
          ? {
              type: 'msg',
              key: 'mon.removes_puts_on',
              params: {
                mon: `@${def.id}`,
                old: doname(ctx.state, ctx.defs, old),
                item: doname(ctx.state, ctx.defs, best),
              },
            }
          : {
              type: 'msg',
              key: 'mon.puts_on',
              params: { mon: `@${def.id}`, item: doname(ctx.state, ctx.defs, best) },
            },
      );
    }
  }
  if (old?.c.item) old.c.item.equipped = null;
  const bi = best.c.item;
  if (bi) bi.equipped = slot;
  return true;
}

/**
 * The monster puts on the best armor it carries in each slot; returns whether anything changed.
 * ref: src/worn.c m_dowear(). Simplifications: the donning delay (mfrozen) is not applied, and
 * amulets and the other special cases do not exist.
 */
export function mDoWear(ctx: GearCtx, monId: EntityId, creation: boolean): boolean {
  const { def } = monOf(ctx, monId);
  if (def.size === 'tiny' || hasFlag(def, 'nohands') || hasFlag(def, 'animal')) return false;
  if (hasFlag(def, 'mindless')) return false; // (zombies and mummies are not in the roster)
  let changed = false;
  const canWearArmor = !cantWearArm(def);
  if (canWearArmor && !whichArmor(ctx, monId, 'body'))
    changed = mDoWearType(ctx, monId, 'shirt', creation, false) || changed;
  if (canWearArmor || wrappingAllowed(def))
    changed = mDoWearType(ctx, monId, 'cloak', creation, false) || changed;
  changed = mDoWearType(ctx, monId, 'helm', creation, false) || changed;
  const wep = monWep(ctx, monId);
  if (!wep || !ctx.defs.object(wep.def).weapon?.bimanual)
    changed = mDoWearType(ctx, monId, 'shield', creation, false) || changed;
  changed = mDoWearType(ctx, monId, 'gloves', creation, false) || changed;
  changed = mDoWearType(ctx, monId, 'boots', creation, false) || changed;
  changed = mDoWearType(ctx, monId, 'body', creation, !canWearArmor) || changed;
  return changed;
}

/** Whether the hero can see the cell. */
function sees(ctx: Pick<GearCtx, 'state'>, pos: { level: string; x: number; y: number }): boolean {
  if (pos.level !== ctx.state.currentLevel) return false;
  const level = ctx.state.levels[pos.level];
  return level !== undefined && isVisible(ctx.state, cellIndex(level, pos.x, pos.y));
}
export { sees as heroSees };

// ---------------------------------------------------------------------------------------------
// weapons

/**
 * Weapons in order of preference, restricted to those in the object table.
 * ref: src/weapon.c hwep[]
 */
const HWEP: readonly string[] = [
  'nh:dwarvish_mattock',
  'nh:long_sword',
  'nh:scimitar',
  'nh:dwarvish_short_sword',
  'nh:short_sword',
  'nh:mace',
  'nh:axe',
  'nh:dwarvish_spear',
  'nh:spear',
  'nh:aklys',
  'nh:club',
  'nh:elven_dagger',
  'nh:dagger',
  'nh:orcish_dagger',
  'nh:knife',
];

/**
 * The best hand-to-hand weapon the monster carries. ref: src/weapon.c select_hwep(): only
 * strong monsters without a shield may use two-handed weapons. Not ported: artifacts,
 * giants' clubs, cockatrice corpses, silver-haters.
 */
export function selectHwep(ctx: GearCtx, monId: EntityId): Entity | null {
  const { def } = monOf(ctx, monId);
  const strong = isStrong(def);
  const wearingShield = whichArmor(ctx, monId, 'shield') !== null;
  const items = minvent(ctx, monId);
  for (const id of HWEP) {
    const od = objDef(ctx, id);
    if (!od?.weapon) continue;
    if (!((strong && !wearingShield) || !od.weapon.bimanual)) continue;
    const o = items.find((x) => x.def === id);
    if (o) return o;
  }
  return null;
}

/** ref: include/obj.h mwelded(): a wielded cursed weapon cannot be put down */
const welded = (o: Entity): boolean => o.c.item?.buc === 'cursed' && o.c.item.equipped === 'weapon';

/**
 * The monster wields its best hand-to-hand weapon; returns true if that cost it its move
 * (it wielded something, or tried and found its weapon welded).
 * ref: src/weapon.c mon_wield_item() with weapon_check == NEED_HTH_WEAPON. A monster whose
 * weapon is welded stops trying (NO_WEAPON_WANTED, the `nowep` flag).
 */
export function monWieldItem(ctx: GearCtx, monId: EntityId): boolean {
  if (monFlag(ctx, 'nowep', monId)) return false;
  const { e, def } = monOf(ctx, monId);
  const obj = selectHwep(ctx, monId);
  if (!obj) return false;
  const cur = monWep(ctx, monId);
  if (cur && cur.def === obj.def) return false; // already wielding it
  const pos = e.c.pos;
  const seen = pos !== undefined && sees(ctx, pos);
  if (cur && welded(cur)) {
    if (seen) {
      ctx.emit({
        type: 'msg',
        key: 'mon.tries_to_wield',
        params: { mon: `@${def.id}`, item: doname(ctx.state, ctx.defs, obj) },
      });
      ctx.emit({
        type: 'msg',
        key: (cur.c.item?.quantity ?? 1) > 1 ? 'mon.weapon_welded_plural' : 'mon.weapon_welded',
        params: { mon: `@${def.id}`, obj: xnameOf(ctx.state, ctx.defs, cur) },
      });
    }
    setMonFlag(ctx, 'nowep', monId, true);
    return true;
  }
  if (seen) {
    ctx.emit({
      type: 'msg',
      key: 'mon.wields',
      params: { mon: `@${def.id}`, item: doname(ctx.state, ctx.defs, obj) },
    });
  }
  if (cur?.c.item) cur.c.item.equipped = null;
  if (obj.c.item) obj.c.item.equipped = 'weapon';
  if (welded(obj) && seen) {
    ctx.emit({
      type: 'msg',
      key: (obj.c.item?.quantity ?? 1) > 1 ? 'mon.welds_plural' : 'mon.welds',
      params: { mon: `@${def.id}`, obj: xnameOf(ctx.state, ctx.defs, obj) },
    });
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// picking things up

/** ref: src/mon.c max_mon_load(); MAX_CARR_CAP 1000, WT_HUMAN 1450 */
export function maxMonLoad(def: MonsterDef): number {
  const MAX_CARR_CAP = 1000;
  const WT_HUMAN = 1450;
  let maxload: number;
  if (!def.weight) {
    const MZ = { tiny: 0, small: 1, medium: 2, large: 3, huge: 4, gigantic: 7 } as const;
    maxload = Math.trunc((MAX_CARR_CAP * MZ[def.size]) / MZ.medium);
  } else if (!isStrong(def) || def.weight > WT_HUMAN) {
    maxload = Math.trunc((MAX_CARR_CAP * def.weight) / WT_HUMAN);
  } else maxload = MAX_CARR_CAP;
  if (!isStrong(def)) maxload = Math.trunc(maxload / 2);
  return Math.max(maxload, 1);
}

/** ref: src/mon.c curr_mon_load() */
export function currMonLoad(ctx: Pick<GearCtx, 'state' | 'defs'>, id: EntityId): number {
  let n = 0;
  for (const o of inventoryOf(ctx.state, id)) n += weight(ctx.defs, o);
  return n;
}

/** Potions the roster's thinking monsters look for. ref: src/muse.c searches_for_item() */
const SEARCHED = new Set([
  'nh:potion_of_healing',
  'nh:potion_of_extra_healing',
  'nh:potion_of_full_healing',
]);

/**
 * Whether the monster would love to have the floor item. ref: src/monmove.c
 * mon_would_take_item(): useful potions for thinking monsters; gold for the greedy; gems for
 * jewel lovers; weapons, armor and food (not gems we lack) for object lovers; all only while
 * the monster's load is under a limit. Not ported: unicorns, gelatinous cubes, boulder
 * throwers, magic lovers (nothing in the roster has M2_MAGIC).
 */
export function monWouldTakeItem(
  ctx: Pick<GearCtx, 'state' | 'defs'>,
  monId: EntityId,
  item: Entity,
): boolean {
  const { def } = monOf(ctx, monId);
  const od = ctx.defs.object(item.def);
  const pctload = Math.trunc((currMonLoad(ctx, monId) * 100) / maxMonLoad(def));
  if (!hasFlag(def, 'mindless') && !hasFlag(def, 'animal') && pctload < 75 && SEARCHED.has(od.id))
    return true;
  if (likesGold(def) && od.class === 'coin' && pctload < 95) return true;
  if (
    likesObjs(def) &&
    (od.class === 'weapon' || od.class === 'armor' || od.class === 'food') &&
    pctload < 75
  )
    return true;
  return false;
}

/**
 * How many of the stack the monster could carry (0 = none). ref: src/mon.c can_carry():
 * handless monsters take one, peacefuls take nothing, and the load must stay under the maximum.
 */
export function canCarry(
  ctx: Pick<GearCtx, 'state' | 'defs'>,
  monId: EntityId,
  item: Entity,
): number {
  const { e, def } = monOf(ctx, monId);
  const iquan = item.c.item?.quantity ?? 1;
  if (iquan > 1 && hasFlag(def, 'nohands')) return 1;
  if (e.c.monster?.peaceful) return 0;
  if (currMonLoad(ctx, monId) + weight(ctx.defs, item) > maxMonLoad(def)) return 0;
  return iquan;
}

/**
 * The monster picks up one item stack from the cell it stands on.
 * ref: src/mon.c mpickstuff(). Corpses are never picked up (none of the roster is a nymph or
 * handles cockatrice or acidic corpses). The monster then wants to re-check its gear.
 */
export function mpickstuff(ctx: GearCtx, monId: EntityId): boolean {
  const { e, def } = monOf(ctx, monId);
  const pos = e.c.pos;
  if (!pos) return false;
  for (const o of itemsAt(ctx.defs, ctx.state, pos.level, pos.x, pos.y)) {
    if (!monWouldTakeItem(ctx, monId, o)) continue;
    if (o.def === 'nh:corpse') continue;
    const carry = canCarry(ctx, monId, o);
    if (carry === 0) continue;
    let take = o.id;
    if (carry !== (o.c.item?.quantity ?? 1)) take = splitStack(ctx, o.id, carry);
    if (sees(ctx, pos)) {
      const shown = ctx.state.entities[String(take)];
      if (shown) {
        ctx.emit({
          type: 'msg',
          key: 'mon.picks_up',
          params: { mon: `@${def.id}`, item: doname(ctx.state, ctx.defs, shown) },
        });
      }
    }
    addToInventory(ctx, monId, take);
    setMonFlag(ctx, 'gearchk', monId, true); // check_gear_next_turn()
    setMonFlag(ctx, 'nowep', monId, false); // weapon_check = NEED_WEAPON
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// dropping

/**
 * Drops everything the monster carries onto the floor where it is (or `at`), newest item
 * first, so the oldest ends on top. ref: src/steal.c relobj() / mdrop_obj()
 */
export function relobj(
  ctx: GearCtx,
  monId: EntityId,
  at?: { level: string; x: number; y: number },
): void {
  const pos = at ?? ctx.state.entities[String(monId)]?.c.pos;
  for (const o of minvent(ctx, monId)) {
    if (pos) placeOnFloor(ctx, o.id, pos.level, pos.x, pos.y);
    else {
      removeFromInventory(ctx, o.id);
      ctx.remove(o.id);
    }
  }
}

/** Gear step for a freshly made monster. ref: src/makemon.c makemon() "allow_minvent" */
export function givePossessions(ctx: GearCtx, monId: EntityId, depth: number): void {
  const { def } = monOf(ctx, monId);
  if (isArmed(def)) mInitWeap(ctx, monId);
  mInitInv(ctx, monId, depth);
  mDoWear(ctx, monId, true);
}
