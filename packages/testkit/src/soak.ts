import {
  DIRS,
  VANILLA_TERRAIN,
  DIR_LIST,
  createEngine,
  createRng,
  getPlayer,
  inventoryOf,
  seedRng,
  sortedIds,
  stateHash,
  type ActionOffer,
  type Dir,
  type EntityId,
  type GameState,
  type HungerState,
  type Json,
  type Mod,
  type PlayerAction,
  type Pos,
  type Prompt,
  type Rng,
} from '@nh/core';
import { checkInvariants } from './invariants';

export interface SoakOptions {
  seed: number;
  turns: number;
  width?: number;
  height?: number;
  botSeed?: number;
  checkEvery?: number;
  /** The bot stops descending below this dungeon depth. Default: unlimited. */
  maxDepth?: number;
  /** Return violations instead of throwing. */
  collect?: boolean;
}

export interface SoakViolation {
  step: number;
  action: PlayerAction | null;
  errors: string[];
}

export interface SoakResult {
  actions: number;
  finalHash: string;
  turns: number;
  violations: SoakViolation | null;
  cellsExplored: number;
  /** Greatest dungeon depth the hero reached. */
  deepestLevel: number;
  /** Monsters the hero killed or destroyed (counted from 'combat.you_kill'/'combat.you_destroy' messages). */
  kills: number;
  /** The actions taken, so a failure can be replayed. */
  log: PlayerAction[];
  /** How the run ended: still playing at the turn limit, or the game ended. */
  outcome: 'playing' | 'died' | 'escaped';
  /** Objects the hero gained through pickup actions (sum of quantity gained, gold excluded). */
  pickedUp: number;
  /** Eat, quaff, read and throw actions the bot issued (an action may be refused by the game). */
  eaten: number;
  quaffed: number;
  read: number;
  thrown: number;
  /** The hero's hunger state when the run stopped (null if she has no hunger component). */
  hunger: HungerState | null;
}

/** Direction from `from` to `to` when they are in line (orthogonal or diagonal), else null. */
function lineDir(from: Pos, to: Pos): Dir | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return null;
  if (dx !== 0 && dy !== 0 && Math.abs(dx) !== Math.abs(dy)) return null;
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  for (const d of DIR_LIST) {
    const v = DIRS[d];
    if (v.x === sx && v.y === sy) return d;
  }
  return null;
}

const isMod = (a: PlayerAction, id: string): boolean => a.type === 'mod' && a.action === id;

/**
 * A seeded bot that plays like a player would, driven only by `actionsFor()` offers. Priority:
 * (while a multi-turn action is in progress: usually `continue`, sometimes cancel it) attack an adjacent hostile; eat when hungry; quaff when hurt; pick things up; occasionally wield,
 * wear, take off, read, throw daggers at monsters in line, drop; take stairs down; else a random
 * offer. Checks invariants as it goes.
 */
