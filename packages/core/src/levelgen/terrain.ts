import type { DefId } from '../types/common';

/** One terrain def per structural cell kind the generator emits. Key order = palette order. */
export interface LevelTerrain {
  stone: DefId;
  vwall: DefId;
  hwall: DefId;
  tlcorn: DefId;
  trcorn: DefId;
  blcorn: DefId;
  brcorn: DefId;
  floor: DefId;
  corr: DefId;
  doorway: DefId;
  /** Open door set into a vertical (left/right) wall. */
  door_open_v: DefId;
  /** Open door set into a horizontal (top/bottom) wall. */
  door_open_h: DefId;
  door_closed: DefId;
  stairs_up: DefId;
  stairs_down: DefId;
  /** Secret door in a vertical wall; looks like a wall until found by searching. */
  sdoor_v: DefId;
  /** Secret door in a horizontal wall. */
  sdoor_h: DefId;
  /** Secret corridor; looks like stone until found by searching. */
  scorr: DefId;
  /** Locked door (ref: rm.h D_LOCKED). */
  door_locked: DefId;
  /** Locked secret doors: once found they become locked doors. */
  sdoor_locked_v: DefId;
  sdoor_locked_h: DefId;
}

export const VANILLA_TERRAIN: LevelTerrain = {
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
};

/** Palette order (indices into Level.palette). */
export const PALETTE_KEYS: readonly (keyof LevelTerrain)[] = [
  'stone',
  'vwall',
  'hwall',
  'tlcorn',
  'trcorn',
  'blcorn',
  'brcorn',
  'floor',
  'corr',
  'doorway',
  'door_open_v',
  'door_open_h',
  'door_closed',
  'stairs_up',
  'stairs_down',
  'sdoor_v',
  'sdoor_h',
  'scorr',
  'door_locked',
  'sdoor_locked_v',
  'sdoor_locked_h',
];

/** Palette indices by key, for readers of generated levels. */
export const PAL = {
  stone: 0,
  vwall: 1,
  hwall: 2,
  tlcorn: 3,
  trcorn: 4,
  blcorn: 5,
  brcorn: 6,
  floor: 7,
  corr: 8,
  doorway: 9,
  door_open_v: 10,
  door_open_h: 11,
  door_closed: 12,
  stairs_up: 13,
  stairs_down: 14,
  sdoor_v: 15,
  sdoor_h: 16,
  scorr: 17,
  door_locked: 18,
  sdoor_locked_v: 19,
  sdoor_locked_h: 20,
} as const;
