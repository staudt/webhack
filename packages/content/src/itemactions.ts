// Item actions: pick up, drop, wield, wear, take off, discoveries, and looking at the floor.
// ref: src/pickup.c, src/do.c, src/wield.c, src/do_wear.c, src/o_init.c, src/invent.c look_here()
import {
  NORMAL_SPEED,
  getPlayer,
  inventoryOf,
  itemsAt,
  shownId,
  type ActionDef,
  type ArmorSlot,
  type Ctx,
  type DefId,
  type Entity,
  type EntityId,
  type Json,
  type Msg,
  type ObjectDef,
  type Offer,
  type PlayerAction,
  type PromptOption,
} from '@nh/core';
import {
  NOINVSYM,
  addToInventory,
  invCount,
  mergable,
  nhData,
  placeOnFloor,
  removeFromInventory,
  splitStack,
  weight,
} from './items';
import { nomul } from './nomul';
import { xnameOf } from './objnam';
import { calcCapacity, invWeight, moneyCount, nearCapacity, weightCap } from './stats';

// ---------------------------------------------------------------------------------------------
// helpers

const hero = (ctx: Ctx): Entity => getPlayer(ctx.state);

/** The hero's item with this id, or null. */
function heroItem(ctx: Ctx, id: unknown): Entity | null {
  if (typeof id !== 'number') return null;
  const e = ctx.state.entities[String(id)];
  return e?.c.item?.carriedBy === ctx.state.playerId ? e : null;
}

function itemArg(action: PlayerAction): number | null | undefined {
  if (action.type !== 'mod') return undefined;
  const a = action.args as { item?: unknown } | undefined;
  if (a?.item === null) return null;
  return typeof a?.item === 'number' ? a.item : undefined;
}

const wielded = (ctx: Ctx): Entity | null =>
  inventoryOf(ctx.state, ctx.state.playerId).find((o) => o.c.item?.equipped === 'weapon') ?? null;

const wornIn = (ctx: Ctx, slot: ArmorSlot): Entity | null =>
  inventoryOf(ctx.state, ctx.state.playerId).find((o) => o.c.item?.equipped === slot) ?? null;

const defOf = (ctx: Ctx, e: Entity): ObjectDef => ctx.defs.object(e.def);

/** The item's full name (doname) as if it had `quantity` items. */
function nameQty(ctx: Ctx, e: Entity, quantity?: number): Msg {
  const it = e.c.item;
  if (!it || quantity === undefined || quantity === it.quantity)
    return ctx.defs.itemName(ctx.state, e);
  return ctx.defs.itemName(ctx.state, { ...e, c: { ...e.c, item: { ...it, quantity } } });
}

/**
 * "j - a food ration." ref: src/invent.c prinv()/xprname(). `count` is the number just added when
 * it is less than the stack's quantity ("(5 in total)"). `prefix` is a pickup encumbrance Msg.
 */
export function prinv(ctx: Ctx, e: Entity, count = 0, prefix: Msg | null = null): void {
  const it = e.c.item;
  if (!it) return;
  const totalOf = count > 0 && count < it.quantity;
  const total: Msg | string = totalOf ? { key: 'inv.total', params: { n: it.quantity } } : '.';
  ctx.emit({
    type: 'msg',
    key: 'inv.item',
    params: {
      prefix: prefix ? { key: 'inv.prefix', params: { load: prefix } } : '',
      letter: it.letter ?? NOINVSYM,
      item: nameQty(ctx, e, totalOf ? count : undefined),
      total,
    },
  });
}

/** ref: src/pickup.c slightloadpfx etc. */
const loadPrefix = (level: number): Msg | null =>
  level >= 4
    ? { key: 'load.extreme' }
    : level >= 3
      ? { key: 'load.much' }
      : level >= 2
        ? { key: 'load.moderate' }
        : level >= 1
          ? { key: 'load.slight' }
          : null;

/** ref: src/pickup.c encumber_msg(): says so when the load level changed. */
export function encumberMsg(ctx: Ctx): void {
  const data = nhData(ctx);
  const old = data.oldcap ?? 0;
  const now = nearCapacity(ctx.state, ctx.defs, ctx.state.playerId);
  if (old < now) ctx.emit({ type: 'msg', key: `encumber.up.${Math.min(now, 4)}` });
  else if (old > now && now <= 3) ctx.emit({ type: 'msg', key: `encumber.down.${now}` });
  if (old !== now) data.oldcap = now;
}

