// Hero properties (intrinsics and timed effects) and the innate abilities of the role.
// ref: include/prop.h, include/youprop.h, src/timeout.c nh_timeout(), src/potion.c make_stunned(),
// src/attrib.c adjabil() / val_abil[]
//
// A property lives in `Components.props[name]`: `intrinsic` is the permanent flag (NetHack's
// FROMOUTSIDE / FROMEXPER bits) and `timeout` the turn a timed effect ends (0 = none). Names are
// NetHack's property names lowercased: 'cold_res', 'stunned', 'fast', 'stealth', ...
import {
  getPlayer,
  type Ctx,
  type Entity,
  type EntityId,
  type GameState,
  type ModApi,
  type PropState,
} from '@nh/core';

/** Property names used by the vanilla mod (ref: include/prop.h enum prop_types). */
export const P = {
  FIRE_RES: 'fire_res',
  COLD_RES: 'cold_res',
  SLEEP_RES: 'sleep_res',
  DISINT_RES: 'disint_res',
  SHOCK_RES: 'shock_res',
  POISON_RES: 'poison_res',
  ACID_RES: 'acid_res',
  STONE_RES: 'stone_res',
  STUNNED: 'stunned',
  FAST: 'fast',
  STEALTH: 'stealth',
  TELEPAT: 'telepat',
} as const;

/** True while the entity has the property, permanently or on a timer. ref: youprop.h (e.g. Stunned) */
export function hasProp(e: Entity | undefined, name: string): boolean {
  const p = e?.c.props?.[name];
  return p !== undefined && (p.intrinsic || p.timeout > 0);
}

/** The hero has the property. */
export const heroHas = (state: Readonly<GameState>, name: string): boolean =>
  hasProp(state.entities[String(state.playerId)], name);

/** True when the property is held permanently (HFoo & INTRINSIC). */
export const hasIntrinsic = (e: Entity | undefined, name: string): boolean =>
  e?.c.props?.[name]?.intrinsic === true;

/** Turns of a timed effect left (HFoo & TIMEOUT); 0 when none. */
export function timeoutLeft(
  state: Readonly<GameState>,
  e: Entity | undefined,
  name: string,
): number {
  const t = e?.c.props?.[name]?.timeout ?? 0;
  return t > 0 ? Math.max(t - state.turn, 0) : 0;
}

const propState = (e: Entity, name: string): PropState => {
  const props = (e.c.props ??= {});
  return (props[name] ??= { intrinsic: false, timeout: 0 });
};

/** Drops an entry that holds nothing, so a saved state stays small. */
function prune(e: Entity, name: string): void {
  const p = e.c.props?.[name];
  if (p && !p.intrinsic && p.timeout <= 0 && e.c.props) delete e.c.props[name];
}

/** Gives or takes the permanent flag. ref: HFoo |= FROMOUTSIDE / &= ~FROMOUTSIDE */
export function setIntrinsic(e: Entity, name: string, on: boolean): void {
  if (on) propState(e, name).intrinsic = true;
  else if (e.c.props?.[name]) {
    propState(e, name).intrinsic = false;
    prune(e, name);
  }
}

/** Sets the timed part to end `turns` turns from now (0 clears it). ref: src/timeout.c set_itimeout() */
export function setItimeout(
  state: Readonly<GameState>,
  e: Entity,
  name: string,
  turns: number,
): void {
  if (turns > 0) propState(e, name).timeout = state.turn + turns;
  else if (e.c.props?.[name]) {
    propState(e, name).timeout = 0;
    prune(e, name);
  }
}

/** Lengthens the timed part by `incr` turns. ref: src/timeout.c incr_itimeout() */
export function incrItimeout(
  state: Readonly<GameState>,
  e: Entity,
  name: string,
  incr: number,
): void {
  setItimeout(state, e, name, timeoutLeft(state, e, name) + incr);
}

/**
 * Sets the hero's stun timer to `xtime` more turns (0 ends it), with NetHack's messages.
 * ref: src/potion.c make_stunned(). Not ported: riding ("You wobble in the saddle"),
 * hallucination wording, the Unaware (unconscious) silence.
 */
