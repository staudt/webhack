// What happens to the world when a monster dies by the hero's hand.
// ref: src/mon.c xkilled(), mondead(), m_detach()
import { getPlayer, type Ctx, type EntityId } from '@nh/core';
import { xkilledCorpse } from './corpses';
import { placeOnFloor, weight } from './items';
import { mkobj } from './mkobj';
import { forgetMonster, relobj } from './mongear';

/**
 * The monster dies and is removed. Its possessions fall where it stood (mondead() ->
 * m_detach() -> relobj(), before anything else is made), then, for a kill by the hero, the
 * 1 in 6 "treasure drop" and the corpse are made on top of them.
 * ref: src/mon.c xkilled(): `!rn2(6) && !(G_NOCORPSE) && not on the hero && not a Kop` makes
 * mkobj(RANDOM_CLASS, TRUE). Food is deleted unless the monster collects things (M2_COLLECT);
 * small monsters (smaller than MZ_HUMAN) do not leave heavy (owt > 30) or bulky (oc_big =
 * bimanual here) objects. Then corpse_chance() and make_corpse().
 */
export function monsterDied(ctx: Ctx, monId: EntityId, byHero: boolean): void {
  const e = ctx.state.entities[String(monId)];
  if (!e?.c.monster) return;
  const def = ctx.defs.monster(e.def);
  const at = e.c.pos ? { ...e.c.pos } : undefined;
  relobj(ctx, monId, at);
  forgetMonster(ctx, monId);
  ctx.remove(monId);
  if (!byHero || !at) return;

  const hero = getPlayer(ctx.state).c.pos;
  const onHero = hero?.level === at.level && hero.x === at.x && hero.y === at.y;
  if (
    ctx.rng.rn2(6) === 0 &&
    !def.genFlags.includes('nocorpse') &&
    !onHero &&
    def.glyph.ch !== 'K'
  ) {
    const id = mkobj(ctx, 'random', { level: at.level });
    const item = id === null ? undefined : ctx.state.entities[String(id)];
    if (id !== null && item) {
      const od = ctx.defs.object(item.def);
      const small = def.size === 'tiny' || def.size === 'small';
      if (od.class === 'food' && !def.flags.includes('collect')) ctx.remove(id);
      else if (small && (weight(ctx.defs, item) > 30 || od.weapon?.bimanual === true))
        ctx.remove(id);
      else placeOnFloor(ctx, id, at.level, at.x, at.y);
    }
  }
  xkilledCorpse(ctx, def, at);
}