const selfOffer = (id: DefId, labelKey: string): Offer[] => [
  { action: { type: 'mod', action: id }, labelKey },
];
const itemOffer = (action: DefId, id: EntityId, labelKey: string, item: Json = id): Offer => ({
  action: { type: 'mod', action, args: { item } },
  labelKey,
});

/** ref: include/objclass.h is_sword(): short sword .. saber skills */
const SWORD_SKILLS = ['short_sword', 'broad_sword', 'long_sword', 'two_handed_sword', 'saber'];
/** "sword", "axe" or "weapon" for the two-handed messages. ref: src/wield.c, src/do_wear.c */
const weaponKind = (def: ObjectDef): Msg => ({
  key: def.weapon && SWORD_SKILLS.includes(def.weapon.skill) ? 'kind.sword' : 'kind.weapon',
});

// ---------------------------------------------------------------------------------------------
// looking at the floor

/**
 * What is here after moving onto a cell with objects, as pickup() -> check_here() -> look_here()
 * with autopickup off: "You see here X.", a list of up to 4, or "There are several objects here.".
 * Stops multi-turn movement (travel). ref: src/pickup.c check_here(), src/invent.c look_here()
 * with pile_limit 5. Not ported: dungeon features, engravings, traps, blindness.
 */
export function lookHere(ctx: Ctx): void {
  const pos = hero(ctx).c.pos;
  if (!pos) return;
  const here = itemsAt(ctx.defs, ctx.state, pos.level, pos.x, pos.y);
  const ct = here.length;
  if (ct === 0) return;
  ctx.interrupt();
  if (ct >= 5) {
    ctx.emit({ type: 'msg', key: ct < 10 ? 'look.several' : 'look.many' });
  } else if (ct === 1) {
    const only = here[0];
    if (only) ctx.emit({ type: 'msg', key: 'look.one', params: { item: nameQty(ctx, only) } });
  } else {
    ctx.emit({
      type: 'list',
      titleKey: 'look.things',
      items: here.map((e) => ({ key: 'look.item', params: { item: nameQty(ctx, e) } })),
    });
  }
}

// ---------------------------------------------------------------------------------------------
// pick up

/** Serializable state of a pickup in progress. */
interface PickData {
  stage: 'menu' | 'confirm';
  /** Objects still to take, in order; the first is the current one. */
  ids: number[];
  /** Highest load level announced so far (ref: pickup_encumbrance). */
  enc: number;
  picked: number;
  /** For a pending confirmation: how many of the first object to lift. */
  qq?: number;
  /** The answer to the confirmation, once given. */
  ok?: boolean;
}

const GOLD_WT = (n: number): number => Math.trunc((n + 50) / 100);

/**
 * How many of `count` objects the hero can lift, printing why not. ref: src/pickup.c carry_count()
 * (floor objects only). Returns the count and the weight it adds.
 */
