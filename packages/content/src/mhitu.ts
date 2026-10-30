// Special damage types of monster attacks on the hero.
// ref: src/mhitu.c hitmu(), mdamageu(), magic_negation(); src/uhitm.c mhitm_adtyping() and the
// mhitm_ad_*() handlers (the `mdef == &gy.youmonst` branches)
import { getPlayer, inventoryOf, type AttackDef, type Ctx, type Entity, type Msg } from '@nh/core';
import { stopOccupation } from './eat';
import { poisoned } from './attrib';
import { setUstuck, ustuck } from './hackmove';
import { nomulNow } from './hunger';
import { P, hasProp, makeStunned, timeoutLeft } from './props';

const say = (ctx: Ctx, key: string, params?: Msg['params']): void =>
  ctx.emit({ type: 'msg', key, ...(params ? { params } : {}) });

/**
 * A monster hit the hero for `n` points of damage: she dies at 0 HP.
 * ref: src/mhitu.c mdamageu() -> src/end.c done_in_by(). `killer` is the death reason (a
 * message key such as '@nh:newt').
 */
export function mdamageu(ctx: Ctx, n: number, killer: string): void {
  if (ctx.state.gameOver) return;
  const hero = getPlayer(ctx.state);
  const hp = hero.c.hp;
  if (!hp) return;
  hp.cur -= n;
  // caller might have reduced uhpmax before calling mdamageu()
  if (hp.cur > hp.max) hp.cur = hp.max;
  if (hp.cur < 1) {
    say(ctx, 'combat.you_die');
    ctx.endGame({
      kind: 'died',
      killer,
      turn: ctx.state.turn,
      depth: ctx.state.levels[ctx.state.currentLevel]?.depth ?? 1,
      level: hero.c.experience?.level ?? 1,
    });
  }
}

/**
 * The hero's magic cancellation: the best worn armor's MC. ref: src/mhitu.c magic_negation().
 * Not ported: extrinsic/intrinsic Protection, the amulet of guarding.
 */
export function magicNegation(ctx: Ctx): number {
  let mc = 0;
  for (const o of inventoryOf(ctx.state, ctx.state.playerId)) {
    const slot = o.c.item?.equipped;
    if (!slot || slot === 'weapon') continue;
    mc = Math.max(mc, ctx.defs.object(o.def).armor?.mc ?? 0);
  }
  return mc;
}

/**
 * Whether magical cancellation blocks the special effect of the attack. Always rolls rn2(10).
 * ref: src/uhitm.c mhitm_mgc_atk_negated() (monsters are never cancelled here: no `mcan`)
 */
export function mgcAtkNegated(ctx: Ctx, verbosely: boolean): boolean {
  const armpro = magicNegation(ctx);
  const negated = !(ctx.rng.rn2(10) >= 3 * armpro);
  if (negated && verbosely) say(ctx, 'mhitu.avoid_harm');
  return negated;
}

/** ref: src/mhitu.c mpoisons_subj(): how a poison attack was delivered (a message key) */
function poisonSubj(at: AttackDef['at']): string {
  switch (at) {
    case 'weapon':
      return '@poison.subj.attack';
    case 'touch':
      return '@poison.subj.contact';
    case 'gaze':
      return '@poison.subj.gaze';
    case 'bite':
      return '@poison.subj.bite';
    default:
      return '@poison.subj.sting';
  }
}

/** ref: src/mondata.c on_fire() for the monsters we have: hugs roast, the rest set you on fire */
const onFire = (at: AttackDef['at']): string => (at === 'hug' ? '@mhitu.roasted' : '@mhitu.fire');

/**
 * The effect of the attack's damage type on the hero; returns the damage left to apply. The
 * "hits!" message has already been given (every handler starts with hitmsg()). The hero may
 * die inside (instadeath poison): check `ctx.state.gameOver` afterwards.
 * ref: src/uhitm.c mhitm_adtyping() -> mhitm_ad_elec/fire/cold/slee/drst/acid/stun/plys/stck()
 * with `mdef == &gy.youmonst`.
 * Not ported: destroy_items() (burning scrolls, boiling potions, shattering potions, blowing up
 * wands) -- its trigger roll `m_lev > rn2(20)` is still made so the random stream matches --,
 * armor erosion, `mcan`, Free_action and Antimagic (the hero has neither).
 */
