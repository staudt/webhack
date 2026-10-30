import type { ClientMod, PlayerAction } from '@nh/core';
import { messagesEn } from '@nh/content';
import { createAsciiRenderer } from '@nh/render-ascii';
import { createUi, defaultKeymap } from '@nh/ui';
import { extendedCommands, runPrefixes, runKeys, vanillaKeys } from './keys';
import { parseParams } from './params';
import { createRemote, type Remote } from './remote';
import { clearSave, loadSave, writeSave } from './storage';

const AUTOSAVE_EVERY = 25;

const randomSeed = (): number => crypto.getRandomValues(new Uint32Array(1))[0] ?? 1;
const params = parseParams(location.search, randomSeed);

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
const remote: Remote = createRemote({
  postMessage: (m) => worker.postMessage(m),
  addEventListener: (t, fn) => worker.addEventListener(t, fn),
});

let size = { w: params.width, h: params.height };
let started = false;
let acts = 0;
let dead = false;
let loading = false;

function startNew(): void {
  dead = false;
  loading = false;
  acts = 0;
  started = true;
  remote.newGame(randomSeed(), size.w, size.h);
}

function loadText(text: string): void {
  loading = true;
  remote.load(text);
}

// Count acts so we can autosave without blocking the UI.
const rawAct = remote.act.bind(remote);
remote.act = (action: PlayerAction) => {
  rawAct(action);
  if (++acts % AUTOSAVE_EVERY === 0) void saveNow();
};

async function saveNow(): Promise<boolean> {
  if (!started || dead) return false;
  try {
    await writeSave(await remote.save());
    return true;
  } catch {
    return false;
  }
}

const appMenuMod: ClientMod = {
  id: 'app',
  version: '0.1.0',
  register(api) {
    api.addMenuItem({
      id: 'app.new',
      labelKey: 'ui.newgame',
      run: () => {
        void clearSave().then(startNew);
      },
    });
    api.addMenuItem({
      id: 'app.save',
      labelKey: 'ui.save',
      run: () => {
        void saveNow().then((ok) => {
          if (ok) ui.notify('ui.saved');
        });
      },
    });
    api.addMenuItem({
      id: 'app.load',
      labelKey: 'ui.load',
      run: () => {
        void loadSave().then((text) => {
          if (text === null) ui.notify('ui.nosave');
          else {
            loadText(text);
          }
        });
      },
    });
  },
};

const root = document.getElementById('app');
if (!root) throw new Error('missing #app');

const ui = createUi({
  root,
  renderer: createAsciiRenderer(),
  game: remote,
  mods: [defaultKeymap, vanillaKeys, runKeys, appMenuMod, extendedCommands(remote)],
  ...runPrefixes,
  onNewGame: () => void clearSave().then(startNew),
});
ui.api.addMessages('en', messagesEn);

remote.onView((m) => {
  if (loading) {
    loading = false;
    ui.notify('ui.loaded');
  }
  if (m.view.status['dead'] !== undefined && !dead) {
    // NetHack deletes the save on death; stop autosaving.
    dead = true;
    void clearSave();
  }
  if (m.view.kind === 'full') size = { w: m.view.width, h: m.view.height };
  ui.update(m.view, m.events, m.prompt, m.continuing);
});
remote.onError((e) => {
  if (loading) {
    // The save could not be restored (e.g. an older save version).
    ui.notify('ui.save_incompatible');
    void clearSave().then(startNew);
    return;
  }
  ui.notify('ui.error', { message: e });
});

const flush = (): void => void saveNow();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush();
});
addEventListener('pagehide', flush);

async function boot(): Promise<void> {
  if (!params.forceNew && !params.explicit) {
    const text = await loadSave();
    if (text !== null) {
      started = true;
      loadText(text);
      return;
    }
  }
  started = true;
  if (params.forceNew) await clearSave();
  remote.newGame(params.seed, params.width, params.height);
}

void boot();

(window as unknown as { webhack: unknown }).webhack = {
  hash: () => remote.hash(),
  save: () => remote.save(),
  remote,
};
