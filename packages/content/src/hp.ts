// Hit point loss that can kill the hero. ref: src/hack.c losehp(), src/attrib.c losestr()
import { getPlayer, type Ctx } from '@nh/core';

/** Loses hit points, dying if they run out. ref: src/hack.c losehp() */
export function losehp(ctx: Ctx, n: number, killer: string): void {
  const h = getPlayer(ctx.state);
  const hp = h.c.hp;
  if (!hp) return;
  hp.cur -= n;
  if (hp.cur > hp.max) hp.max = hp.cur;
  ctx.interrupt(); // end_running()
  if (hp.cur < 1) die(ctx, killer);
}

export function die(ctx: Ctx, killer: string): void {
  const h = getPlayer(ctx.state);
  ctx.emit({ type: 'msg', key: 'combat.you_die' });
  ctx.endGame({
    kind: 'died',
    killer,
    turn: ctx.state.turn,
    depth: ctx.state.levels[ctx.state.currentLevel]?.depth ?? 1,
    level: h.c.experience?.level ?? 1,
  });
}

/** ref: src/attrib.c losestr(): strength points, then HP once it would drop below 3 */
export function losestr(ctx: Ctx, num: number, killer: string): void {
  const h = getPlayer(ctx.state);
  const a = h.c.attributes;
  if (!a) return;
  let ustr = a.str - num;
  let dmg = 0;
  while (ustr < 3) {
    ustr++;
    num--;
    dmg += 3 + ctx.rng.rn2(4); // rn1(4, 3)
  }
  if (dmg) {
    losehp(ctx, dmg, killer);
    const hp = h.c.hp;
    if (hp && hp.max > 1) hp.max = Math.max(hp.max - dmg, 1);
  }
  if (num > 0) a.str = Math.max(3, a.str - num);
}