function carryCount(ctx: Ctx, obj: Entity, count: number): { qq: number; xtra: number } {
  const it = obj.c.item;
  const state = ctx.state;
  const id = state.playerId;
  const isGold = defOf(ctx, obj).class === 'coin';
  const umoney = moneyCount(state, ctx.defs, id);
  const iw0 = invWeight(state, ctx.defs, id) - 2 * weightCap(state, id); // max_capacity()
  const owtOf = (n: number): number =>
    isGold
      ? GOLD_WT(n)
      : weight(ctx.defs, {
          ...obj,
          c: { ...obj.c, item: { ...(it as NonNullable<typeof it>), quantity: n } },
        });
  let wt = iw0 + owtOf(count);
  if (isGold) wt -= GOLD_WT(umoney) + GOLD_WT(count) - GOLD_WT(umoney + count);
  const delta = (n: number): number => (isGold ? GOLD_WT(umoney + n) - GOLD_WT(umoney) : owtOf(n));
  if (wt < 0) return { qq: count, xtra: delta(count) };

  let qq: number;
  let iw = iw0;
  if (isGold) {
    iw -= GOLD_WT(umoney);
    qq = -iw * 100 - (umoney + 50) - 1; // GOLD_CAPACITY
    if (qq < 0) qq = 0;
    else if (qq > count) qq = count;
  } else if (count > 1) {
    for (qq = 1; qq <= count; qq++) if (iw + owtOf(qq) >= 0) break;
    --qq;
  } else qq = 0;

  const item = ctx.defs.itemName(state, obj);
  if (qq > 0) {
    if (qq < count) {
      ctx.emit({
        type: 'msg',
        key: qq === 1 ? 'pickup.only_one' : 'pickup.only_some',
        params: { item },
      });
    }
    return { qq, xtra: delta(qq) };
  }
  const carrying = inventoryOf(state, id).length > 0 || umoney > 0;
  const plural = (it?.quantity ?? 1) !== 1;
  ctx.emit({
    type: 'msg',
    key: carrying
      ? plural
        ? 'pickup.no_more_pl'
        : 'pickup.no_more'
      : plural
        ? 'pickup.heavy_pl'
        : 'pickup.heavy',
    params: { item },
  });
  return { qq: 0, xtra: 0 };
}

type PickResult = 'picked' | 'none' | 'abort' | 'ask';

/** ref: src/pickup.c pickup_object() / lift_object() for a floor object. */
function pickupObject(ctx: Ctx, obj: Entity, data: PickData): PickResult {
  const it = obj.c.item;
  if (!it) return 'none';
  const state = ctx.state;
  const id = state.playerId;
  const def = defOf(ctx, obj);

  let qq = data.qq;
  if (qq === undefined) {
    const cc = carryCount(ctx, obj, it.quantity);
    if (cc.qq < 1) return 'abort';
    qq = cc.qq;
    // the knapsack holds 52 letters; gold needs none
    const mergeChoice = inventoryOf(state, id).some((o) => mergable(ctx.defs, o, obj));
    if (def.class !== 'coin' && invCount(ctx, id) >= 52 && !mergeChoice) {
      const gold = itemsAt(
        ctx.defs,
        state,
        obj.c.pos?.level ?? '',
        obj.c.pos?.x ?? 0,
        obj.c.pos?.y ?? 0,
      ).some((o) => o.id !== obj.id && ctx.defs.object(o.def).class === 'coin');
      ctx.emit({ type: 'msg', key: gold ? 'pickup.full_gold' : 'pickup.full' });
      return 'abort';
    }
    // "You have a little trouble lifting X.  Continue?" once the load passes Stressed
    // (flags.pickup_burden defaults to Stressed). ref: lift_object()
    const prev = Math.max(nearCapacity(state, ctx.defs, id), 2);
    const next = calcCapacity(state, ctx.defs, id, cc.xtra);
    if (next > prev) {
      const load = loadPrefix(next);
      data.qq = qq;
      data.stage = 'confirm';
      ctx.ask(
        {
          id: 'pickup-confirm',
          kind: 'yn',
          key: 'pickup.confirm',
          params: { load: load ?? '', item: nameQty(ctx, obj, qq) },
        },
        'nh:pickup',
        data as unknown as Json,
      );
      return 'ask';
    }
  } else {
    // resuming after the confirmation
    const ok = data.ok;
    delete data.qq;
    delete data.ok;
    if (!ok) return 'none';
  }

  const part = qq < it.quantity ? splitStack(ctx, obj.id, qq) : obj.id;
  const merged = addToInventory(ctx, id, part);
  const stack = state.entities[String(merged)];
  if (!stack) return 'none';
  const near = nearCapacity(state, ctx.defs, id);
  let prefix: Msg | null = null;
  if (near !== data.enc) {
    prefix = loadPrefix(near);
    data.enc = near;
  }
  prinv(ctx, stack, qq, prefix ? { key: 'pickup.lifting', params: { load: prefix } } : null);
  return 'picked';
}

