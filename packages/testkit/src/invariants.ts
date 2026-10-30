import {
  cellIndex,
  inBounds,
  isJsonPlain,
  sortedIds,
  stateHash,
  type GameState,
  type Registry,
} from '@nh/core';

/** Returns a list of violated invariants; empty means the state is healthy. */
export function checkInvariants(state: GameState, registry: Registry): string[] {
  const errs: string[] = [];
  const plain = isJsonPlain(state);
  if (!plain) errs.push('state is not JSON-plain');

  for (const lid of Object.keys(state.levels).sort()) {
    const lv = state.levels[lid];
    if (!lv) continue;
    const n = lv.width * lv.height;
    if (lv.cells.length !== n) errs.push(`level ${lid}: cells length ${lv.cells.length} != ${n}`);
    if (lv.lit.length !== n) errs.push(`level ${lid}: lit length ${lv.lit.length} != ${n}`);
    for (const c of lv.cells) {
      if (!Number.isInteger(c) || c < 0 || c >= lv.palette.length) {
        errs.push(`level ${lid}: palette index ${c} out of range 0..${lv.palette.length - 1}`);
        break;
      }
    }
    for (const id of lv.palette) {
      if (!registry.hasTerrain(id))
        errs.push(`level ${lid}: palette terrain '${id}' is not registered`);
    }
    const mem = state.memory[lid];
    if (mem) {
      if (mem.length !== n) errs.push(`memory ${lid}: length ${mem.length} != ${n}`);
      for (const m of mem) {
        if (!Number.isInteger(m) || m < -1 || m >= lv.palette.length) {
          errs.push(`memory ${lid}: value ${m} out of range`);
          break;
        }
      }
    } else if (lid === state.currentLevel) {
      errs.push(`memory ${lid}: missing for current level`);
    }
  }

  const seen = new Map<string, number>();
  for (const id of sortedIds(state)) {
    const e = state.entities[String(id)];
    if (!e) continue;
    if (e.id !== id) errs.push(`entity key ${id} has id ${e.id}`);
    if (e.c.hp) {
      const { cur, max } = e.c.hp;
      const heroDead = id === state.playerId && state.gameOver !== null;
      if (!Number.isInteger(cur) || !Number.isInteger(max) || max < 1) {
        errs.push(`entity ${id}: bad hp ${cur}/${max}`);
      } else if (cur > max || (cur <= 0 && !heroDead)) {
        errs.push(`entity ${id} (${e.def}): hp ${cur}/${max} out of range`);
      }
    }
    if (e.c.monster && !registry.isMonster(e.def))
      errs.push(`entity ${id}: def '${e.def}' is not a registered monster`);
    if (e.c.actor && !Number.isFinite(e.c.actor.energy))
      errs.push(`entity ${id}: energy ${e.c.actor.energy} is not finite`);
    else if (e.c.actor && !Number.isInteger(e.c.actor.energy))
      errs.push(`entity ${id}: energy ${e.c.actor.energy} is not an integer`);
    const p = e.c.pos;
    if (!p) continue;
    const lv = state.levels[p.level];
    if (!lv) {
      errs.push(`entity ${id}: on unknown level '${p.level}'`);
      continue;
    }
    if (!inBounds(lv, p.x, p.y)) {
      errs.push(`entity ${id}: out of bounds at ${p.x},${p.y} on ${p.level}`);
      continue;
    }
    const pal = lv.palette[lv.cells[cellIndex(lv, p.x, p.y)] ?? -1];
    if (pal === undefined || !registry.hasTerrain(pal) || !registry.terrain(pal).passable) {
      errs.push(`entity ${id}: on impassable cell (${pal ?? '?'}) at ${p.x},${p.y}`);
    }
    // Objects pile up; only creatures need a cell to themselves.
    if (e.c.item) continue;
    const key = `${p.level}:${p.x},${p.y}`;
    const other = seen.get(key);
    if (other !== undefined) errs.push(`entities ${other} and ${id} share cell ${key}`);
    else seen.set(key, id);
  }

  // Items: exactly one place, a living carrier, unique inventory letters per carrier.
  const letters = new Map<string, number>();
  for (const id of sortedIds(state)) {
    const e = state.entities[String(id)];
    const item = e?.c.item;
    if (!e || !item) continue;
    if (!registry.isObject(e.def))
      errs.push(`item ${id}: def '${e.def}' is not a registered object`);
    if (!Number.isInteger(item.quantity) || item.quantity < 1)
      errs.push(`item ${id}: quantity ${item.quantity} is not a positive integer`);
    if ((e.c.pos !== undefined) === (item.carriedBy !== null))
      errs.push(`item ${id}: must be either on the floor or carried, not both or neither`);
    if (item.carriedBy !== null) {
      if (!state.entities[String(item.carriedBy)])
        errs.push(`item ${id}: carried by missing entity ${item.carriedBy}`);
      if (item.letter !== null) {
        const k = `${item.carriedBy}:${item.letter}`;
        const other = letters.get(k);
        if (other !== undefined) errs.push(`items ${other} and ${id} share letter ${k}`);
        else letters.set(k, id);
      }
    } else if (item.equipped !== null) {
      // A floor item may keep its last letter (obj->invlet), so it gets it back when picked up.
      errs.push(`item ${id}: on the floor but equipped`);
    }
  }

  checkEquipment(state, registry, errs);

  const player = state.entities[String(state.playerId)];
  if (!player) errs.push(`player entity ${state.playerId} missing`);
  else {
    if (!player.c.actor) errs.push('player has no actor component');
    if (!player.c.pos) errs.push('player has no pos component');
    else if (player.c.pos.level !== state.currentLevel) {
      errs.push(`player on '${player.c.pos.level}' but currentLevel is '${state.currentLevel}'`);
    }
  }

  if (player?.c.hunger && !Number.isInteger(player.c.hunger.nutrition))
    errs.push(`hero nutrition ${player.c.hunger.nutrition} is not an integer`);
  // content's nomul() sets until = turn + 1 + n and its endOfTurn hook deletes the component once
  // turn >= until, so after a step a helpless hero must still have time left.
  for (const id of sortedIds(state)) {
    const h = state.entities[String(id)]?.c.helpless;
    if (h && (!Number.isInteger(h.until) || (h.until <= state.turn && !state.gameOver)))
      errs.push(`entity ${id}: helpless until ${h.until} but the turn is ${state.turn}`);
  }

  if (state.pendingPrompt && state.gameOver) errs.push('pendingPrompt and gameOver are both set');
  if (state.occupation !== null) {
    const occ = state.occupation;
    if (!occ || typeof occ !== 'object' || typeof occ.action?.type !== 'string')
      errs.push('occupation has no valid action');
    else if (occ.action.type === 'continue' || occ.action.type === 'answer')
      errs.push(`occupation action '${occ.action.type}' cannot continue`);
    else if (occ.action.type === 'mod') {
      const id = occ.action.action;
      if (!registry.actions.some((a) => a.id === id))
        errs.push(`occupation action '${id}' is not registered`);
    }
    if (state.pendingPrompt) errs.push('occupation is set while a prompt is pending');
    if (state.gameOver) errs.push('occupation is set after game over');
  }
  const heroPos = player?.c.pos;
  if (heroPos && state.levels[state.currentLevel] && heroPos.level !== state.currentLevel) {
    errs.push(`hero level '${heroPos.level}' != currentLevel '${state.currentLevel}'`);
  }

  const cur = state.levels[state.currentLevel];
  if (!cur) errs.push(`current level '${state.currentLevel}' missing`);
  else {
    const n = cur.width * cur.height;
    for (let i = 0; i < state.visible.length; i++) {
      const v = state.visible[i] as number;
      if (!Number.isInteger(v) || v < 0 || v >= n) {
        errs.push(`visible[${i}]=${v} out of range`);
        break;
      }
      if (i > 0 && v <= (state.visible[i - 1] as number)) {
        errs.push(`visible not strictly ascending at ${i}`);
        break;
      }
    }
  }

  for (let i = 1; i < state.timers.length; i++) {
    const a = state.timers[i - 1];
    const b = state.timers[i];
    if (a && b && (a.at > b.at || (a.at === b.at && a.seq >= b.seq))) {
      errs.push(`timers not sorted by (at,seq) at index ${i}`);
      break;
    }
  }

  if (plain) {
    const back = JSON.parse(JSON.stringify(state)) as GameState;
    if (stateHash(back) !== stateHash(state)) errs.push('JSON round-trip changes the state hash');
  }
  return errs;
}

