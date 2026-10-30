import type { DefId, EntityId } from '../../src/types/common';
import type { ItemComponent } from '../../src/types/entity';
import type { Mod, ModApi, ObjectDef } from '../../src/types/mod';
import type { GameState } from '../../src/types/state';
import { getPlayer } from '../../src/state';

export const GLYPH = { ch: ')', fg: '#fff' };

/** A complete valid ObjectDef; override fields per test. */
export const objDef = (name: string, extra: Partial<ObjectDef> = {}): ObjectDef => ({
  id: `ob:${name}`,
  nameKey: `obj.${name}`,
  class: 'weapon',
  glyph: GLYPH,
  prob: 10,
  weight: 10,
  cost: 4,
  material: 'iron',
  merge: false,
  magic: false,
  delay: 0,
  ...extra,
});

/** Mod 'ob': a dagger (with descKey), an apple (no desc), two potions with two appearances. */
export const objectsMod = (extra: (api: ModApi) => void = () => undefined): Mod => ({
  id: 'ob',
  version: '1.0.0',
  register(api) {
    api.defineObject(objDef('dagger', { descKey: 'desc.dagger', glyph: { ch: ')', fg: '#aaa' } }));
    api.defineObject(
      objDef('apple', { class: 'food', glyph: { ch: '%', fg: '#f00' }, food: { nutrition: 50 } }),
    );
    api.defineObject(objDef('pot_a', { class: 'potion', glyph: { ch: '!', fg: '#0f0' } }));
    api.defineObject(objDef('pot_b', { class: 'potion', glyph: { ch: '!', fg: '#00f' } }));
    api.defineAppearance({
      id: 'ob:ruby',
      nameKey: 'app.ruby',
      class: 'potion',
      glyph: { ch: '!', fg: '#e00' },
    });
    api.defineAppearance({
      id: 'ob:blue',
      nameKey: 'app.blue',
      class: 'potion',
      glyph: { ch: '!', fg: '#00e' },
    });
    extra(api);
  },
});

export interface ItemOpts {
  pos?: { x: number; y: number; level?: string };
  carriedBy?: EntityId;
  letter?: string | null;
  equipped?: ItemComponent['equipped'];
  placed?: number;
  quantity?: number;
}

/** Adds an item entity directly to state. */
export function addItem(state: GameState, def: DefId, o: ItemOpts = {}): EntityId {
  const id = state.nextEntityId++;
  const item: ItemComponent = {
    quantity: o.quantity ?? 1,
    buc: 'uncursed',
    spe: 0,
    known: { buc: false, spe: false },
    carriedBy: o.carriedBy ?? null,
    letter: o.letter ?? null,
    equipped: o.equipped ?? null,
    placed: o.placed ?? 0,
  };
  state.entities[String(id)] = {
    id,
    def,
    c: {
      item,
      ...(o.pos
        ? { pos: { level: o.pos.level ?? state.currentLevel, x: o.pos.x, y: o.pos.y } }
        : {}),
    },
  };
  return id;
}

export const heroPos = (state: GameState): { x: number; y: number } => {
  const p = getPlayer(state).c.pos;
  if (!p) throw new Error('no hero pos');
  return { x: p.x, y: p.y };
};
