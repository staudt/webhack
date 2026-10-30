// Attribute changes and poison. ref: src/attrib.c adjattrib(), poisoned(), poisontell(), gainstr()
import { getPlayer, type AttributesComponent, type Ctx, type Msg } from '@nh/core';
import { losehp } from './hp';
import { P, hasProp } from './props';

type Attr = keyof AttributesComponent;

/** ref: include/attrib.h STR18 */
const STR18 = (x: number): number => 18 + x;
/** ref: src/role.c races[] human attrmin / attrmax */
const ATTRMIN = 3;
const ATTRMAX: Record<Attr, number> = {
  str: STR18(100),
  int: 18,
  wis: 18,
  dex: 18,
  con: 18,
  cha: 18,
};

/**
 * Raises or lowers an attribute. Returns whether it changed. `msg` shows "You feel weak!" etc.
 * ref: src/attrib.c adjattrib(). Not ported: the peak value (AMAX) that a drop below the
 * minimum lowers, abuse and exercise, Fixed_abil and the dunce cap.
 */
export function adjattrib(ctx: Ctx, which: Attr, incr: number, msg: boolean): boolean {
  const a = getPlayer(ctx.state).c.attributes;
  if (!a || !incr) return false;
  const old = a[which];
  a[which] = Math.max(ATTRMIN, Math.min(ATTRMAX[which], old + incr));
  if (a[which] === old) return false;
  if (msg) {
    ctx.emit({
      type: 'msg',
      key: `attr.${incr > 0 ? 'plus' : 'minus'}.${which}`,
      params: { very: incr > 1 || incr < -1 ? 'very ' : '' },
    });
  }
  return true;
}

/** "You feel weaker!" after a poisoning. ref: src/attrib.c poisontell() */
function poisontell(ctx: Ctx, typ: Attr): void {
  ctx.emit({ type: 'msg', key: `poison.tell.${typ}` });
}

/**
 * Poison hits the hero. `reason` is the "was poisoned!" announcement (null when the caller has
 * given it); `killer` is the death reason key; `fatal` is the 1-in-N instadeath (0 = never, only
 * minor attribute loss).
 * ref: src/attrib.c poisoned(). Not ported: Half_gas_damage (blast, cloud), the "innately weaker"
 * wording for gauntlets of power.
 */
export function poisoned(
  ctx: Ctx,
  reason: Msg | null,
  typ: Attr,
  killer: string,
  fatal: number,
  thrown = false,
): void {
  if (reason)
    ctx.emit({ type: 'msg', key: reason.key, ...(reason.params ? { params: reason.params } : {}) });
  const hero = getPlayer(ctx.state);
  if (hasProp(hero, P.POISON_RES)) {
    ctx.emit({ type: 'msg', key: 'poison.no_effect' });
    return;
  }
  const hp = hero.c.hp;
  if (!hp) return;

  const i = !fatal ? 1 : ctx.rng.rn2(fatal + (thrown ? 20 : 0));
  if (i === 0 && typ !== 'cha') {
    // sometimes survivable instant kill
    let loss = 6 + ctx.rng.d(4, 6); // 10..34
    if (hp.cur <= loss) {
      hp.cur = -1;
      ctx.emit({ type: 'msg', key: 'poison.deadly' });
      losehp(ctx, 0, killer); // dies
    } else {
      // survived, but with severe reaction: maximum HP drops too
      const olduhp = hp.cur;
      const newmax = hp.max - Math.trunc(loss / 2);
      hp.max = Math.max(newmax, Math.max(hero.c.experience?.level ?? 1, 3)); // minuhpmax(3)
      if (hp.cur > hp.max) hp.cur = hp.max;
      if (hp.cur < olduhp) loss -= olduhp - hp.cur; // adjuhploss()
      loss = Math.max(loss, 1);
      losehp(ctx, loss, killer);
      if (ctx.state.gameOver) return;
      if (adjattrib(ctx, 'con', typ !== 'con' ? -1 : -3, false)) poisontell(ctx, 'con');
      if (typ !== 'con' && adjattrib(ctx, typ, -3, false)) poisontell(ctx, typ);
    }
  } else if (i > 5) {
    // HP damage; more likely--but less severe--with missiles
    const loss = thrown ? ctx.rng.rnd(6) : 6 + ctx.rng.rn2(10); // rn1(10, 6)
    losehp(ctx, loss, killer);
  } else {
    // attribute loss (a check that a stat change was made)
    const loss = thrown || !fatal ? 1 : ctx.rng.d(2, 2);
    if (adjattrib(ctx, typ, -loss, false)) poisontell(ctx, typ);
  }
}

/** ref: src/attrib.c gainstr() with a computed amount (the Str of a giant's corpse). */
export function gainstr(ctx: Ctx, incr = 0): void {
  const a = getPlayer(ctx.state).c.attributes;
  if (!a) return;
  let num = incr;
  if (!num) {
    if (a.str < 18) num = ctx.rng.rn2(4) ? 1 : ctx.rng.rnd(6);
    else if (a.str < STR18(85)) num = ctx.rng.rnd(10);
    else num = 1;
  }
  adjattrib(ctx, 'str', num, true);
}
