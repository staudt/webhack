import { describe, expect, test } from 'vitest';
import { createEngine } from '../src/engine';
import type { Target } from '../src/types/query';
import { actionsMod, terrainMod } from './helpers/fakeMods';
import { addItem, heroPos, objectsMod } from './helpers/objectMods';

const seen: Target[] = [];
const engine = createEngine([
  terrainMod(),
  actionsMod((api) =>
    api.defineAction({
      id: 'fk:use',
      labelKey: 'a.use',
      handles: 'mod',
      offer(_ctx, t) {
        seen.push(t);
        return t.kind === 'item'
          ? [{ action: { type: 'mod', action: 'fk:use', args: t.id }, labelKey: 'a.use' }]
          : [];
      },
      perform: () => 12,
    }),
  ),
  objectsMod(),
]);

describe('actionsFor item targets', () => {
  test('only hero-carried items get offers', () => {
    const { state } = engine.newGame({ seed: 5, width: 40, height: 15 });
    const q = engine.query(state);
    const floor = addItem(state, 'ob:apple', { pos: heroPos(state) });
    const monster = addItem(state, 'ob:apple', { carriedBy: floor });
    const mine = addItem(state, 'ob:apple', { carriedBy: state.playerId, letter: 'a' });
    seen.length = 0;
    expect(q.actionsFor({ kind: 'item', id: floor })).toEqual([]);
    expect(q.actionsFor({ kind: 'item', id: monster })).toEqual([]);
    expect(q.actionsFor({ kind: 'item', id: 9999 })).toEqual([]);
    expect(seen).toEqual([]);
    expect(q.actionsFor({ kind: 'item', id: mine })).toEqual([
      { action: { type: 'mod', action: 'fk:use', args: mine }, labelKey: 'a.use', source: 'fk' },
    ]);
    expect(seen).toEqual([{ kind: 'item', id: mine }]);
  });
});
