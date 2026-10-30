import {
  getPlayer,
  newMemory,
  type DefId,
  type GameState,
  type Level,
  type PlayerAction,
  type Pos,
} from '@nh/core';
import { T } from '../src/index';
import { ctxFor, engine, levelSetup, obj } from './itemHelpers';
import { mksobj } from '../src/index';

const CHARS: Record<string, DefId> = {
  ' ': T.stone,
  '|': T.vwall,
  '-': T.hwall,
  '.': T.floor,
  '+': T.door_closed,
  o: T.doorway,
  '#': T.corr,
  '>': T.stairs_down,
};

export interface MapOpts {
  /** 'all': the hero remembers every cell; 'none': only what she sees. Default 'all'. */
  memory?: 'all' | 'none';
  /** Extra cells to forget when memory is 'all'. */
  forget?: Pos[];
}

/**
 * A level from ASCII rows with the hero at '@'. Corridors ('#') are dark, everything else is lit.
 * Other entities are removed; one turn passes so vision is up to date.
 */
export function mapSetup(rows: string[], opts: MapOpts = {}) {
  const base = levelSetup(['.']);
  const { state } = base;
  const height = rows.length;
  const width = Math.max(...rows.map((r) => r.length));
  const palette: DefId[] = [T.stone];
  const cells: number[] = [];
  const lit: (0 | 1)[] = [];
  let start: Pos = { x: 0, y: 0 };
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let ch = rows[y]?.[x] ?? ' ';
      if (ch === '@') {
        start = { x, y };
        ch = '.';
      }
      const id = CHARS[ch] ?? T.stone;
      let i = palette.indexOf(id);
      if (i === -1) i = palette.push(id) - 1;
      cells.push(i);
      lit.push(ch === '#' ? 0 : 1);
    }
  const level: Level = {
    id: 'dlvl1',
    depth: 1,
    width,
    height,
    palette,
    cells,
    lit,
    rooms: [],
    up: null,
    down: null,
  };
  state.levels['dlvl1'] = level;
  const memory = newMemory(level);
  if ((opts.memory ?? 'all') === 'all') {
    for (let i = 0; i < cells.length; i++) memory[i] = cells[i] ?? 0;
    for (const p of opts.forget ?? []) memory[p.y * width + p.x] = -1;
  }
  state.memory['dlvl1'] = memory;
  const pos = getPlayer(state).c.pos;
  if (pos) Object.assign(pos, { x: start.x, y: start.y });
  const step = (a: PlayerAction) => engine.stepAll(state, a);
  step({ type: 'wait' });
  return { state, step, level, ctx: ctxFor(state) };
}

export const heroAt = (s: GameState): Pos => {
  const p = getPlayer(s).c.pos;
  return { x: p?.x ?? -1, y: p?.y ?? -1 };
};

/** Drops a plain object (a food ration) on the floor at x,y. */
export function dropAt(m: ReturnType<typeof mapSetup>, x: number, y: number): void {
  mksobj(m.ctx, obj('nh:food_ration'), { init: false, at: { level: 'dlvl1', x, y } });
}

/** Puts a sleeping hostile newt at x,y. */
export function newtAt(state: GameState, x: number, y: number, peaceful = false): number {
  const id = state.nextEntityId++;
  state.entities[String(id)] = {
    id,
    def: 'nh:newt',
    c: {
      pos: { level: 'dlvl1', x, y },
      actor: { energy: 0, speed: 6 },
      hp: { cur: 3, max: 3 },
      monster: { level: 0, peaceful, asleep: true, lastHero: null },
    },
  };
  return id;
}

export const travelTo = (x: number, y: number): PlayerAction => ({
  type: 'mod',
  action: 'nh:travel' as DefId,
  args: { x, y },
});
export const runDir = (dir: string, mode: string): PlayerAction => ({
  type: 'mod',
  action: 'nh:run' as DefId,
  args: { dir, mode },
});