export function makeStunned(ctx: Pick<Ctx, 'state' | 'emit'>, xtime: number, talk: boolean): void {
  const hero = getPlayer(ctx.state);
  const old = hasProp(hero, P.STUNNED);
  if (!xtime && old && talk) ctx.emit({ type: 'msg', key: 'stun.steady' });
  if (xtime && !old && talk) ctx.emit({ type: 'msg', key: 'stun.stagger' });
  setItimeout(ctx.state, hero, P.STUNNED, xtime);
}

/** ref: src/timeout.c nh_timeout(): what happens when a timed property runs out. */
function timeoutExpired(ctx: Ctx, hero: Entity, name: string): void {
  switch (name) {
    case P.STUNNED:
      // (the timer is already cleared, so make_stunned(0, TRUE)'s message is given directly)
      ctx.emit({ type: 'msg', key: 'stun.steady' });
      ctx.interrupt(); // stop_occupation()
      break;
    case P.FAST:
      // "a bit" when an intrinsic remains; Very_fast is only the timed part, so it is over now
      ctx.emit({
        type: 'msg',
        key: hasProp(hero, P.FAST) ? 'timeout.slow_down_bit' : 'timeout.slow_down',
      });
      break;
    case P.ACID_RES:
      if (!hasProp(hero, P.ACID_RES)) ctx.emit({ type: 'msg', key: 'timeout.acid_unsafe' });
      break;
    case P.STONE_RES:
      if (!hasProp(hero, P.STONE_RES)) ctx.emit({ type: 'msg', key: 'timeout.stone_unsafe' });
      break;
    default:
      break;
  }
}

/**
 * Role abilities gained with experience. ref: src/attrib.c val_abil[]: Valkyrie
 * `{1, HCold_resistance}`, `{3, HStealth, "stealthy"}`, `{7, HFast, "quick"}`.
 */
export const VALKYRIE_ABILITIES: readonly { level: number; prop: string; gain: string | null }[] = [
  { level: 1, prop: P.COLD_RES, gain: null },
  { level: 3, prop: P.STEALTH, gain: 'abil.stealthy' },
  { level: 7, prop: P.FAST, gain: 'abil.quick' },
];

/**
 * Grants the abilities whose level was just reached. ref: src/attrib.c adjabil(). Level loss
 * does not exist yet, so the "lose" half is not ported; the weapon-skill slots are handled in
 * skills.ts. The "You feel ...!" message shows only when no other source already gave the
 * property (`!(*ability & INTRINSIC & ~mask)`).
 */
export function adjabil(ctx: Ctx, heroId: EntityId, oldLevel: number, newLevel: number): void {
  const hero = ctx.state.entities[String(heroId)];
  if (!hero) return;
  for (const a of VALKYRIE_ABILITIES) {
    if (!(oldLevel < a.level && newLevel >= a.level)) continue;
    const had = hasIntrinsic(hero, a.prop);
    setIntrinsic(hero, a.prop, true);
    if (!had && a.gain) ctx.emit({ type: 'msg', key: a.gain });
  }
}

/** Registers the props hooks and the Stun status. ref: src/timeout.c, src/botl.c */
export function registerProps(api: ModApi): void {
  // ref: src/u_init.c u_init(): adjabil(0, 1) gives the level 1 abilities
  api.on('newGame', (ctx, heroId) => adjabil(ctx, heroId, 0, 1));
  // ref: src/timeout.c nh_timeout(): every turn each timed property counts down; at 0 it ends
  api.on('endOfTurn', (ctx) => {
    const hero = getPlayer(ctx.state);
    const props = hero.c.props;
    if (!props) return;
    for (const name of Object.keys(props).sort()) {
      const p = props[name];
      if (!p || p.timeout <= 0 || ctx.state.turn < p.timeout) continue;
      p.timeout = 0;
      prune(hero, name);
      timeoutExpired(ctx, hero, name);
    }
  });
  api.defineStatus({
    id: 'nh:stunned',
    // The UI shows any positive status field that has a `ui.status.<field>` word ("Stun").
    field: 'stun',
    value: (state) => (heroHas(state, P.STUNNED) ? 1 : null),
  });
}
