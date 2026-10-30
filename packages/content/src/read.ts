// Scrolls: reading and the effects of the scrolls in our subset.
// ref: src/read.c doread(), seffects(), seffect_identify(), seffect_enchant_weapon(),
// seffect_enchant_armor(), seffect_remove_curse(), seffect_light(), litroom();
// src/wield.c chwepon(); src/invent.c identify_pack(), menu_identify(); src/do_wear.c some_armor()
import {
  NORMAL_SPEED,
  computeVisible,
  cellRules,
  inventoryOf,
  shownId,
  type ActionDef,
  type Buc,
  type Ctx,
  type DefId,
  type Entity,
  type EntityId,
  type Json,
  type Level,
  type Msg,
  type ObjectDef,
  type Offer,
  type PlayerAction,
  type PromptOption,
} from '@nh/core';
import { prinv } from './itemactions';
import { NOINVSYM } from './items';
import { discover, isKnown } from './o_init';
import { xnameOf } from './objnam';
import { checkCapacity, color, heroEntity, strangeFeeling, useup, useupall } from './magic';

export const READ_ID: DefId = 'nh:read';

const msg = (ctx: Ctx, key: string, params?: Record<string, Msg | string | number>): void =>
  ctx.emit({ type: 'msg', key, ...(params ? { params } : {}) });

const wornIn = (ctx: Ctx, slot: string): Entity | undefined =>
  inventoryOf(ctx.state, ctx.state.playerId).find((o) => o.c.item?.equipped === slot);

/** Armor pairs and plural stacks take plural verbs ("Your boots glow"). ref: otense() */
const isPlural = (def: ObjectDef, e: Entity): boolean =>
  (e.c.item?.quantity ?? 1) !== 1 || def.armor?.slot === 'boots' || def.armor?.slot === 'gloves';

// ---------------------------------------------------------------------------------------------
// identify

/** ref: src/objnam.c not_fully_identified(), without rknown (erosion is not tracked) */
function notFullyIdentified(ctx: Ctx, e: Entity): boolean {
  const it = e.c.item;
  if (!it) return false;
  const def = ctx.defs.object(e.def);
  if (def.class === 'coin') return false;
  if (!it.known.buc) return true;
  if ((def.class === 'weapon' || def.class === 'armor') && !it.known.spe) return true;
  return !isKnown(ctx.state, ctx.defs, def);
}

/** ref: src/invent.c identify() / fully_identify_obj(): type, BUC and enchantment, then "d - ..." */
function identify(ctx: Ctx, e: Entity): void {
  const it = e.c.item;
  if (!it) return;
  discover(ctx, e.def);
  it.known.buc = true;
  it.known.spe = true;
  prinv(ctx, e);
}

const unidentified = (ctx: Ctx): Entity[] =>
  inventoryOf(ctx.state, ctx.state.playerId).filter((e) => notFullyIdentified(ctx, e));

interface IdentifyData {
  stage: 'identify';
  /** How many more items may be identified. */
  limit: number;
  first: boolean;
  tryct: number;
  /** The identify scroll was just learned (affects the "all/the rest" message). */
  learning: boolean;
}

const invOption = (ctx: Ctx, e: Entity): PromptOption => ({
  value: e.id,
  key: 'inv.menu_item',
  params: { letter: e.c.item?.letter ?? NOINVSYM, item: ctx.defs.itemName(ctx.state, e) },
  glyph: shownId(ctx.state, e.def),
});

/**
 * One round of ref: src/invent.c menu_identify(): asks which of the unidentified items to
 * identify (up to the limit). Returns true when a prompt was raised.
 */
function askIdentify(ctx: Ctx, data: IdentifyData): boolean {
  const list = unidentified(ctx);
  if (list.length === 0) {
    msg(ctx, 'identify.that_was_all');
    return false;
  }
  ctx.ask(
    {
      id: 'identify-menu',
      kind: 'menu',
      key: data.first ? 'identify.what_first' : 'identify.what_next',
      params: { n: data.limit },
      options: list.map((e) => invOption(ctx, e)),
      multi: true,
    },
    READ_ID,
    data as unknown as Json,
  );
  return true;
}

