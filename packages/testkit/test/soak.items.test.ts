import { vanillaMod } from '@nh/content';
import {
  DIRS,
  DIR_LIST,
  buildSnapshot,
  createEngine,
  getPlayer,
  inventoryOf,
  type DefId,
  type GameState,
  type Json,
  type PlayerAction,
} from '@nh/core';
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { checkInvariants, soak } from '../src/index';

const engine = createEngine([vanillaMod]);

/** Offers from the hero's cell, her neighbours and every item she carries. */
function allOffers(state: GameState): PlayerAction[] {
  const q = engine.query(state);
  const pos = getPlayer(state).c.pos!;
  const out = q.actionsFor({ kind: 'self' }).map((o) => o.action);
  for (const d of DIR_LIST) {
    const v = DIRS[d];
    out.push(
      ...q
        .actionsFor({ kind: 'cell', pos: { x: pos.x + v.x, y: pos.y + v.y } })
        .map((o) => o.action),
    );
  }
  for (const it of inventoryOf(state, state.playerId)) {
    out.push(...q.actionsFor({ kind: 'item', id: it.id }).map((o) => o.action));
  }
  return out;
}

/** Plays `picks` (indices into the current offers, or the current prompt's options). */
function play(state: GameState, picks: readonly number[], onStep?: () => void): void {
  for (const pick of picks) {
    if (state.gameOver) return;
    const p = state.pendingPrompt?.prompt;
    let action: PlayerAction;
    if (p) {
      const opts = p.options ?? [];
      let value: Json;
      if (p.kind === 'yn') value = p.id === 'leave-dungeon' ? false : pick % 2 === 0;
      else if (p.kind === 'direction') value = DIR_LIST[pick % 8] as Json;
      else if (p.multi) value = opts.length ? [opts[pick % opts.length]!.value] : [];
      else value = opts.length ? opts[pick % opts.length]!.value : null;
      action = { type: 'answer', promptId: p.id, value };
    } else {
      const offers = allOffers(state);
      action = offers[pick % offers.length]!;
    }
    engine.step(state, action);
    onStep?.();
  }
}

describe('item soak', () => {
  const totals = { pickedUp: 0, eaten: 0, quaffed: 0, read: 0, thrown: 0, kills: 0 };
  for (const seed of [101, 102, 103, 104, 105]) {
    test(`seed ${seed}: 2000 turns with item invariants`, { timeout: 60000 }, () => {
      const r = soak([vanillaMod], { seed, turns: 2000, checkEvery: 5 });
      expect(r.violations).toBeNull();
      totals.pickedUp += r.pickedUp;
      totals.eaten += r.eaten;
      totals.quaffed += r.quaffed;
      totals.read += r.read;
      totals.thrown += r.thrown;
      totals.kills += r.kills;
    });
  }
  test('across the seeds the bot picked up, ate and threw things', () => {
    expect(totals.pickedUp).toBeGreaterThan(0);
    expect(totals.eaten).toBeGreaterThan(0);
    expect(totals.thrown).toBeGreaterThan(0);
  });
});

describe('item properties', () => {
  test('after any sequence of offered actions the invariants hold', { timeout: 60000 }, () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100000 }),
        fc.array(fc.nat(1000), { minLength: 1, maxLength: 80 }),
        (seed, picks) => {
          const { state } = engine.newGame({ seed });
          play(state, picks);
          expect(checkInvariants(state, engine.registry)).toEqual([]);
        },
      ),
      { numRuns: 40 },
    );
  });

  test('the view never shows a shuffled object by its true id', { timeout: 60000 }, () => {
    const check = (state: GameState): void => {
      const snap = buildSnapshot(engine.registry, state);
      const shown = JSON.stringify({
        cells: snap.cells,
        entities: snap.entities,
        inventory: snap.inventory.map((i) => i.g),
      });
      const names = JSON.stringify(snap.inventory.map((i) => i.name));
      const defs = Object.keys(state.appearances).sort() as DefId[];
      expect(defs.length).toBeGreaterThan(0);
      for (const def of defs) {
        expect(shown, `${def} leaked into the view`).not.toContain(def);
        // A discovered type is named by its true name; an undiscovered one must not be.
        if (!state.discovered.includes(def))
          expect(names, `${def} leaked into an item name`).not.toContain(def);
      }
    };
    for (const seed of [1, 2, 3, 4, 5]) {
      const { state } = engine.newGame({ seed });
      check(state);
      // a pseudo-random walk through offered actions, checking the view along the way
      const picks = Array.from({ length: 150 }, (_, i) => (i * 7919 + seed * 31) % 997);
      let n = 0;
      play(state, picks, () => {
        if (n++ % 10 === 0) check(state);
      });
      check(state);
    }
  });
});