/** Takes the queued objects one by one. Returns the energy used (ask() pauses it). */
function pickupLoop(ctx: Ctx, data: PickData): number {
  while (data.ids.length > 0) {
    const id = data.ids[0];
    const e = id === undefined ? undefined : ctx.state.entities[String(id)];
    const pos = hero(ctx).c.pos;
    if (!e || !pos || e.c.pos?.x !== pos.x || e.c.pos.y !== pos.y || e.c.pos.level !== pos.level) {
      data.ids.shift();
      continue;
    }
    const r = pickupObject(ctx, e, data);
    if (r === 'ask') return 0;
    data.ids.shift();
    if (r === 'abort') break;
    if (r === 'picked') data.picked++;
  }
  encumberMsg(ctx);
  return data.picked > 0 ? NORMAL_SPEED : 0;
}

function floorHere(ctx: Ctx): Entity[] {
  const pos = hero(ctx).c.pos;
  return pos ? itemsAt(ctx.defs, ctx.state, pos.level, pos.x, pos.y) : [];
}

const pickup: ActionDef = {
  id: 'nh:pickup',
  labelKey: 'action.nh:pickup',
  handles: 'mod',
  offer: (ctx, target) =>
    target.kind === 'self' && floorHere(ctx).length > 0
      ? selfOffer('nh:pickup', 'action.nh:pickup')
      : [],
  // ref: src/pickup.c pickup(what = 0): one object is taken directly, several are chosen from a menu
  perform(ctx) {
    const here = floorHere(ctx);
    if (here.length === 0) {
      ctx.emit({ type: 'msg', key: 'pickup.nothing' });
      return 0;
    }
    const data: PickData = { stage: 'menu', ids: here.map((e) => e.id), enc: 0, picked: 0 };
    if (here.length === 1) return pickupLoop(ctx, data);
    const options: PromptOption[] = here.map((e) => {
      return {
        value: e.id,
        key: 'pickup.item',
        params: { item: ctx.defs.itemName(ctx.state, e) },
        glyph: shownId(ctx.state, e.def),
      };
    });
    ctx.ask(
      { id: 'pickup-menu', kind: 'menu', key: 'pickup.menu', options, multi: true },
      'nh:pickup',
      data as unknown as Json,
    );
    return 0;
  },
  answer(ctx, value, raw) {
    const data = raw as unknown as PickData;
    if (data.stage === 'confirm') {
      data.ok = value === true;
      return pickupLoop(ctx, data);
    }
    const chosen = Array.isArray(value) ? value : [];
    data.ids = data.ids.filter((id) => chosen.includes(id));
    return pickupLoop(ctx, data);
  },
};

// ---------------------------------------------------------------------------------------------
// drop

/** Cursed weapons weld to the hand. ref: src/wield.c welded(), will_weld() */
function welded(ctx: Ctx, e: Entity): boolean {
  const it = e.c.item;
  if (!it || it.equipped !== 'weapon' || it.buc !== 'cursed') return false;
  it.known.buc = true; // welded() sets bknown
  return true;
}

/** "The X is welded to your hand!" ref: src/wield.c weldmsg() */
function weldMsg(ctx: Ctx, e: Entity): void {
  const bi = defOf(ctx, e).weapon?.bimanual === true;
  const pl = (e.c.item?.quantity ?? 1) !== 1;
  ctx.emit({
    type: 'msg',
    key: `wield.welded${pl ? '_pl' : ''}${bi ? '_hands' : ''}`,
    params: { item: xnameOf(ctx.state, ctx.defs, e) },
  });
}

/** Drops one carried stack. ref: src/do.c drop(), canletgo(), dropx(). Returns whether it was dropped. */
function dropItem(ctx: Ctx, e: Entity): boolean {
  const it = e.c.item;
  const pos = hero(ctx).c.pos;
  if (!it || !pos) return false;
  // canletgo(): worn armor and a welded weapon stay
  if (it.equipped !== null && it.equipped !== 'weapon') {
    ctx.emit({ type: 'msg', key: 'drop.worn' });
    return false;
  }
  if (welded(ctx, e)) {
    const bi = defOf(ctx, e).weapon?.bimanual === true;
    ctx.emit({ type: 'msg', key: bi ? 'drop.welded_hands' : 'drop.welded' });
    return false;
  }
  if (it.equipped === 'weapon') it.equipped = null; // setuwep(NULL)
  ctx.emit({
    type: 'msg',
    key: 'drop.you_drop',
    params: { item: ctx.defs.itemName(ctx.state, e) },
  });
  removeFromInventory(ctx, e.id);
  placeOnFloor(ctx, e.id, pos.level, pos.x, pos.y);
  return true;
}