/**
 * ref: src/invent.c identify_pack(): identifies `limit` items (0 = all). Returns true when it
 * is waiting for the player's choice.
 */
function identifyPack(ctx: Ctx, limit: number, learning: boolean): boolean {
  const list = unidentified(ctx);
  if (list.length === 0) {
    msg(ctx, learning ? 'identify.already_rest' : 'identify.already_all');
    return false;
  }
  if (limit === 0 || limit >= list.length) {
    for (const e of list) identify(ctx, e);
    return false;
  }
  return askIdentify(ctx, { stage: 'identify', limit, first: true, tryct: 5, learning });
}

/** The answer to the identify menu. ref: src/invent.c menu_identify() loop. Returns true if it asked again. */
function identifyAnswer(ctx: Ctx, value: Json, data: IdentifyData): boolean {
  const chosen = Array.isArray(value) ? value : [];
  const picks = unidentified(ctx).filter((e) => chosen.includes(e.id));
  if (picks.length > 0) {
    const n = Math.min(picks.length, data.limit);
    for (const e of picks.slice(0, n)) identify(ctx, e);
    data.limit -= n;
    data.first = false;
    return data.limit > 0 ? askIdentify(ctx, data) : false;
  }
  if (!--data.tryct) {
    msg(ctx, 'identify.enough_tries');
    return false;
  }
  msg(ctx, 'identify.choose');
  return askIdentify(ctx, data);
}

/** ref: src/read.c seffect_identify(): the scroll is used up first, so it never identifies itself. */
function seffectIdentify(ctx: Ctx, scroll: Entity, wasKnown: boolean): void {
  const def = ctx.defs.object(scroll.def);
  const buc = scroll.c.item?.buc ?? 'uncursed';
  useup(ctx, scroll.id);
  if (buc === 'cursed' && !wasKnown) msg(ctx, 'identify.identify_this_as');
  else if (!wasKnown) msg(ctx, 'identify.this_is');
  if (!wasKnown) discover(ctx, def); // learnscrolltyp()
  if (buc === 'cursed' && !wasKnown) return;
  if (inventoryOf(ctx.state, ctx.state.playerId).length === 0) {
    msg(ctx, 'identify.nothing_else');
    return;
  }
  let cval = 1;
  if (buc === 'blessed' || (buc === 'uncursed' && ctx.rng.rn2(5) === 0)) {
    cval = ctx.rng.rn2(5); // 0 identifies everything; Luck is 0
  }
  identifyPack(ctx, cval, !wasKnown);
}

// ---------------------------------------------------------------------------------------------
// enchant weapon

/**
 * ref: src/wield.c chwepon(). Returns false when the scroll was used up by a strange feeling.
 * Not ported: worm tooth/crysknife, artifacts, blindness.
 */
function chwepon(ctx: Ctx, scroll: Entity, amount: number): boolean {
  const uwep = inventoryOf(ctx.state, ctx.state.playerId).find(
    (o) => o.c.item?.equipped === 'weapon',
  );
  const it = uwep?.c.item;
  const def = uwep ? ctx.defs.object(uwep.def) : null;
  if (!uwep || !it || def?.class !== 'weapon') {
    strangeFeeling(ctx, scroll.id, amount >= 0 ? 'enchant.hands_twitch' : 'enchant.hands_itch');
    return false;
  }
  const sdef = ctx.defs.object(scroll.def);
  const clr = color(amount < 0 ? 'black' : 'blue');
  const pl = isPlural(def, uwep) ? '_pl' : '';
  const item = xnameOf(ctx.state, ctx.defs, uwep);
  // there is a (soft) upper and lower limit to uwep->spe
  if (((it.spe > 5 && amount >= 0) || (it.spe < -5 && amount < 0)) && ctx.rng.rn2(3) !== 0) {
    msg(ctx, `enchant.weapon.evaporate${pl}`, { item, color: clr });
    useupall(ctx, uwep.id); // let all of them disappear
    return true;
  }
  msg(ctx, `enchant.weapon.glow${pl}`, {
    item,
    violently: amount === 0 ? { key: 'enchant.violently' } : '',
    color: clr,
    time: { key: amount * amount === 1 ? 'enchant.moment' : 'enchant.while' },
  });
  const sit = scroll.c.item;
  if (it.known.spe && (amount > 0 || (amount < 0 && sit?.known.buc))) discover(ctx, sdef);
  it.spe += amount;
  if (amount > 0 && it.buc === 'cursed') it.buc = 'uncursed';
  // an elven magic clue: weapons vibrate warningly when enchanted beyond a limit
  if (it.spe > 5 && ctx.rng.rn2(7) === 0) msg(ctx, `enchant.vibrate${pl}`, { item });
  return true;
}

