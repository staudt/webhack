// Intrinsics from eating corpses. ref: src/eat.c cpostfx(), corpse_intrinsic(), should_givit(),
// temp_givit(), givit(), intrinsic_possible()
import { getPlayer, type Ctx, type MonsterDef } from '@nh/core';
import { gainstr } from './attrib';
import {
  P,
  hasIntrinsic,
  hasProp,
  incrItimeout,
  makeStunned,
  setIntrinsic,
  timeoutLeft,
} from './props';

/**
 * The conveyable properties in include/prop.h order (corpse_intrinsic() scans them in that
 * order). `mr` is the MR_ name in `MonsterDef.conveys`; telepathy has no MR bit
 * (ref: include/mondata.h telepathic()).
 */
const CONVEYED: readonly { prop: string; mr: string | null }[] = [
  { prop: P.FIRE_RES, mr: 'fire' },
  { prop: P.COLD_RES, mr: 'cold' },
  { prop: P.SLEEP_RES, mr: 'sleep' },
  { prop: P.DISINT_RES, mr: 'disint' },
  { prop: P.SHOCK_RES, mr: 'elec' },
  { prop: P.POISON_RES, mr: 'poison' },
  { prop: P.ACID_RES, mr: 'acid' },
  { prop: P.STONE_RES, mr: 'stone' },
  { prop: P.TELEPAT, mr: null },
];

/** ref: include/mondata.h telepathic(): the floating eye and the mind flayers */
const telepathic = (def: MonsterDef): boolean =>
  def.id === 'nh:floating_eye' || def.id === 'nh:mind_flayer' || def.id === 'nh:master_mind_flayer';

/** ref: src/eat.c intrinsic_possible() */
function intrinsicPossible(prop: string, def: MonsterDef): boolean {
  const c = CONVEYED.find((x) => x.prop === prop);
  if (!c) return false;
  return c.mr === null ? telepathic(def) : def.conveys.includes(c.mr);
}

/** The property to try to give, 'str' for a giant's strength, or null. ref: src/eat.c corpse_intrinsic() */
export function corpseIntrinsic(ctx: Ctx, def: MonsterDef): string | null {
  // ref: include/mondata.h is_giant()
  const conveysStr = def.flags.includes('giant');
  let count = 0;
  let prop: string | null = null;
  if (conveysStr) {
    count = 1;
    prop = 'str';
  }
  for (const c of CONVEYED) {
    if (!intrinsicPossible(c.prop, def)) continue;
    ++count;
    // a 1 in count chance of replacing the old choice with this one
    if (ctx.rng.rn2(count) === 0) prop = c.prop;
  }
  // if strength is the only candidate, give it 50% chance
  if (conveysStr && count === 1 && ctx.rng.rn2(2) === 0) prop = null;
  return prop;
}

/** ref: src/eat.c should_givit(): the chance depends on the monster's level and the property */
export function shouldGivit(ctx: Ctx, prop: string, def: MonsterDef): boolean {
  let chance: number;
  switch (prop) {
    case P.POISON_RES:
      chance =
        (def.id === 'nh:killer_bee' || def.id === 'nh:scorpion') && ctx.rng.rn2(4) === 0 ? 1 : 15;
      break;
    case P.TELEPAT:
      chance = 1;
      break;
    default:
      chance = 15;
      break;
  }
  return def.level > ctx.rng.rn2(chance);
}

/** ref: src/eat.c temp_givit(): stoning and acid resistance can come for a while */
function tempGivit(ctx: Ctx, prop: string, def: MonsterDef): boolean {
  const chance = prop === P.STONE_RES ? 6 : prop === P.ACID_RES ? 3 : 0;
  return chance ? def.level > ctx.rng.rn2(chance) : false;
}

const GIVIT_MESSAGES: Record<string, string> = {
  [P.FIRE_RES]: 'givit.fire',
  [P.SLEEP_RES]: 'givit.sleep',
  [P.COLD_RES]: 'givit.cold',
  [P.DISINT_RES]: 'givit.disint',
  [P.SHOCK_RES]: 'givit.shock',
  [P.TELEPAT]: 'givit.telepat',
};

/**
 * Tries to give the hero a property. ref: src/eat.c givit(). Not ported: Hallucination wording;
 * telepathy has no effect yet (blindness does not exist), but is recorded.
 */
export function givit(ctx: Ctx, prop: string, def: MonsterDef): void {
  if (!shouldGivit(ctx, prop, def) && !tempGivit(ctx, prop, def)) return;
  const hero = getPlayer(ctx.state);
  const say = (key: string): void => ctx.emit({ type: 'msg', key });
  switch (prop) {
    case P.ACID_RES:
    case P.STONE_RES:
      // timed resistance
      if (!hasProp(hero, prop)) say(prop === P.ACID_RES ? 'givit.acid' : 'givit.stone');
      incrItimeout(ctx.state, hero, prop, ctx.rng.d(3, 6));
      break;
    case P.POISON_RES:
      if (!hasIntrinsic(hero, prop)) {
        say(hasProp(hero, prop) ? 'givit.poison_more' : 'givit.poison');
        setIntrinsic(hero, prop, true);
      }
      break;
    default: {
      const key = GIVIT_MESSAGES[prop];
      if (key && !hasIntrinsic(hero, prop)) {
        say(key);
        setIntrinsic(hero, prop, true);
      }
      break;
    }
  }
}

/**
 * The effects of finishing a corpse of `def`. ref: src/eat.c cpostfx(). Ported: bats and lights
 * stun, then a chance at an intrinsic. Not ported (no systems for them): the wraith's level,
 * lycanthropy, mimicking, the quantum mechanic, shapeshifters, displacer beast, disenchanter,
 * the nurse, the stalker's invisibility, "a mild buzz" (the hero has no magic energy), and
 * hallucination from stunning corpses ("Oh wow! Great stuff!").
 */
export function cpostfxOf(ctx: Ctx, def: MonsterDef): void {
  const hero = getPlayer(ctx.state);
  let stuns = 0;
  switch (def.id) {
    case 'nh:stalker':
      stuns = 3;
      break;
    case 'nh:yellow_light':
    case 'nh:giant_bat':
      stuns = 2;
      break;
    case 'nh:bat':
      stuns = 1;
      break;
    default:
      break;
  }
  if (stuns > 0) {
    for (let i = 0; i < stuns; i++)
      makeStunned(ctx, timeoutLeft(ctx.state, hero, P.STUNNED) + 30, false);
    return; // these cases `break` without checking for an intrinsic
  }
  // possibly convey an intrinsic
  const prop = corpseIntrinsic(ctx, def);
  if (prop === 'str') gainstr(ctx, 0);
  else if (prop !== null) givit(ctx, prop, def);
}