const drop: ActionDef = {
  id: 'nh:drop',
  labelKey: 'action.nh:drop',
  handles: 'mod',
  offer: (_ctx, target) =>
    target.kind === 'item' ? [itemOffer('nh:drop', target.id, 'action.nh:drop')] : [],
  perform(ctx, action) {
    const e = heroItem(ctx, itemArg(action));
    if (!e) return 0;
    if (!dropItem(ctx, e)) return 0;
    encumberMsg(ctx);
    return NORMAL_SPEED;
  },
};

/** The menu entry for an inventory item: "a - a +1 spear (weapon in hand)". */
function invOption(ctx: Ctx, e: Entity): PromptOption {
  return {
    value: e.id,
    key: 'inv.menu_item',
    params: { letter: e.c.item?.letter ?? NOINVSYM, item: ctx.defs.itemName(ctx.state, e) },
    glyph: shownId(ctx.state, e.def),
  };
}

const dropMany: ActionDef = {
  id: 'nh:drop_many',
  labelKey: 'action.nh:drop_many',
  handles: 'mod',
  offer: (ctx, target) =>
    target.kind === 'self' && inventoryOf(ctx.state, ctx.state.playerId).length > 0
      ? selfOffer('nh:drop_many', 'action.nh:drop_many')
      : [],
  // ref: src/do.c doddrop() -> menu_drop(): choose several items, drop each
  perform(ctx) {
    const inv = inventoryOf(ctx.state, ctx.state.playerId);
    if (inv.length === 0) {
      ctx.emit({ type: 'msg', key: 'drop.nothing' });
      return 0;
    }
    ctx.ask(
      {
        id: 'drop-menu',
        kind: 'menu',
        key: 'drop.menu',
        options: inv.map((e) => invOption(ctx, e)),
        multi: true,
      },
      'nh:drop_many',
      null,
    );
    return 0;
  },
  answer(ctx, value) {
    const chosen = Array.isArray(value) ? value : [];
    let n = 0;
    for (const id of chosen) {
      const e = heroItem(ctx, id);
      if (e && dropItem(ctx, e)) n++;
    }
    encumberMsg(ctx);
    return n > 0 ? NORMAL_SPEED : 0;
  },
};

// ---------------------------------------------------------------------------------------------
// wield

/** "You are empty handed." wording. ref: src/wield.c empty_handed() */
const handsKey = (ctx: Ctx): string =>
  wornIn(ctx, 'gloves') ? 'wield.empty_handed' : 'wield.bare_handed';

const wield: ActionDef = {
  id: 'nh:wield',
  labelKey: 'action.nh:wield',
  handles: 'mod',
  offer(ctx, target) {
    if (target.kind !== 'item') return [];
    const e = heroItem(ctx, target.id);
    const it = e?.c.item;
    if (!e || !it) return [];
    return defOf(ctx, e).class === 'weapon' && it.equipped === null
      ? [itemOffer('nh:wield', e.id, 'action.nh:wield')]
      : [];
  },
  // ref: src/wield.c dowield(), ready_weapon()
  perform(ctx, action) {
    const arg = itemArg(action);
    if (arg === undefined) return 0;
    const cur = wielded(ctx);
    if (arg === null) {
      // wield nothing
      if (!cur) {
        ctx.emit({
          type: 'msg',
          key: 'wield.already_nothing',
          params: { how: { key: handsKey(ctx) } },
        });
        return 0;
      }
      if (welded(ctx, cur)) {
        weldMsg(ctx, cur);
        return 0;
      }
      return unwield(ctx, cur);
    }
    const wep = heroItem(ctx, arg);
    const wit = wep?.c.item;
    if (!wep || !wit) return 0;
    if (wep.id === cur?.id) {
      ctx.emit({ type: 'msg', key: 'wield.already' });
      return 0;
    }
    if (cur && welded(ctx, cur)) {
      weldMsg(ctx, cur);
      return 0;
    }
    if (wit.equipped !== null) {
      ctx.emit({ type: 'msg', key: 'wield.cannot' });
      return 0;
    }
    const def = defOf(ctx, wep);
    if (wornIn(ctx, 'shield') && def.weapon?.bimanual) {
      ctx.emit({ type: 'msg', key: 'wield.two_handed_shield', params: { kind: weaponKind(def) } });
      return 0;
    }
    // a weapon is wielded from here on
    if (cur?.c.item) cur.c.item.equipped = null;
    wit.equipped = 'weapon';
    if (wit.buc === 'cursed') {
      const bi = def.weapon?.bimanual === true;
      const pl = wit.quantity !== 1;
      ctx.emit({
        type: 'msg',
        key: `wield.weld${pl ? '_pl' : ''}${bi ? '_hands' : ''}`,
        params: { item: xnameOf(ctx.state, ctx.defs, wep) },
      });
      wit.known.buc = true;
    } else prinv(ctx, wep);
    return NORMAL_SPEED;
  },
};

