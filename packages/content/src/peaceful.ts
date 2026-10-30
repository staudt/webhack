// Attacking peaceful monsters: the confirmation, waking monsters and making them angry.
// ref: src/uhitm.c attack_checks(), src/mon.c wakeup(), setmangry(), peacefuls_respond()
import { getPlayer, sortedIds, type Ctx, type DefId, type EntityId, type Json } from '@nh/core';
import { monflee } from './monflee';
import { heroSees } from './mongear';
import { P, hasProp } from './props';

const say = (ctx: Ctx, key: string, params?: Record<string, string | number>): void =>
  ctx.emit({ type: 'msg', key, ...(params ? { params } : {}) });

/**
 * Whether the hero must confirm before attacking monster `id` ("Really attack the dwarf?"): it is
 * peaceful, she can see it, and she is not stunned (confusion and hallucination do not exist).
 * ref: src/uhitm.c attack_checks() `flags.confirm && mtmp->mpeaceful && !Confusion &&
 * !Hallucination && !Stunned` and `canspotmon(mtmp)`. Not ported: Stormbringer, hidden and
 * invisible monsters, mimics.
 */
export function needsAttackConfirm(ctx: Ctx, id: EntityId): boolean {
  const mon = ctx.state.entities[String(id)];
  if (!mon?.c.monster?.peaceful || !mon.c.pos) return false;
  if (hasProp(getPlayer(ctx.state), P.STUNNED)) return false;
  return heroSees(ctx, mon.c.pos);
}

/**
 * Asks "Really attack the X?"; the answer goes to the action `handler` with `data`.
 * ref: src/uhitm.c attack_checks() paranoid_query(ParanoidHit, "Really attack %s?")
 */
export function askReallyAttack(ctx: Ctx, id: EntityId, handler: DefId, data: Json): void {
  const mon = ctx.state.entities[String(id)];
  ctx.ask(
    {
      id: 'attack-peaceful',
      kind: 'yn',
      key: 'attack.confirm',
      params: { mon: `@${mon?.def ?? ''}` },
    },
    handler,
    data,
  );
}

/** ref: include/mondata.h humanoid() */
const humanoid = (ctx: Ctx, id: EntityId): boolean => {
  const mon = ctx.state.entities[String(id)];
  return mon !== undefined && ctx.defs.monster(mon.def).flags.includes('humanoid');
};

/**
 * Other peaceful monsters that see the attack react: humanoids may turn to flee, and always turn
 * hostile. ref: src/mon.c peacefuls_respond(). Not ported: the gasp / exclaim lines (and their
 * random draw), watchmen, shopkeepers, priests, the quest, and the same-letter big-little match for
 * non-humanoids (growling and fleeing).
 */
function peacefulsRespond(ctx: Ctx, victim: EntityId): void {
  for (const id of sortedIds(ctx.state)) {
    const mon = ctx.state.entities[String(id)];
    const m = mon?.c.monster;
    if (!mon || !m || id === victim || !mon.c.pos) continue;
    const def = ctx.defs.monster(mon.def);
    // couldsee() && m_canseeu(): approximated by the hero seeing its square
    if (def.flags.includes('mindless') || !m.peaceful || m.asleep || !heroSees(ctx, mon.c.pos))
      continue;
    if (!humanoid(ctx, id)) continue;
    // the monster is scared when its level is below a d10 roll
    if (def.level < ctx.rng.rn2(10)) monflee(ctx, id, ctx.rng.rn2(50) + 25, true, true);
    m.peaceful = false;
    say(ctx, 'mon.gets_angry', { mon: `@${mon.def}` });
  }
}

/**
 * The monster turns hostile, with a message when the hero sees a humanoid do so; alignment
 * penalties are not tracked. ref: src/mon.c setmangry(mtmp, TRUE). Not ported: Elbereth
 * hypocrisy, priests, shopkeepers, guards, growling for non-humanoids.
 */
export function setmangry(ctx: Ctx, id: EntityId): void {
  const mon = ctx.state.entities[String(id)];
  const m = mon?.c.monster;
  if (!mon || !m || !m.peaceful) return;
  m.peaceful = false; // adjalign(-1) is not tracked
  if (humanoid(ctx, id) && mon.c.pos && heroSees(ctx, mon.c.pos))
    say(ctx, 'mon.gets_angry', { mon: `@${mon.def}` });
  peacefulsRespond(ctx, id);
}

/**
 * Wakes a monster that the hero attacked, which also angers it.
 * ref: src/mon.c wakeup(mtmp, TRUE): wake_msg(), `msleeping = 0`, setmangry()
 */
export function wakeup(ctx: Ctx, id: EntityId): void {
  const mon = ctx.state.entities[String(id)];
  const m = mon?.c.monster;
  if (!mon || !m) return;
  if (m.asleep && mon.c.pos && heroSees(ctx, mon.c.pos))
    say(ctx, 'mon.wakes_up', { mon: `@${mon.def}` });
  m.asleep = false;
  setmangry(ctx, id);
}
