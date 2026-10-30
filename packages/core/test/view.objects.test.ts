import { describe, expect, test } from 'vitest';
import { createEngine } from '../src/engine';
import { getLevel, getPlayer } from '../src/state';
import type { Mod } from '../src/types/mod';
import type { GameState } from '../src/types/state';
import { applyUpdate, buildSnapshot, diffSnapshot } from '../src/view';
import { createQuery } from '../src/query';
import { actionsMod, terrainMod } from './helpers/fakeMods';
import { addItem, heroPos, objectsMod } from './helpers/objectMods';

const mk = (...extra: Mod[]) => createEngine([terrainMod(), actionsMod(), objectsMod(), ...extra]);
const engine = mk();
const fresh = (e = engine): GameState => e.newGame({ seed: 5, width: 40, height: 15 }).state;
const WAIT = { type: 'wait' } as const;
const idx = (s: GameState, p: { x: number; y: number }): number => p.y * getLevel(s).width + p.x;

/** Moves the hero to a room cell from which `target` is not visible; steps so vision refreshes. */
function moveAway(e: typeof engine, s: GameState, target: { x: number; y: number }): void {
  const hero = getPlayer(s).c.pos!;
  for (const r of getLevel(s).rooms) {
    for (const [x, y] of [
      [r.lx, r.ly],
      [r.hx, r.hy],
    ] as const) {
      hero.x = x;
      hero.y = y;
      e.step(s, WAIT);
      if (!s.visible.includes(idx(s, target))) return;
    }
  }
  throw new Error('no hidden spot');
}

describe('objects in the snapshot', () => {
  test('items are not entities; visible cells carry o', () => {
    const s = fresh();
    const p = heroPos(s);
    addItem(s, 'ob:apple', { pos: p, placed: 1 });
    addItem(s, 'ob:dagger', { pos: p, placed: 2 });
    engine.step(s, WAIT);
    const v = buildSnapshot(engine.registry, s);
    expect(v.entities.map((e) => e.id)).toEqual([s.playerId]);
    expect(v.cells[idx(s, p)]?.o).toBe('ob:dagger');
    expect(v.cells.filter((c) => c.o !== undefined)).toHaveLength(1);
    expect(v.legend['ob:apple']).toEqual({ ch: '%', fg: '#f00' });
    expect(v.legend['ob:ruby']).toBeDefined();
  });

  test('an unseen floor item is not shown, a remembered one is', () => {
    const s = fresh();
    const p = heroPos(s);
    addItem(s, 'ob:apple', { pos: p });
    // Not yet looked at: live objects only show on visible cells, and memory is empty.
    s.visible = [];
    expect(buildSnapshot(engine.registry, s).cells[idx(s, p)]?.o).toBeUndefined();
    engine.step(s, WAIT);
    expect(s.objectMemory[s.currentLevel]?.[String(idx(s, p))]).toBe('ob:apple');
    moveAway(engine, s, p);
    const v = buildSnapshot(engine.registry, s);
    expect(v.cells[idx(s, p)]).toMatchObject({ v: false, o: 'ob:apple' });
  });

  test('memory keeps the old object even if it moved while unseen, and is cleared when seen gone', () => {
    const s = fresh();
    const p = heroPos(s);
    const id = addItem(s, 'ob:apple', { pos: p });
    engine.step(s, WAIT);
    moveAway(engine, s, p);
    delete s.entities[String(id)]; // taken while unseen
    expect(buildSnapshot(engine.registry, s).cells[idx(s, p)]?.o).toBe('ob:apple');
    const hero = getPlayer(s).c.pos!;
    hero.x = p.x;
    hero.y = p.y;
    engine.step(s, WAIT);
    expect(s.objectMemory[s.currentLevel]?.[String(idx(s, p))]).toBeUndefined();
    expect(buildSnapshot(engine.registry, s).cells[idx(s, p)]?.o).toBeUndefined();
  });

  test('item removed while visible clears memory', () => {
    const s = fresh();
    const p = heroPos(s);
    const id = addItem(s, 'ob:apple', { pos: p });
    engine.step(s, WAIT);
    expect(s.objectMemory[s.currentLevel]?.[String(idx(s, p))]).toBe('ob:apple');
    delete s.entities[String(id)];
    engine.step(s, WAIT);
    expect(s.objectMemory[s.currentLevel]?.[String(idx(s, p))]).toBeUndefined();
  });

  test('shuffled items never leak their true def id outside the legend', () => {
    const s = fresh();
    const p = heroPos(s);
    s.appearances['ob:pot_a'] = 'ob:ruby';
    s.appearances['ob:pot_b'] = 'ob:blue';
    addItem(s, 'ob:pot_a', { pos: p });
    addItem(s, 'ob:pot_b', { carriedBy: s.playerId, letter: 'a' });
    engine.step(s, WAIT);
    const v = buildSnapshot(engine.registry, s);
    const { legend, ...rest } = v;
    expect(Object.keys(legend)).toContain('ob:pot_a');
    expect(JSON.stringify(rest)).not.toMatch(/ob:pot_[ab]/);
    expect(v.cells[idx(s, p)]?.o).toBe('ob:ruby');
    expect(v.inventory[0]?.g).toBe('ob:blue');
    expect(v.inventory[0]?.name).toEqual({ key: 'app.blue', params: { count: 1 } });
    const d = createQuery(engine.registry, s).describe(p);
    expect(JSON.stringify(d)).not.toMatch(/ob:pot_[ab]/);
    expect(d.objects[0]).toMatchObject({ def: 'ob:ruby', name: { key: 'app.ruby' } });
    expect(v.legend['ob:ruby']).toBeDefined();
    expect(JSON.stringify(s.objectMemory)).not.toMatch(/ob:pot_[ab]/);
  });
});

