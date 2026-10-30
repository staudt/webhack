import type { Level } from '../types/level';

/** Glyph per palette index (see PAL in terrain.ts). Open doors follow NetHack: a door in a vertical wall shows '-'. */
const GLYPHS = ' |-----.#.-|+<>';

/** Render a generated level as ASCII, one row per line. For tests and debugging. */
export function levelToAscii(level: Level): string {
  const rows: string[] = [];
  for (let y = 0; y < level.height; y++) {
    let row = '';
    for (let x = 0; x < level.width; x++) {
      row += GLYPHS.charAt(level.cells[y * level.width + x] ?? 0);
    }
    rows.push(row);
  }
  return rows.join('\n');
}
