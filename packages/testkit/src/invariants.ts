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
    const key = `${p.level}:${p.x},${p.y}`;
    const other = seen.get(key);
    if (other !== undefined) errs.push(`entities ${other} and ${id} share cell ${key}`);
    else seen.set(key, id);
  }

  const player = state.entities[String(state.playerId)];
  if (!player) errs.push(`player entity ${state.playerId} missing`);
  else {
    if (!player.c.actor) errs.push('player has no actor component');
    if (!player.c.pos) errs.push('player has no pos component');
    else if (player.c.pos.level !== state.currentLevel) {
      errs.push(`player on '${player.c.pos.level}' but currentLevel is '${state.currentLevel}'`);
    }
  }

  if (state.pendingPrompt && state.gameOver) errs.push('pendingPrompt and gameOver are both set');
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
