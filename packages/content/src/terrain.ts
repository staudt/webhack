// ref: include/defsym.h PCHAR2 entries (cmap symbols); default chars and colors match NetHack.
import type { TerrainDef } from '@nh/core';

const GRAY = '#aaaaaa';
const BROWN = '#aa5500';
const BLACK = '#000000';

export const TERRAIN: readonly TerrainDef[] = [
  // ref: defsym.h S_stone ' ' (NO_COLOR)
  {
    id: 'nh:stone',
    nameKey: 'terrain.stone',
    passable: false,
    opaque: true,
    glyph: { ch: ' ', fg: BLACK },
  },
  // ref: defsym.h S_vwall '|', S_hwall '-', S_tlcorn/S_trcorn/S_blcorn/S_brcorn '-'
  {
    id: 'nh:vwall',
    nameKey: 'terrain.wall',
    passable: false,
    opaque: true,
    glyph: { ch: '|', fg: GRAY },
  },
  {
    id: 'nh:hwall',
    nameKey: 'terrain.wall',
    passable: false,
    opaque: true,
    glyph: { ch: '-', fg: GRAY },
  },
  {
    id: 'nh:tlcorn',
    nameKey: 'terrain.wall',
    passable: false,
    opaque: true,
    glyph: { ch: '-', fg: GRAY },
  },
  {
    id: 'nh:trcorn',
    nameKey: 'terrain.wall',
    passable: false,
    opaque: true,
    glyph: { ch: '-', fg: GRAY },
  },
  {
    id: 'nh:blcorn',
    nameKey: 'terrain.wall',
    passable: false,
    opaque: true,
    glyph: { ch: '-', fg: GRAY },
  },
  {
    id: 'nh:brcorn',
    nameKey: 'terrain.wall',
    passable: false,
    opaque: true,
    glyph: { ch: '-', fg: GRAY },
  },
  // ref: defsym.h S_room '.' (CLR_GRAY)
  {
    id: 'nh:floor',
    nameKey: 'terrain.floor',
    passable: true,
    opaque: false,
    glyph: { ch: '.', fg: GRAY },
  },
  // ref: defsym.h S_corr '#' (CLR_GRAY)
  {
    id: 'nh:corr',
    nameKey: 'terrain.corr',
    passable: true,
    opaque: false,
    glyph: { ch: '#', fg: GRAY },
  },
  // ref: defsym.h S_ndoor '.' (CLR_GRAY), "doorway"
  {
    id: 'nh:doorway',
    nameKey: 'terrain.doorway',
    passable: true,
    opaque: false,
    door: 'doorway',
    glyph: { ch: '.', fg: GRAY },
  },
  // ref: defsym.h S_vodoor '-' (open door in vertical wall), S_hodoor '|' (horizontal wall), CLR_BROWN
  {
    id: 'nh:door_open_v',
    nameKey: 'terrain.door_open',
    passable: true,
    opaque: false,
    door: 'open',
    glyph: { ch: '-', fg: BROWN },
  },
  {
    id: 'nh:door_open_h',
    nameKey: 'terrain.door_open',
    passable: true,
    opaque: false,
    door: 'open',
    glyph: { ch: '|', fg: BROWN },
  },
  // ref: defsym.h S_vcdoor/S_hcdoor '+' (CLR_BROWN)
  {
    id: 'nh:door_closed',
    nameKey: 'terrain.door_closed',
    passable: false,
    opaque: true,
    door: 'closed',
    glyph: { ch: '+', fg: BROWN },
  },
  // A locked door looks like any closed door (ref: defsym.h S_vcdoor/S_hcdoor, rm.h D_LOCKED).
  {
    id: 'nh:door_locked',
    nameKey: 'terrain.door_closed',
    passable: false,
    opaque: true,
    door: 'locked',
    glyph: { ch: '+', fg: BROWN },
    looksLike: 'nh:door_closed',
  },
  // ref: defsym.h S_upstair '<' (CLR_GRAY)
  {
    id: 'nh:stairs_up',
    nameKey: 'terrain.stairs_up',
    passable: true,
    opaque: false,
    stairs: 'up',
    glyph: { ch: '<', fg: GRAY },
  },
  // ref: defsym.h S_dnstair '>' (CLR_GRAY)
  {
    id: 'nh:stairs_down',
    nameKey: 'terrain.stairs_down',
    passable: true,
    opaque: false,
    stairs: 'down',
    glyph: { ch: '>', fg: GRAY },
  },
  // Secret doors and corridors look like what they hide (ref: defsym.h S_vwall/S_hwall/S_stone).
  {
    id: 'nh:sdoor_v',
    nameKey: 'terrain.wall',
    passable: false,
    opaque: true,
    glyph: { ch: '|', fg: GRAY },
    looksLike: 'nh:vwall',
  },
  {
    id: 'nh:sdoor_h',
    nameKey: 'terrain.wall',
    passable: false,
    opaque: true,
    glyph: { ch: '-', fg: GRAY },
    looksLike: 'nh:hwall',
  },
  // Locked secret doors (ref: mklev.c dosdoor() SDOOR branch, doormask D_LOCKED).
  {
    id: 'nh:sdoor_locked_v',
    nameKey: 'terrain.wall',
    passable: false,
    opaque: true,
    glyph: { ch: '|', fg: GRAY },
    looksLike: 'nh:vwall',
  },
  {
    id: 'nh:sdoor_locked_h',
    nameKey: 'terrain.wall',
    passable: false,
    opaque: true,
    glyph: { ch: '-', fg: GRAY },
    looksLike: 'nh:hwall',
  },
  {
    id: 'nh:scorr',
    nameKey: 'terrain.stone',
    passable: false,
    opaque: true,
    glyph: { ch: ' ', fg: BLACK },
    looksLike: 'nh:stone',
  },
];

/** Short names for terrain ids, for convenient reuse. */
export const T = {
  stone: 'nh:stone',
  vwall: 'nh:vwall',
  hwall: 'nh:hwall',
  tlcorn: 'nh:tlcorn',
  trcorn: 'nh:trcorn',
  blcorn: 'nh:blcorn',
  brcorn: 'nh:brcorn',
  floor: 'nh:floor',
  corr: 'nh:corr',
  doorway: 'nh:doorway',
  door_open_v: 'nh:door_open_v',
  door_open_h: 'nh:door_open_h',
  door_closed: 'nh:door_closed',
  stairs_up: 'nh:stairs_up',
  stairs_down: 'nh:stairs_down',
  sdoor_v: 'nh:sdoor_v',
  sdoor_h: 'nh:sdoor_h',
  scorr: 'nh:scorr',
  door_locked: 'nh:door_locked',
  sdoor_locked_v: 'nh:sdoor_locked_v',
  sdoor_locked_h: 'nh:sdoor_locked_h',
} as const;