const INVLET = /^[$a-zA-Z#]$/;

/**
 * Carriers and equipment: a carried item's carrier is the hero or a monster standing on a level,
 * every equipped item is carried, a carrier has at most one wielded weapon and one piece of armor
 * per slot (and the slot matches the item's def), and the hero's items have valid letters.
 * Weight conservation is not checked: weights are derived from the items, never stored, so there
 * is no redundant total to keep in sync.
 */
function checkEquipment(state: GameState, registry: Registry, errs: string[]): void {
  const slots = new Map<string, number>();
  for (const id of sortedIds(state)) {
    const e = state.entities[String(id)];
    const item = e?.c.item;
    if (!e || !item || item.carriedBy === null) continue;
    const carrier = state.entities[String(item.carriedBy)];
    if (carrier && item.carriedBy !== state.playerId) {
      const p = carrier.c.pos;
      if (!p || !state.levels[p.level])
        errs.push(`item ${id}: carrier ${item.carriedBy} is not on a level`);
    }
    if (item.carriedBy === state.playerId) {
      if (item.letter === null || !INVLET.test(item.letter))
        errs.push(
          `item ${id}: hero inventory letter '${item.letter ?? 'null'}' is not in $a-zA-Z#`,
        );
    }
    if (item.equipped === null) continue;
    const k = `${item.carriedBy}:${item.equipped}`;
    const other = slots.get(k);
    if (other !== undefined) errs.push(`items ${other} and ${id} both occupy slot ${k}`);
    else slots.set(k, id);
    if (registry.isObject(e.def)) {
      const def = registry.object(e.def);
      // anything may be wielded, but only armor of the matching slot can be worn there
      if (item.equipped !== 'weapon' && def.armor?.slot !== item.equipped) {
        errs.push(
          `item ${id}: '${e.def}' worn in slot ${item.equipped}, its slot is ${def.armor?.slot ?? 'none'}`,
        );
      }
    }
  }
}
