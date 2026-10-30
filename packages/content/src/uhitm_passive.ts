// Passive attacks: what a monster does to the hero when she hits or misses it in melee.
// ref: src/uhitm.c passive() (called from hitum() after every melee attack)
import { getPlayer, type Ctx, type EntityId, type MonsterDef, type Pos } from '@nh/core';
import { mdamageu } from './mhitu';
import { heroSees } from './mongear';
import { nomulNow } from './hunger';
import { P, hasProp, makeStunned } from './props';

/** The attacked monster as it was before the blow (it may be dead and removed afterwards). */
export interface PassiveTarget {
  id: EntityId;
  def: MonsterDef;
  /** m_lev */
  level: number;
  pos: Pos & { level: string };
}

const say = (ctx: Ctx, key: string, params?: Record<string, string | number>): void =>
  ctx.emit({ type: 'msg', key, ...(params ? { params } : {}) });

/**
 * The monster's AT_NONE attack answers the hero's blow. `mhit` says whether she hit it and
 * `malive` whether it survived.
 * ref: src/uhitm.c passive(). Effects that need the weapon (passive_obj(): corroding, burning or
 * disenchanting it), armor erosion, golems and `mcan` are not ported; the stoning, rust, corrosion,
 * magic missile and disenchantment cases belong to monsters we do not have. Not ported: brown
 * mold splitting (split_mon). The floating eye's gaze is never reflected (no reflection) nor
 * resisted (no Free_action, no hallucination, no blindness) and the monster is never blind.
 */
export function passive(ctx: Ctx, mon: PassiveTarget, mhit: boolean, malive: boolean): void {
  const atk = mon.def.attacks.find((a) => a.at === 'passive');
  if (!atk) return; // no passive attacks
  const hero = getPlayer(ctx.state);
  const killer = `@${mon.def.id}`;
  let tmp: number;
  if (atk.n) tmp = ctx.rng.d(atk.n, atk.d);
  else if (atk.d) tmp = ctx.rng.d(mon.level + 1, atk.d);
  else tmp = 0;

  // These affect you even if they just died.
  if (atk.ad === 'acid') {
    if (mhit && ctx.rng.rn2(2) !== 0) {
      say(ctx, 'passive.splashed', { mon: `@${mon.def.id}` });
      if (!hasProp(hero, P.ACID_RES)) mdamageu(ctx, tmp, killer);
      ctx.rng.rn2(30); // `!rn2(30)` erode_armor(): not ported
    }
    // `if (mhitb && weapon) passive_obj()`: corroding the weapon is not ported
    if (ctx.state.gameOver) return;
  }
  // AD_FIRE: `mhitb && weapon` -> passive_obj() burns the weapon: not ported

  // These only affect you if they still live.
  if (!malive || ctx.rng.rn2(3) === 0) return;
  switch (atk.ad) {
    case 'plys':
      if (mon.def.id === 'nh:floating_eye') {
        if (!heroSees(ctx, mon.pos)) break; // !canseemon(mon)
        say(ctx, 'passive.frozen_gaze', { mon: `@${mon.def.id}` });
        // Wis > 12 || rn2(4): otherwise it paralyzes for 127 turns
        const turns = (hero.c.attributes?.wis ?? 10) > 12 || ctx.rng.rn2(4) !== 0 ? tmp : 127;
        nomulNow(ctx, turns, 'helpless.frozen_gaze', { key: 'eat.can_move_again' });
      } else {
        // gelatinous cube
        say(ctx, 'passive.frozen', { mon: `@${mon.def.id}` });
        nomulNow(ctx, tmp, 'helpless.frozen', { key: 'eat.can_move_again' });
      }
      break;
    case 'cold': // brown mold or blue jelly
      if (hasProp(hero, P.COLD_RES)) {
        say(ctx, 'passive.mild_chill');
        break;
      }
      say(ctx, 'passive.very_cold');
      mdamageu(ctx, tmp, killer);
      {
        // monster gets stronger with your heat! ref: src/mon.c healmon(mon, amt, overheal)
        const amt = Math.trunc((tmp + ctx.rng.rn2(2)) / 2);
        const overheal = Math.trunc((tmp + 1) / 2);
        const hp = ctx.state.entities[String(mon.id)]?.c.hp;
        if (hp) {
          if (hp.cur + amt > hp.max + overheal) {
            hp.max += overheal;
            hp.cur = hp.max;
          } else {
            hp.cur += amt;
            if (hp.cur > hp.max) hp.max = hp.cur;
          }
        }
        // at a certain point, the monster will reproduce (split_mon): not ported
      }
      break;
    case 'stun': // specifically yellow mold
      if (!hasProp(hero, P.STUNNED)) makeStunned(ctx, tmp, true);
      break;
    case 'fire':
      if (hasProp(hero, P.FIRE_RES)) {
        say(ctx, 'passive.mildly_warm');
        break;
      }
      say(ctx, 'passive.very_hot');
      mdamageu(ctx, tmp, killer);
      break;
    case 'elec':
      if (hasProp(hero, P.SHOCK_RES)) {
        say(ctx, 'passive.mild_tingle');
        break;
      }
      say(ctx, 'passive.jolted');
      mdamageu(ctx, tmp, killer);
      break;
    default:
      break;
  }
}