export function soak(mods: readonly Mod[], opts: SoakOptions): SoakResult {
  const engine = createEngine(mods);
  const { state } = engine.newGame({
    seed: opts.seed,
    ...(opts.width !== undefined ? { width: opts.width } : {}),
    ...(opts.height !== undefined ? { height: opts.height } : {}),
  });
  const rng: Rng = createRng(seedRng(opts.botSeed ?? opts.seed ^ 0x5eed));
  const every = Math.max(1, opts.checkEvery ?? 1);
  const maxActions = opts.turns * 20;
  const log: PlayerAction[] = [];
  let kills = 0;
  let deepest = 1;
  let pickedUp = 0;
  let eaten = 0;
  let quaffed = 0;
  let read = 0;
  let thrown = 0;
  let aim: Dir | null = null;
  const depthNow = (): number => state.levels[state.currentLevel]?.depth ?? 1;
  const carriedCount = (): number => {
    let n = 0;
    for (const e of inventoryOf(state, state.playerId)) {
      if (e.c.item?.letter !== '$') n += e.c.item?.quantity ?? 0;
    }
    return n;
  };
  /** Whether the last step left a multi-turn action in progress, as the UI would see it. */
  let continuing = false;
  const stepAndTrack = (a: PlayerAction): void => {
    const before = isMod(a, 'nh:pickup') ? carriedCount() : 0;
    const r = engine.step(state, a);
    continuing = r.continuing;
    for (const e of r.events) {
      if (e.type === 'msg' && (e.key === 'combat.you_kill' || e.key === 'combat.you_destroy'))
        kills++;
    }
    if (isMod(a, 'nh:pickup')) pickedUp += Math.max(0, carriedCount() - before);
    deepest = Math.max(deepest, depthNow());
  };
  let violations: SoakViolation | null = null;

  const check = (action: PlayerAction | null): void => {
    const errors = checkInvariants(state, engine.registry);
    if (errors.length > 0) violations = { step: log.length, action, errors };
  };
  check(null);

  const heroPos = (): Pos => {
    const p = getPlayer(state).c.pos;
    if (!p) throw new Error('player has no pos');
    return { x: p.x, y: p.y };
  };
  /** Monsters on this level that the hero can currently see. */
  const visibleMonsters = (): { id: EntityId; pos: Pos; peaceful: boolean }[] => {
    const level = state.levels[state.currentLevel];
    if (!level) return [];
    const vis = new Set(state.visible);
    const out: { id: EntityId; pos: Pos; peaceful: boolean }[] = [];
    for (const id of sortedIds(state)) {
      const e = state.entities[String(id)];
      const p = e?.c.pos;
      if (!e?.c.monster || !p || p.level !== level.id) continue;
      if (vis.has(p.y * level.width + p.x))
        out.push({ id, pos: { x: p.x, y: p.y }, peaceful: e.c.monster.peaceful });
    }
    return out;
  };

  const answer = (pending: Prompt): Json => {
    const opts_ = pending.options ?? [];
    if (pending.kind === 'yn') {
      // Never leave the dungeon, so runs keep going.
      return pending.id === 'leave-dungeon' ? false : rng.rn2(2) === 0;
    }
    if (pending.kind === 'direction') {
      const dirs = opts_.map((o) => o.value);
      if (aim !== null && (dirs.length === 0 || dirs.includes(aim))) return aim;
      const here = heroPos();
      for (const m of visibleMonsters()) {
        if (m.peaceful) continue;
        const d = lineDir(here, m.pos);
        if (d !== null && Math.max(Math.abs(m.pos.x - here.x), Math.abs(m.pos.y - here.y)) === 1)
          return d;
      }
      if (dirs.length > 0) return dirs[rng.rn2(dirs.length)] as Json;
      return DIR_LIST[rng.rn2(8)] as Json;
    }
    // menu
    if (opts_.length === 0) return pending.multi ? [] : null;
    if (pending.multi) {
      const chosen = opts_.filter(() => rng.rn2(2) === 0).map((o) => o.value);
      if (chosen.length === 0)
        chosen.push((opts_[rng.rn2(opts_.length)] as (typeof opts_)[0]).value);
      return chosen;
    }
    return (opts_[rng.rn2(opts_.length)] as (typeof opts_)[0]).value;
  };

  while (!violations && !state.gameOver && state.turn < opts.turns && log.length < maxActions) {
    const pending = state.pendingPrompt;
    if (pending) {
      const act: PlayerAction = {
        type: 'answer',
        promptId: pending.prompt.id,
        value: answer(pending.prompt),
      };
      aim = null;
      log.push(act);
      stepAndTrack(act);
      if (log.length % every === 0) check(act);
      continue;
    }
    if (continuing && rng.rn2(10) !== 0) {
      // like the UI animating a travel, run or meal; one time in ten the bot cancels it by
      // taking another action instead
      const act: PlayerAction = { type: 'continue' };
      log.push(act);
      stepAndTrack(act);
      if (log.length % every === 0) check(act);
      continue;
    }
    const q = engine.query(state);
    const pos = heroPos();
    const hero = getPlayer(state);
    const selfOffers = q.actionsFor({ kind: 'self' });
    const offers: ActionOffer[] = [...selfOffers];
    const cellOffers: ActionOffer[] = [];
    for (const d of DIR_LIST) {
      const v = DIRS[d];
      cellOffers.push(...q.actionsFor({ kind: 'cell', pos: { x: pos.x + v.x, y: pos.y + v.y } }));
    }
    offers.push(...cellOffers);
    const capped = depthNow() >= (opts.maxDepth ?? Infinity);
    if (capped) {
      for (let i = offers.length - 1; i >= 0; i--) {
        const o = offers[i]?.action;
        if (o?.type === 'mod' && o.action === 'nh:down') offers.splice(i, 1);
      }
    }
    if (offers.length === 0) throw new Error('soak: actionsFor offered nothing');

    const inv = inventoryOf(state, state.playerId);
    const itemOffers = (pred: (id: string) => boolean): ActionOffer[] => {
      const out: ActionOffer[] = [];
      for (const it of inv) {
        for (const o of q.actionsFor({ kind: 'item', id: it.id })) {
          if (o.action.type === 'mod' && pred(o.action.action)) out.push(o);
        }
      }
      return out;
    };
    const pickRandom = (list: readonly ActionOffer[]): PlayerAction | null =>
      list.length === 0 ? null : (list[rng.rn2(list.length)] as ActionOffer).action;

    const hp = hero.c.hp;
    const hunger = hero.c.hunger?.state;
    let action: PlayerAction | null = null;

    // 1. attack an adjacent hostile that the offers allow
    const attacks = cellOffers.filter((o) => o.labelKey === 'action.attack');
    if (attacks.length > 0 && rng.rn2(10) !== 0) action = pickRandom(attacks);

    // 2. eat when hungry: inventory food first, else food on the floor
    if (!action && (hunger === 'hungry' || hunger === 'weak' || hunger === 'fainting')) {
      const food = itemOffers((id) => id === 'nh:eat');
      const here = selfOffers.filter((o) => isMod(o.action, 'nh:eat'));
      action = pickRandom(here.length > 0 ? here : food);
    }

    // 3. quaff when hurt
    if (!action && hp && hp.cur * 3 < hp.max && rng.rn2(2) === 0) {
      action = pickRandom(itemOffers((id) => id === 'nh:quaff'));
    }

    // 4. pick up what lies here
    if (!action && rng.rn2(10) < 4) {
      action = pickRandom(selfOffers.filter((o) => isMod(o.action, 'nh:pickup')));
    }

    // 5. occasional gear, reading, throwing, dropping and eating when not hungry
    if (!action) {
      const roll = rng.rn2(100);
      if (roll < 6) action = pickRandom(itemOffers((id) => id === 'nh:wield'));
      else if (roll < 12) action = pickRandom(itemOffers((id) => id === 'nh:wear'));
      else if (roll < 14) action = pickRandom(itemOffers((id) => id === 'nh:takeoff'));
      else if (roll < 18) action = pickRandom(itemOffers((id) => id === 'nh:read'));
      else if (roll < 20) action = pickRandom(itemOffers((id) => id === 'nh:eat'));
      else if (roll < 21) action = pickRandom(itemOffers((id) => id === 'nh:quaff'));
      else if (roll < 23)
        action = pickRandom(selfOffers.filter((o) => isMod(o.action, 'nh:drop_many')));
      else if (roll < 33) {
        // throw a dagger at a visible monster that stands in line
        const targets = visibleMonsters().filter((m) => !m.peaceful && lineDir(pos, m.pos));
        const target = targets[0];
        if (target) {
          const daggers = inv
            .filter((e) => e.def === 'nh:dagger')
            .flatMap((e) => q.actionsFor({ kind: 'item', id: e.id }))
            .filter((o) => isMod(o.action, 'nh:throw'));
          action = pickRandom(daggers);
          if (action) aim = lineDir(pos, target.pos);
        }
      }
    }

    // 6. descend 1 time in 4 when standing on a down staircase, so runs visit several levels
    if (!action) {
      const descend = offers.find((o) => isMod(o.action, 'nh:down'));
      if (descend && rng.rn2(4) === 0) action = descend.action;
    }

    // 6b. head for a remembered down staircase now and then (travel offers come from the cell)
    if (!action && !capped && rng.rn2(8) === 0) {
      const level = state.levels[state.currentLevel];
      const mem = state.memory[state.currentLevel];
      const pi = level?.palette.indexOf(VANILLA_TERRAIN.stairs_down) ?? -1;
      const at = pi >= 0 && mem ? mem.indexOf(pi) : -1;
      if (level && at >= 0) {
        const go = q
          .actionsFor({
            kind: 'cell',
            pos: { x: at % level.width, y: Math.floor(at / level.width) },
          })
          .find((o) => isMod(o.action, 'nh:travel'));
        if (go) action = go.action;
      }
    }

    // 7. anything else: a random offer, except the book-keeping ones that take no time
    if (!action) {
      const rest = offers.filter(
        (o) => !isMod(o.action, 'nh:discoveries') && !isMod(o.action, 'nh:drop_many'),
      );
      const list = rest.length > 0 ? rest : offers;
      action = (list[rng.rn2(list.length)] as ActionOffer).action;
    }

    if (isMod(action, 'nh:eat')) eaten++;
    else if (isMod(action, 'nh:quaff')) quaffed++;
    else if (isMod(action, 'nh:read')) read++;
    else if (isMod(action, 'nh:throw')) thrown++;
    else aim = null;
    log.push(action);
    stepAndTrack(action);
    if (log.length % every === 0) check(action);
  }
  if (!violations) check(log[log.length - 1] ?? null);

  const mem = state.memory[state.currentLevel] ?? [];
  const result: SoakResult = {
    actions: log.length,
    finalHash: stateHash(state),
    turns: state.turn,
    violations,
    deepestLevel: deepest,
    kills,
    cellsExplored: mem.filter((m) => m >= 0).length,
    log,
    outcome: state.gameOver?.kind ?? 'playing',
    pickedUp,
    eaten,
    quaffed,
    read,
    thrown,
    hunger: getPlayer(state as GameState).c.hunger?.state ?? null,
  };
  const v = result.violations as SoakViolation | null;
  if (v && !opts.collect) {
    throw new Error(
      `soak invariant violation at step ${v.step} after ${JSON.stringify(v.action)}:\n  ${v.errors.join('\n  ')}`,
    );
  }
  return result;
}
