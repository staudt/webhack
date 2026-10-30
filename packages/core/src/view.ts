import { getLevel, getPlayer } from './state';
import type { DefId, Glyph } from './types/common';
import type { Registry } from './types/mod';
import type { GameState } from './types/state';
import type { ViewCell, ViewDelta, ViewEntity, ViewSnapshot, ViewUpdate } from './types/view';
import { sortedIds } from './util';

/** Builds the full player-facing view of the game. Never exposes unseen state. */
export function buildSnapshot(registry: Registry, state: GameState): ViewSnapshot {
  const level = getLevel(state);
  const player = getPlayer(state);
  const pos = player.c.pos;
  if (!pos) throw new Error('Player has no position');

  const glyphs: [DefId, Glyph][] = [
    ...registry.terrains.map((t): [DefId, Glyph] => [t.id, t.glyph]),
    ...registry.roles.map((r): [DefId, Glyph] => [r.id, r.glyph]),
  ];
  glyphs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const legend: Record<DefId, Glyph> = {};
  for (const [id, g] of glyphs) legend[id] = { ch: g.ch, fg: g.fg };

  const memory = state.memory[level.id];
  const visible = state.visible;
  const n = level.width * level.height;
  const cells: ViewCell[] = new Array<ViewCell>(n);
  let vp = 0;
  for (let i = 0; i < n; i++) {
    while (vp < visible.length && (visible[vp] as number) < i) vp++;
    const v = vp < visible.length && visible[vp] === i;
    const m = memory?.[i] ?? -1;
    cells[i] = { g: m >= 0 ? (level.palette[m] ?? null) : null, v };
  }

  const isVis = new Set(visible);
  const entities: ViewEntity[] = [];
  for (const id of sortedIds(state)) {
    const e = state.entities[String(id)];
    const p = e?.c.pos;
    if (!e || !p || p.level !== level.id) continue;
    if (e.id !== state.playerId && !isVis.has(p.y * level.width + p.x)) continue;
    entities.push({ id: e.id, g: e.def, x: p.x, y: p.y });
  }

  return {
    kind: 'full',
    levelId: level.id,
    width: level.width,
    height: level.height,
    legend,
    cells,
    entities,
    player: { id: player.id, x: pos.x, y: pos.y },
    turn: state.turn,
    status: { dlvl: level.depth, turn: state.turn },
  };
}

/** A delta when the level shape is unchanged, otherwise the full snapshot. */
export function diffSnapshot(prev: ViewSnapshot, next: ViewSnapshot): ViewUpdate {
  if (prev.levelId !== next.levelId || prev.width !== next.width || prev.height !== next.height)
    return next;
  const cells: [number, ViewCell][] = [];
  for (let i = 0; i < next.cells.length; i++) {
    const a = prev.cells[i] as ViewCell;
    const b = next.cells[i] as ViewCell;
    if (a.g !== b.g || a.v !== b.v) cells.push([i, { g: b.g, v: b.v }]);
  }
  const delta: ViewDelta = {
    kind: 'delta',
    turn: next.turn,
    cells,
    entities: next.entities,
    player: next.player,
    status: next.status,
  };
  return delta;
}

/** Pure: returns a new snapshot; does not mutate `prev`. */
export function applyUpdate(prev: ViewSnapshot | null, u: ViewUpdate): ViewSnapshot {
  if (u.kind === 'full') return u;
  if (!prev) throw new Error('Cannot apply a delta without a previous snapshot');
  const cells = prev.cells.slice();
  for (const [i, c] of u.cells) cells[i] = { g: c.g, v: c.v };
  return { ...prev, cells, entities: u.entities, player: u.player, status: u.status, turn: u.turn };
}