export function hitmuAd(ctx: Ctx, mon: Entity, atk: AttackDef, damage: number): number {
  const hero = getPlayer(ctx.state);
  const name = `@${mon.def}`;
  let dmg = damage;
  switch (atk.ad) {
    case 'elec': // mhitm_ad_elec
      if (!mgcAtkNegated(ctx, true)) {
        say(ctx, 'mhitu.zapped');
        if (hasProp(hero, P.SHOCK_RES)) {
          say(ctx, 'mhitu.zap_no_shock');
          dmg = 0;
        }
        ctx.rng.rn2(20); // `m_lev > rn2(20)` gates destroy_items(AD_ELEC): not ported
      } else dmg = 0;
      break;
    case 'fire': // mhitm_ad_fire
      if (!mgcAtkNegated(ctx, true)) {
        say(ctx, 'mhitu.on_fire', { how: onFire(atk.at) });
        if (hasProp(hero, P.FIRE_RES)) {
          say(ctx, 'mhitu.fire_not_hot');
          dmg = 0;
        }
        ctx.rng.rn2(20); // `m_lev > rn2(20)` gates destroy_items(AD_FIRE) / ignite_items(): not ported
      } else dmg = 0;
      break;
    case 'cold': // mhitm_ad_cold
      if (!mgcAtkNegated(ctx, true)) {
        say(ctx, 'mhitu.frost');
        if (hasProp(hero, P.COLD_RES)) {
          say(ctx, 'mhitu.frost_not_cold');
          dmg = 0;
        }
        ctx.rng.rn2(20); // `m_lev > rn2(20)` gates destroy_items(AD_COLD): not ported
      } else dmg = 0;
      break;
    case 'acid': // mhitm_ad_acid: one hit in three splashes you
      if (ctx.rng.rn2(3) === 0) {
        if (hasProp(hero, P.ACID_RES)) {
          say(ctx, 'mhitu.acid_harmless');
          dmg = 0;
        } else say(ctx, 'mhitu.acid_burns');
      } else dmg = 0;
      break;
    case 'slee': // mhitm_ad_slee
      if (!hero.c.helpless && ctx.rng.rn2(5) === 0 && !mgcAtkNegated(ctx, true)) {
        if (hasProp(hero, P.SLEEP_RES)) break;
        // ref: src/timeout.c fall_asleep(-rnd(10), TRUE)
        stopOccupation(ctx);
        nomulNow(ctx, ctx.rng.rnd(10), 'helpless.asleep', { key: 'eat.wake_up' });
        say(ctx, 'mhitu.put_to_sleep', { mon: name });
      }
      break;
    case 'drst': // mhitm_ad_drst (poison; AD_DRDX and AD_DRCO share it)
    case 'drco':
    case 'drdx': {
      const typ = atk.ad === 'drco' ? 'con' : atk.ad === 'drdx' ? 'dex' : 'str';
      const negated = mgcAtkNegated(ctx, false);
      if (!negated && ctx.rng.rn2(8) === 0) {
        poisoned(
          ctx,
          { key: 'mhitu.was_poisoned', params: { mon: name, subj: poisonSubj(atk.at) } },
          typ,
          name,
          30,
        );
      }
      break;
    }
    case 'stun': // mhitm_ad_stun
      if (ctx.rng.rn2(4) === 0) {
        makeStunned(ctx, timeoutLeft(ctx.state, hero, P.STUNNED) + dmg, true);
        dmg = Math.trunc(dmg / 2);
      }
      break;
    case 'plys': // mhitm_ad_plys
      if (!hero.c.helpless && ctx.rng.rn2(3) === 0 && !mgcAtkNegated(ctx, true)) {
        // no Free_action
        say(ctx, 'mhitu.frozen_by', { mon: name });
        nomulNow(ctx, ctx.rng.rnd(10), 'helpless.paralyzed', { key: 'eat.can_move_again' });
      }
      break;
    case 'stck': {
      // mhitm_ad_stck
      const negated = mgcAtkNegated(ctx, false);
      if (!negated && ustuck(ctx) === null) setUstuck(ctx, mon.id); // set_ustuck(magr)
      break;
    }
    default:
      break; // AD_PHYS and the types not in the roster
  }
  return dmg;
}