function unwield(ctx: Ctx, cur: Entity): number {
  if (cur.c.item) cur.c.item.equipped = null;
  ctx.emit({ type: 'msg', key: 'wield.you_are', params: { how: { key: handsKey(ctx) } } });
  return NORMAL_SPEED;
}

/**
 * "Wield nothing" (w-) as its own action, offered on the wielded item, so pickers for `w`
 * list only things you could wield. Not offered once the weapon is known to be cursed.
 */
const unwieldAction: ActionDef = {
  id: 'nh:unwield',
  labelKey: 'action.nh:wield_nothing',
  handles: 'mod',
  offer(ctx, target) {
    if (target.kind !== 'item') return [];
    const e = heroItem(ctx, target.id);
    const it = e?.c.item;
    if (!e || !it || it.equipped !== 'weapon') return [];
    return it.known.buc && it.buc === 'cursed'
      ? []
      : [itemOffer('nh:unwield', e.id, 'action.nh:wield_nothing', null)];
  },
  perform: (ctx) => wield.perform(ctx, { type: 'mod', action: 'nh:wield', args: { item: null } }),
};

// ---------------------------------------------------------------------------------------------
// wear / take off

const finishDressing: Msg = { key: 'wear.finish' };

/** Armor slots by name for messages. ref: src/do_wear.c c_cloak etc. */
const SLOT_NOUN: Record<ArmorSlot, string> = {
  body: 'suit',
  cloak: 'cloak',
  shirt: 'shirt',
  helm: 'helm',
  gloves: 'gloves',
  boots: 'boots',
  shield: 'shield',
};

/**
 * Whether the armor can be put on; says why not when `noisy`. ref: src/do_wear.c canwearobj()
 * (no polymorph, traps or slippery fingers).
 */
function canWear(ctx: Ctx, obj: Entity, noisy: boolean): boolean {
  const it = obj.c.item;
  const armor = defOf(ctx, obj).armor;
  if (!it || !armor) return false;
  const say = (key: string, params?: Record<string, Msg | string | number>): false => {
    if (noisy) ctx.emit({ type: 'msg', key, ...(params ? { params } : {}) });
    return false;
  };
  if (it.equipped !== null) return say('wear.already_that');
  const uwep = wielded(ctx);
  const uwepDef = uwep ? defOf(ctx, uwep) : null;
  const weldedBi =
    uwep !== null && uwep.c.item?.buc === 'cursed' && uwepDef?.weapon?.bimanual === true;
  const weldedUwep = uwep !== null && uwep.c.item?.buc === 'cursed';
  const wk = (): Msg => (uwepDef ? weaponKind(uwepDef) : { key: 'kind.weapon' });
  const slot = armor.slot;
  if (weldedBi && (slot === 'body' || slot === 'shirt')) {
    if (noisy && uwep) welded(ctx, uwep);
    return say('wear.while_holding', { kind: wk() });
  }
  const suit = wornIn(ctx, 'body');
  const cloak = wornIn(ctx, 'cloak');
  const shirt = wornIn(ctx, 'shirt');
  switch (slot) {
    case 'helm':
      return wornIn(ctx, 'helm') ? say('wear.already.helm') : true;
    case 'shield':
      if (wornIn(ctx, 'shield')) return say('wear.already.shield');
      if (uwepDef?.weapon?.bimanual) return say('wear.shield_two_handed', { kind: wk() });
      return true;
    case 'boots':
      return wornIn(ctx, 'boots') ? say('wear.already.boots') : true;
    case 'gloves':
      if (wornIn(ctx, 'gloves')) return say('wear.already.gloves');
      if (weldedUwep) {
        if (noisy && uwep) welded(ctx, uwep);
        return say('wear.gloves_weapon', { kind: wk() });
      }
      return true;
    case 'shirt':
      if (suit || cloak || shirt) {
        if (shirt) return say('wear.already.shirt');
        return say('wear.over', { what: { key: suit && !cloak ? 'kind.armor' : 'kind.cloak' } });
      }
      return true;
    case 'cloak':
      return cloak ? say('wear.already.cloak') : true;
    case 'body':
      if (cloak) return say('wear.armor_over_cloak');
      if (suit) return say('wear.already.suit');
      return true;
  }
}

