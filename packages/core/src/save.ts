import type { ModRef } from './types/common';
import type { Registry } from './types/mod';
import type { Replay, SaveFile } from './types/protocol';
import type { GameState } from './types/state';

export const SAVE_FORMAT = 'nh-ts';
export const SAVE_VERSION = 2 as const;

export function serializeSave(state: GameState, replay: Replay): string {
  const file: SaveFile = {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    mods: state.mods,
    state,
    replay,
  };
  return JSON.stringify(file);
}

const modList = (mods: readonly ModRef[]): string =>
  mods.map((m) => `${m.id}@${m.version}`).join(', ') || '(none)';

/** Parses a save and checks that it was made with exactly the loaded game mods. */
export function parseSave(text: string, registry: Registry): { state: GameState; replay: Replay } {
  let file: Partial<SaveFile>;
  try {
    file = JSON.parse(text) as Partial<SaveFile>;
  } catch (e) {
    throw new Error(`Save is not valid JSON: ${e instanceof Error ? e.message : String(e)}`, {
      cause: e,
    });
  }
  if (typeof file !== 'object' || file === null || file.format !== SAVE_FORMAT)
    throw new Error(`Not a ${SAVE_FORMAT} save file`);
  if (file.version !== SAVE_VERSION)
    throw new Error(`Unsupported save version ${String(file.version)} (expected ${SAVE_VERSION})`);
  if (!file.state || !file.replay || !Array.isArray(file.mods))
    throw new Error('Save file is missing state, replay or mods');
  const saved = modList(file.mods);
  const loaded = modList(registry.mods);
  if (saved !== loaded)
    throw new Error(`Save was made with mods [${saved}] but the game has [${loaded}] loaded`);
  return { state: file.state, replay: file.replay };
}