/** ref: src/read.c seffect_enchant_weapon(). Not ported: the confused (erodeproofing) case. */
function seffectEnchantWeapon(ctx: Ctx, scroll: Entity): boolean {
  const buc = scroll.c.item?.buc ?? 'uncursed';
  const uwep = inventoryOf(ctx.state, ctx.state.playerId).find(
    (o) => o.c.item?.equipped === 'weapon',
  );
  const spe = uwep?.c.item?.spe ?? 0;
  const s =
    buc === 'cursed'
      ? -1
      : !uwep
        ? 1
        : spe >= 9
          ? ctx.rng.rn2(spe) === 0
            ? 1
            : 0
          : buc === 'blessed'
            ? ctx.rng.rnd(3 - Math.trunc(spe / 3))
            : 1;
  const ok = chwepon(ctx, scroll, s);
  const it = uwep?.c.item;
  if (it && ctx.state.entities[String(uwep?.id)]) it.spe = Math.max(-99, Math.min(99, it.spe)); // cap_spe()
  return !ok;
}

// ---------------------------------------------------------------------------------------------
// enchant armor

/** ref: src/do_wear.c some_armor(): the outer layer, or sometimes a helmet, gloves, boots, shield */
function someArmor(ctx: Ctx): Entity | null {
  let h = wornIn(ctx, 'cloak') ?? wornIn(ctx, 'body') ?? wornIn(ctx, 'shirt') ?? null;
  for (const slot of ['helm', 'gloves', 'boots', 'shield']) {
    const o = wornIn(ctx, slot);
    if (o && (!h || ctx.rng.rn2(4) === 0)) h = o;
  }
  return h;
}

/**
 * ref: src/read.c seffect_enchant_armor(). Returns true when the scroll was already used up.
 * Not ported: the confused case, dragon scales, artifacts, Dex/Int armor bonuses (adj_abon).
 */