const wear: ActionDef = {
  id: 'nh:wear',
  labelKey: 'action.nh:wear',
  handles: 'mod',
  offer(ctx, target) {
    if (target.kind !== 'item') return [];
    const e = heroItem(ctx, target.id);
    return e && defOf(ctx, e).armor && canWear(ctx, e, false)
      ? [itemOffer('nh:wear', e.id, 'action.nh:wear')]
      : [];
  },
  // ref: src/do_wear.c dowear() -> accessory_or_armor_on(): the armor counts at once (a
  // simplification: NetHack applies it when the delay ends), then the hero is busy for oc_delay turns.
  perform(ctx, action) {
    const obj = heroItem(ctx, itemArg(action));
    const it = obj?.c.item;
    if (!obj || !it) return 0;
    const def = defOf(ctx, obj);
    if (!def.armor) {
      ctx.emit({ type: 'msg', key: 'wear.cant' });
      return 0;
    }
    if (!canWear(ctx, obj, true)) return 0;
    it.equipped = def.armor.slot;
    it.known.spe = true; // Armor_on() etc.: "+/- evident because of status line AC"
    if (def.delay > 0) {
      return NORMAL_SPEED + nomul(ctx, def.delay, 'helpless.dressing', finishDressing);
    }
    ctx.emit({ type: 'msg', key: 'wear.now', params: { item: xnameOf(ctx.state, ctx.defs, obj) } });
    return NORMAL_SPEED;
  },
};

/** Whether `obj` is worn armor that can be reached (not under another layer). ref: equip_ok() */
function takeoffOk(ctx: Ctx, obj: Entity): boolean {
  const slot = obj.c.item?.equipped;
  if (!slot || slot === 'weapon') return false;
  if (slot === 'body' && wornIn(ctx, 'cloak')) return false;
  if (slot === 'shirt' && (wornIn(ctx, 'cloak') || wornIn(ctx, 'body'))) return false;
  return true;
}

/** "You can't.  It is cursed." ref: src/do_wear.c cursed() */
function cursedWorn(ctx: Ctx, obj: Entity): boolean {
  const it = obj.c.item;
  if (!it || it.buc !== 'cursed') return false;
  const slot = it.equipped;
  const pl = slot === 'boots' || slot === 'gloves' || it.quantity > 1;
  ctx.emit({ type: 'msg', key: pl ? 'takeoff.cursed_pl' : 'takeoff.cursed' });
  it.known.buc = true;
  return true;
}