describe('inventory in the snapshot', () => {
  test('letter order, cls, equipped, default names', () => {
    const s = fresh();
    const me = s.playerId;
    addItem(s, 'ob:apple', { carriedBy: me, letter: 'c', quantity: 3 });
    addItem(s, 'ob:dagger', { carriedBy: me, letter: 'a', equipped: 'weapon' });
    addItem(s, 'ob:apple', { pos: heroPos(s) });
    const v = buildSnapshot(engine.registry, s);
    expect(v.inventory.map((i) => i.letter)).toEqual(['a', 'c']);
    expect(v.inventory[0]).toMatchObject({
      g: 'ob:dagger',
      cls: 'weapon',
      equipped: 'weapon',
      name: { key: 'desc.dagger', params: { count: 1 } },
    });
    expect(v.inventory[1]).toMatchObject({
      cls: 'food',
      equipped: null,
      name: { key: 'obj.apple', params: { count: 3 } },
    });
  });

  test('a custom namer is used', () => {
    const e = mk({
      id: 'nm',
      version: '1',
      register: (api) =>
        api.setItemNamer((_s, _d, item) => ({ key: 'custom', params: { n: item.id } })),
    });
    const s = fresh(e);
    const id = addItem(s, 'ob:apple', { carriedBy: s.playerId, letter: 'a' });
    expect(buildSnapshot(e.registry, s).inventory[0]?.name).toEqual({
      key: 'custom',
      params: { n: id },
    });
    const p = heroPos(s);
    addItem(s, 'ob:apple', { pos: p });
    e.step(s, WAIT);
    expect(e.query(s).describe(p).objects[0]?.name.key).toBe('custom');
  });
});

describe('status defs', () => {
  const statusEngine = mk({
    id: 'st',
    version: '1',
    register(api) {
      api.defineStatus({ id: 'st:gold', field: 'gold', value: () => 7 });
      api.defineStatus({ id: 'st:turn', field: 'turn', value: (s) => `T${s.turn}` });
      api.defineStatus({ id: 'st:dlvl', field: 'dlvl', value: () => null });
      api.defineStatus({ id: 'st:g1', field: 'late', value: () => 1 });
      api.defineStatus({ id: 'st:g2', field: 'late', value: () => 2 });
    },
  });

  test('replace built-ins, null removes, later wins', () => {
    const s = fresh(statusEngine);
    const st = buildSnapshot(statusEngine.registry, s).status;
    expect(st.gold).toBe(7);
    expect(st.turn).toBe(`T${s.turn}`);
    expect('dlvl' in st).toBe(false);
    expect(st.late).toBe(2);
  });
});

describe('diff and apply', () => {
  test('only o changing emits the cell', () => {
    const s = fresh();
    const p = heroPos(s);
    const prev = buildSnapshot(engine.registry, s);
    addItem(s, 'ob:apple', { pos: p });
    engine.step(s, WAIT);
    const d = diffSnapshot(prev, buildSnapshot(engine.registry, s));
    expect(d.kind).toBe('delta');
    if (d.kind !== 'delta') return;
    expect(d.cells).toEqual([[idx(s, p), expect.objectContaining({ o: 'ob:apple' })]]);
  });

  test('deltas and applyUpdate carry inventory', () => {
    const s = fresh();
    const prev = buildSnapshot(engine.registry, s);
    expect(prev.inventory).toEqual([]);
    addItem(s, 'ob:apple', { carriedBy: s.playerId, letter: 'a' });
    const next = buildSnapshot(engine.registry, s);
    const d = diffSnapshot(prev, next);
    if (d.kind !== 'delta') throw new Error('expected delta');
    expect(d.inventory).toEqual(next.inventory);
    const applied = applyUpdate(prev, d);
    expect(applied.inventory).toEqual(next.inventory);
    expect(prev.inventory).toEqual([]);
  });
});

describe('describe', () => {
  test('objects top first, entities without items, invisible cells give []', () => {
    const s = fresh();
    const p = heroPos(s);
    const a = addItem(s, 'ob:apple', { pos: p, placed: 1 });
    const b = addItem(s, 'ob:dagger', { pos: p, placed: 2 });
    engine.step(s, WAIT);
    const d = engine.query(s).describe(p);
    expect(d.entities).toEqual([{ id: s.playerId, def: 'nh:hero' }]);
    expect(d.objects.map((o) => o.id)).toEqual([b, a]);
    expect(d.objects[0]).toEqual({
      id: b,
      def: 'ob:dagger',
      name: { key: 'desc.dagger', params: { count: 1 } },
    });
    moveAway(engine, s, p);
    const gone = engine.query(s).describe(p);
    expect(gone.objects).toEqual([]);
    expect(gone.remembered).toBe(true);
  });
});