function seffectEnchantArmor(ctx: Ctx, scroll: Entity, wasKnown: boolean): boolean {
  const sbuc = scroll.c.item?.buc ?? 'uncursed';
  const sdef = ctx.defs.object(scroll.def);
  const sblessed = sbuc === 'blessed';
  const scursed = sbuc === 'cursed';
  const otmp = someArmor(ctx);
  if (!otmp?.c.item) {
    strangeFeeling(ctx, scroll.id, 'enchant.skin');
    return true;
  }
  const it = otmp.c.item;
  const def = ctx.defs.object(otmp.def);
  const item = xnameOf(ctx.state, ctx.defs, otmp);
  const pl = isPlural(def, otmp) ? '_pl' : '';
  const specialArmor = otmp.def.includes('elven'); // ref: is_elven_armor()
  const clr = color(scursed ? 'black' : 'silver');
  // KMH -- catch underflow
  let s = scursed ? -it.spe : it.spe;
  if (s > (specialArmor ? 5 : 3) && ctx.rng.rn2(s) !== 0) {
    msg(ctx, `enchant.armor.evaporate${pl}`, { item, color: clr });
    useup(ctx, otmp.id);
    return false;
  }
  if (s < -100) s = -100;
  // Base power: 2 for -1 to +0 armor, 1 for +1 to +2, 0 for +3 to +4, ...
  s = Math.trunc((4 - s) / 2);
  if (specialArmor) ++s;
  if (!def.magic) ++s;
  if (sblessed) ++s;
  if (s <= 0) {
    s = 0;
    if (it.spe > 0 && ctx.rng.rn2(it.spe) === 0) s = 1;
  } else s = ctx.rng.rnd(s);
  if (s > 11) s = 11;
  if (scursed) s = -s;
  msg(ctx, `enchant.armor.glow${pl}`, {
    item,
    violently: s === 0 ? { key: 'enchant.violently' } : '',
    color: clr,
    time: { key: s * s > 1 ? 'enchant.while' : 'enchant.moment' },
  });
  let buc: Buc = it.buc;
  if (scursed && buc !== 'cursed') buc = 'cursed';
  else if (sblessed && buc !== 'blessed') buc = 'blessed';
  else if (!scursed && buc === 'cursed') buc = 'uncursed';
  it.buc = buc;
  let known = false;
  if (s) {
    it.spe = Math.max(-99, Math.min(99, it.spe + s));
    known = it.known.spe; // gk.known = otmp->known
  }
  if (known && !wasKnown) discover(ctx, sdef);
  if (it.spe > (specialArmor ? 5 : 3) && (specialArmor || ctx.rng.rn2(7) === 0)) {
    msg(ctx, `enchant.vibrate${pl}`, { item });
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// remove curse

/**
 * ref: src/read.c seffect_remove_curse(). Not ported: the confused case, loadstones, leashes,
 * punishment, the steed's saddle. Returns whether the scroll type becomes known.
 */
function seffectRemoveCurse(ctx: Ctx, scroll: Entity): boolean {
  const buc = scroll.c.item?.buc ?? 'uncursed';
  msg(ctx, 'remove_curse.helping');
  if (buc === 'cursed') {
    msg(ctx, 'remove_curse.disintegrates');
    return false;
  }
  let learned = false;
  for (const obj of inventoryOf(ctx.state, ctx.state.playerId)) {
    const it = obj.c.item;
    if (!it || ctx.defs.object(obj.def).class === 'coin') continue; // gold isn't subject to cursing
    // hide the scroll being read from itself
    if (obj.id === scroll.id && it.quantity === 1) continue;
    if (buc === 'blessed' || it.equipped !== null) {
      if (it.buc === 'cursed') {
        it.buc = 'uncursed';
        // if the object was known to be cursed and is now known not to be, learn the scroll
        if (it.known.buc) learned = true;
      }
    }
  }
  return learned;
}

// ---------------------------------------------------------------------------------------------
// light

/**
 * ref: src/vision.c circle_data[] rows for do_clear_area() radius 5 and 9: the largest |dx| at
 * each |dy|.
 */
const CIRCLE: Readonly<Record<number, readonly number[]>> = {
  5: [5, 5, 5, 4, 3, 2],
  9: [9, 9, 9, 9, 8, 8, 7, 6, 5, 3],
};

/**
 * ref: src/read.c litroom(): lights (or darkens) the cells around the hero that she could see
 * from where she stands, within a circle of radius 5 (9 for a blessed scroll). That includes
 * walls and doorways but nothing behind them, so in a room it is the room and its walls (within
 * range), in a corridor a stretch of it. Not ported: lamps, gremlins, the Rogue level, being
 * swallowed or underwater, light-sensitive monsters (lightdamage).
 */
function litroom(ctx: Ctx, on: boolean, blessed: boolean): void {
  msg(ctx, on ? 'light.lit_field' : 'light.darkness');
  const hero = heroEntity(ctx);
  const pos = hero.c.pos;
  const level: Level | undefined = pos ? ctx.state.levels[pos.level] : undefined;
  if (!pos || !level) return;
  const rules = cellRules(level, ctx.defs);
  // line of sight regardless of the current lighting
  const dark: Level = { ...level, lit: level.lit.map(() => 1) };
  const circle = CIRCLE[blessed ? 9 : 5] ?? [];
  for (const i of computeVisible(dark, rules, pos)) {
    const x = i % level.width;
    const y = (i - x) / level.width;
    const lim = circle[Math.abs(y - pos.y)];
    if (lim === undefined || Math.abs(x - pos.x) > lim) continue;
    level.lit[i] = on ? 1 : 0;
  }
}

// ---------------------------------------------------------------------------------------------
// reading

const heroScroll = (ctx: Ctx, id: unknown): Entity | null => {
  if (typeof id !== 'number') return null;
  const e = ctx.state.entities[String(id)];
  return e?.c.item?.carriedBy === ctx.state.playerId ? e : null;
};

/**
 * Reads a scroll: the message, the effect, discovery and using it up. ref: src/read.c doread()
 * (the part after the checks), seffects(), learnscroll(). Not ported: confusion, blindness, the
 * score for learning a type, `trycall` (naming unidentified types). An identify scroll may leave
 * a prompt pending (`ctx.state.pendingPrompt`), answered through the `nh:read` action.
 */
function readScroll(ctx: Ctx, _user: EntityId, itemId: EntityId): void {
  const scroll = ctx.state.entities[String(itemId)];
  const it = scroll?.c.item;
  if (!scroll || !it) return;
  const def = ctx.defs.object(scroll.def);
  const wasKnown = isKnown(ctx.state, ctx.defs, def);
  const nodisappear = def.id === 'nh:scroll_of_remove_curse' && it.buc === 'cursed';
  msg(ctx, nodisappear ? 'read.you_read' : 'read.disappears');

  let known = false; // gk.known
  let used = false; // the scroll has already been used up
  switch (def.id) {
    case 'nh:scroll_of_identify':
      seffectIdentify(ctx, scroll, wasKnown);
      used = true;
      break;
    case 'nh:scroll_of_enchant_weapon':
      used = seffectEnchantWeapon(ctx, scroll);
      break;
    case 'nh:scroll_of_enchant_armor':
      used = seffectEnchantArmor(ctx, scroll, wasKnown);
      break;
    case 'nh:scroll_of_remove_curse':
      known = seffectRemoveCurse(ctx, scroll);
      break;
    case 'nh:scroll_of_light':
      litroom(ctx, it.buc !== 'cursed', it.buc === 'blessed');
      known = true; // the hero is never blind
      break;
    default:
      break;
  }
  if (used) return;
  if (!wasKnown && known) discover(ctx, def); // learnscroll()
  useup(ctx, itemId);
}

/** `use` for every scroll in the subset (attached to the defs in index.ts). */
export const SCROLL_USES: Readonly<
  Record<string, (ctx: Ctx, user: EntityId, item: EntityId) => void>
> = {
  'nh:scroll_of_identify': readScroll,
  'nh:scroll_of_enchant_weapon': readScroll,
  'nh:scroll_of_enchant_armor': readScroll,
  'nh:scroll_of_remove_curse': readScroll,
  'nh:scroll_of_light': readScroll,
};

function itemArg(action: PlayerAction): unknown {
  return action.type === 'mod' ? (action.args as { item?: unknown } | undefined)?.item : undefined;
}

const read: ActionDef = {
  id: READ_ID,
  labelKey: 'action.nh:read',
  handles: 'mod',
  offer(ctx, target): Offer[] {
    if (target.kind !== 'item') return [];
    const e = heroScroll(ctx, target.id);
    if (!e || ctx.defs.object(e.def).class !== 'scroll') return [];
    return [
      {
        action: { type: 'mod', action: READ_ID, args: { item: e.id } },
        labelKey: 'action.nh:read',
      },
    ];
  },
  // ref: src/read.c doread()
  perform(ctx, action) {
    const e = heroScroll(ctx, itemArg(action));
    if (!e) return 0;
    if (checkCapacity(ctx)) return 0;
    const def = ctx.defs.object(e.def);
    if (def.class !== 'scroll' || !def.use) {
      msg(ctx, 'magic.silly_thing', { verb: { key: 'verb.read' } });
      return 0;
    }
    def.use(ctx, ctx.state.playerId, e.id);
    // an identify menu is waiting: the move is spent when it is answered
    return ctx.state.pendingPrompt ? 0 : NORMAL_SPEED;
  },
  answer(ctx, value, raw) {
    const data = raw as unknown as IdentifyData;
    if (data.stage !== 'identify') return 0;
    return identifyAnswer(ctx, value, data) ? 0 : NORMAL_SPEED;
  },
};

export const READ_ACTIONS: readonly ActionDef[] = [read];