const takeoff: ActionDef = {
  id: 'nh:takeoff',
  labelKey: 'action.nh:takeoff',
  handles: 'mod',
  offer(ctx, target) {
    if (target.kind !== 'item') return [];
    const e = heroItem(ctx, target.id);
    return e && takeoffOk(ctx, e) ? [itemOffer('nh:takeoff', e.id, 'action.nh:takeoff')] : [];
  },
  // ref: src/do_wear.c dotakeoff() -> armor_or_accessory_off(), select_off(), armoroff()
  perform(ctx, action) {
    const obj = heroItem(ctx, itemArg(action));
    const it = obj?.c.item;
    if (!obj || !it) return 0;
    const slot = it.equipped;
    if (!slot || slot === 'weapon') {
      ctx.emit({ type: 'msg', key: 'takeoff.not_wearing' });
      return 0;
    }
    const cloak = wornIn(ctx, 'cloak');
    const suit = wornIn(ctx, 'body');
    if ((slot === 'body' && cloak) || (slot === 'shirt' && (cloak || suit))) {
      const what = cloak && slot === 'shirt' && suit ? 'cloak_suit' : cloak ? 'cloak' : 'suit';
      ctx.emit({ type: 'msg', key: `takeoff.cant_without.${what}` });
      return 0;
    }
    // select_off() special cases
    const uwep = wielded(ctx);
    const weldedUwep = uwep !== null && uwep.c.item?.buc === 'cursed';
    const wdef = uwep ? defOf(ctx, uwep) : null;
    const kind: Msg = wdef ? weaponKind(wdef) : { key: 'kind.weapon' };
    if (slot === 'gloves' && weldedUwep && uwep) {
      welded(ctx, uwep);
      ctx.emit({ type: 'msg', key: 'takeoff.gloves_weapon', params: { kind } });
      return 0;
    }
    if (slot === 'body' || slot === 'shirt') {
      let why: { key: string; entity: Entity } | null = null;
      if (cloak?.c.item?.buc === 'cursed') why = { key: 'takeoff.why.cloak', entity: cloak };
      else if (slot === 'shirt' && suit?.c.item?.buc === 'cursed')
        why = { key: 'takeoff.why.suit', entity: suit };
      else if (weldedUwep && wdef?.weapon?.bimanual && uwep)
        why = { key: 'takeoff.why.weapon', entity: uwep };
      if (why) {
        if (why.entity.c.item) why.entity.c.item.known.buc = true;
        ctx.emit({
          type: 'msg',
          key: 'takeoff.cannot_to',
          params: {
            why: { key: why.key, params: { kind } },
            item: xnameOf(ctx.state, ctx.defs, obj),
          },
        });
        return 0;
      }
    }
    if (cursedWorn(ctx, obj)) return 0;
    it.equipped = null;
    const delay = defOf(ctx, obj).delay;
    if (delay > 0) {
      return (
        NORMAL_SPEED +
        nomul(ctx, delay, 'helpless.disrobing', {
          key: 'takeoff.finish',
          params: { what: { key: `kind.${SLOT_NOUN[slot]}` } },
        })
      );
    }
    ctx.emit({
      type: 'msg',
      key: 'takeoff.were_wearing',
      params: { item: ctx.defs.itemName(ctx.state, obj) },
    });
    return NORMAL_SPEED;
  },
};

// ---------------------------------------------------------------------------------------------
// discoveries

/** The order classes are listed in. ref: src/invent.c def_inv_order */
const DISCO_ORDER = ['weapon', 'armor', 'food', 'scroll', 'potion'] as const;

const discoveries: ActionDef = {
  id: 'nh:discoveries',
  labelKey: 'action.nh:discoveries',
  handles: 'mod',
  offer: (_ctx, target) =>
    target.kind === 'self' ? selfOffer('nh:discoveries', 'action.nh:discoveries') : [],
  // ref: src/o_init.c dodiscovered(): identified types that have a description ("name (description)").
  // Listed in object-list order, not discovery order.
  perform(ctx) {
    const items: Msg[] = [];
    for (const cls of DISCO_ORDER) {
      let head = false;
      for (const def of ctx.defs.objects) {
        if (def.class !== cls || !ctx.state.discovered.includes(def.id)) continue;
        const app = ctx.state.appearances[def.id];
        const desc = app !== undefined ? ctx.defs.appearance(app).nameKey : def.descKey;
        if (desc === undefined) continue; // interesting_to_discover(): needs a description
        if (!head) {
          items.push({ key: `disco.class.${cls}` });
          head = true;
        }
        items.push({
          key: 'disco.entry',
          params: { name: { key: def.nameKey }, desc: { key: desc } },
        });
      }
    }
    if (items.length === 0) ctx.emit({ type: 'msg', key: 'disco.none' });
    else ctx.emit({ type: 'list', titleKey: 'disco.title', items });
    return 0;
  },
};

export const ITEM_ACTIONS: readonly ActionDef[] = [
  pickup,
  drop,
  dropMany,
  wield,
  unwieldAction,
  wear,
  takeoff,
  discoveries,
];
