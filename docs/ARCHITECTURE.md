# Architecture

This document holds the contracts between packages. The type definitions live in `packages/core/src/types/`; this file explains them. If code and this file disagree, fix one of them in the same commit.

## Data flow

```
 ┌──────────── main thread ─────────────┐        ┌────────── Web Worker ──────────┐
 │ app ── ui (client mods, input, menus) │ ToCore │ host (core/host.ts)             │
 │   │      │                            │ ─────▶ │   engine = createEngine(mods)   │
 │   │      └─▶ Renderer (render-ascii)  │        │   state: GameState (private)    │
 │   │                                   │ ◀───── │   view diff, events, replies    │
 │   └─ storage (IndexedDB saves)        │FromCore│                                 │
 └───────────────────────────────────────┘        └─────────────────────────────────┘
```

- `GameState` exists only inside the worker. The UI sees a `ViewSnapshot` once, then `ViewDelta`s, plus `GameEvent[]`.
- The UI changes the game only by sending a `PlayerAction`. It reads only through `CoreQuery`, which is async across the worker boundary.
- `core/host.ts` is the whole protocol handler. It is pure (it takes a `post` callback), so tests drive it in Node; `app/src/worker.ts` is a thin shim around it.

## State

```ts
type EntityId = number;
type LevelId = string;
type DefId = `${string}:${string}`; // namespaced: "nh:floor"
interface Pos {
  x: number;
  y: number;
}
type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type RngState = [number, number, number, number]; // sfc32
interface ModRef {
  id: string;
  version: string;
}

interface GameState {
  version: 1;
  seed: number;
  turn: number;
  nextEntityId: number;
  seq: number; // monotonically increasing tiebreaker (timers etc.)
  rng: { core: RngState; cosmetic: RngState };
  mods: ModRef[]; // load order
  entities: Record<string, Entity>; // iterate via sortedIds(), never key order
  levels: Record<LevelId, Level>;
  currentLevel: LevelId;
  playerId: EntityId;
  memory: Record<LevelId, number[]>; // remembered palette index per cell, -1 = never seen
  visible: number[]; // sorted cell indices visible to the player now
  timers: Timer[]; // { at, seq, kind: DefId, data: Json }; sorted by (at, seq)
  modData: Record<string, Json>; // per-mod persistent data, keyed by mod id
}

interface Entity {
  id: EntityId;
  def: DefId;
  c: Components;
}
interface Components {
  pos?: { level: LevelId; x: number; y: number };
  actor?: { energy: number; speed: number }; // NORMAL_SPEED = 12
  player?: { role: DefId };
  // reserved for milestone 2: hp, monster, inventory, item
}

interface Room {
  lx: number;
  ly: number;
  hx: number;
  hy: number;
  lit: boolean;
} // interior bounds, inclusive
interface Level {
  id: LevelId;
  depth: number;
  width: number;
  height: number;
  palette: DefId[]; // terrain defs used on this level
  cells: number[]; // row-major (i = y * width + x), index into palette
  lit: (0 | 1)[];
  rooms: Room[];
  up: Pos | null;
  down: Pos | null;
}
```

The state is JSON-plain: saving is `JSON.stringify`, and `stateHash(state)` is a hash of canonical (key-sorted) JSON. The level size is a parameter, and 80×21 is only the default.

## Randomness

- `ctx.rng` (`state.rng.core`) drives every gameplay outcome. `ctx.cosmetic` (`state.rng.cosmetic`) is for flavour that never affects outcomes, so adding a cosmetic roll can't shift the gameplay stream.
- sfc32, seeded by splitmix32(seed), throws away its first 12 outputs. Helpers: `rn2(x)` ∈ [0, x), `rnd(x)` ∈ [1, x], `d(n, s)`. `Rng` is a thin wrapper that reads and writes the `RngState` array in place.
- `core` and `content` ban `Math.random`, `Date`, `performance`, `crypto` and `for…in` through lint.

## Actions, steps and turns

```ts
type Dir = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
type PlayerAction =
  | { type: 'move'; dir: Dir }
  | { type: 'wait' }
  | { type: 'search' }
  | { type: 'answer'; promptId: string; value: Json } // prompt reply (types only in M1)
  | { type: 'mod'; action: DefId; args?: Json }; // mod-defined action

interface StepResult {
  state: GameState;
  events: GameEvent[];
  prompt: Prompt | null;
}

type GameEvent =
  | { type: 'msg'; key: string; params?: Record<string, string | number> }
  | { type: 'moved'; id: EntityId; from: Pos; to: Pos }
  | { type: 'doorOpened'; pos: Pos }
  | { type: 'blocked'; pos: Pos; terrain: DefId }
  | { type: 'turnEnded'; turn: number }
  | { type: 'searched' }
  | { type: 'mod'; mod: string; name: string; data: Json };

interface Prompt {
  id: string;
  kind: 'yn' | 'direction' | 'menu';
  key: string;
  params?: Record<string, string | number>;
  options?: { value: Json; key: string }[];
}
```

`createEngine(mods: Mod[])` returns:

```ts
interface Engine {
  newGame(opts: { seed: number; width?: number; height?: number; role?: DefId }): GameState;
  step(state: GameState, action: PlayerAction): StepResult; // mutates state in place
  query(state: GameState): CoreQuery;
  save(state: GameState, replay: Replay): string;
  load(text: string): { state: GameState; replay: Replay };
}
```

Each step does the following (ref: src/allmain.c moveloop):

1. `beforeAction` hooks run, and any of them may cancel the action.
2. The action's `perform` runs and returns its energy cost. The default cost is 12, and a cost of 0 means no time passes (for example, bumping a wall).
3. `afterAction` hooks run.
4. While the player has less than 12 energy, the turn ends: `turn++`, due timers fire, `endOfTurn` hooks run, and every actor gains `speed` energy, in sorted id order.
5. Vision is recomputed and memory updated.

Messages are always keys plus params. English text lives in `content/src/messages.en.ts` and is loaded on the client side.

## Mods

```ts
interface Mod {
  id: string;
  version: string;
  dependsOn?: string[];
  register(api: ModApi): void;
}

interface TerrainDef {
  id: DefId;
  nameKey: string;
  passable: boolean;
  opaque: boolean;
  door?: 'closed' | 'open' | 'doorway';
  stairs?: 'up' | 'down';
  glyph: { ch: string; fg: string };
}
interface RoleDef {
  id: DefId;
  nameKey: string;
  speed: number;
  glyph: { ch: string; fg: string }; // the player entity's def is the role id
}
interface ActionDef {
  id: DefId;
  labelKey: string;
  offer(ctx: Ctx, target: Target): ActionOffer[]; // what this action contributes to actionsFor
  perform(ctx: Ctx, action: PlayerAction): number; // energy cost
  handles: PlayerAction['type']; // at most one handler per built-in type; mod actions use 'mod'
}

interface ModApi {
  defineTerrain(d: TerrainDef): void;
  defineRole(d: RoleDef): void;
  defineAction(d: ActionDef): void;
  on<K extends keyof Hooks>(hook: K, fn: Hooks[K], opts?: { priority?: number }): void;
}

interface Hooks {
  beforeAction(ctx: Ctx, a: PlayerAction): 'continue' | 'cancel';
  afterAction(ctx: Ctx, a: PlayerAction): void;
  endOfTurn(ctx: Ctx): void;
  newLevel(ctx: Ctx, level: Level): void;
}

interface Ctx {
  readonly state: GameState;
  rng: Rng;
  cosmetic: Rng;
  defs: Registry;
  emit(e: GameEvent): void;
  query: CoreQuery;
}
```

- Hooks run in a fixed order: priority descending, then mod load order, then registration order.
- The loader validates every definition and fails loudly with `ModLoadError { modId, defId?, path, reason }`. It rejects:
  - ids that aren't namespaced, or whose namespace isn't the registering mod's id
  - duplicate ids
  - missing references
  - unknown or cyclic `dependsOn`
  - unknown hook names
  - malformed fields
- **Vanilla gets no special access.** `@nh/content` exports `vanillaMod` (id `nh`), which registers terrain, the stub role, and the move, wait and search actions through `ModApi`.
- Game mods are recorded in saves as `ModRef[]`. Loading a save with a different mod list fails with a clear error.

## Queries

```ts
type Target = { kind: 'self' } | { kind: 'cell'; pos: Pos } | { kind: 'entity'; id: EntityId };
interface ActionOffer {
  action: PlayerAction;
  labelKey: string;
  params?: Record<string, string | number>;
  source: string;
}

interface CoreQuery {
  describe(pos: Pos): {
    terrain: DefId | null;
    remembered: boolean;
    visible: boolean;
    entities: { id: EntityId; def: DefId }[];
  };
  actionsFor(target: Target): ActionOffer[]; // the union of every ActionDef.offer, in registration order
  pathTo(pos: Pos): Pos[] | null; // A*, 8-dir, over remembered passable cells; excludes start
}
```

Queries only answer from what the player knows: memory and the currently visible cells. `actionsFor` is the single source of available actions. The UI's touch menus and the soak bot both use it, so no feature needs a keyboard.

## View boundary

```ts
interface ViewCell {
  g: DefId | null;
  v: boolean;
} // remembered terrain glyph key; visible now?
interface ViewEntity {
  id: EntityId;
  g: DefId;
  x: number;
  y: number;
}
interface ViewSnapshot {
  kind: 'full';
  levelId: LevelId;
  width: number;
  height: number;
  legend: Record<DefId, { ch: string; fg: string }>; // default glyphs from defs; client mods may override
  cells: ViewCell[];
  entities: ViewEntity[];
  player: { id: EntityId; x: number; y: number };
  turn: number;
  status: Record<string, string | number>;
}
interface ViewDelta {
  kind: 'delta';
  turn: number;
  cells: [index: number, cell: ViewCell][]; // only changed cells
  entities: ViewEntity[]; // full visible list (small)
  player: { id: EntityId; x: number; y: number };
  status: Record<string, string | number>;
}

interface Renderer {
  mount(el: HTMLElement): void;
  apply(v: ViewSnapshot | ViewDelta): void;
  setGlyph(id: DefId, glyph: { ch: string; fg: string }): void;
  cellAt(clientX: number, clientY: number): Pos | null;
  resize(): void;
  destroy(): void;
}
```

Renderers draw only the cells inside the camera. The camera follows the player with a dead zone, so levels of any size scroll.

## Client mods

```ts
type UiCommand = { type: 'action'; action: PlayerAction } | { type: 'ui'; id: string };
interface ClientMod {
  id: string;
  version: string;
  register(api: ClientApi): void;
}
interface ClientApi {
  bindKey(key: string, cmd: UiCommand): void; // key = KeyboardEvent.key or .code
  addMessages(locale: string, catalog: Record<string, string>): void;
  setGlyph(id: DefId, glyph: { ch: string; fg: string }): void;
  onEvent(fn: (e: GameEvent) => void): void;
  addMenuItem(item: { id: string; labelKey: string; run(): void }): void;
}
```

Client mods run in the UI and are never saved. The default keymap is itself a client mod.

## Worker protocol

```ts
type ToCore =
  | { t: 'new'; seed: number; width: number; height: number }
  | { t: 'load'; save: string }
  | { t: 'act'; action: PlayerAction }
  | { t: 'query'; id: number; q: keyof CoreQuery; args: Json[] }
  | { t: 'save' }
  | { t: 'hash' };
type FromCore =
  | { t: 'view'; view: ViewSnapshot | ViewDelta; events: GameEvent[]; prompt: Prompt | null }
  | { t: 'reply'; id: number; result: Json }
  | { t: 'saved'; save: string }
  | { t: 'hash'; hash: string }
  | { t: 'error'; message: string };

interface Replay {
  seed: number;
  width: number;
  height: number;
  mods: ModRef[];
  actions: PlayerAction[];
}
// Save text = JSON.stringify({ format: 'nh-ts', version: 1, mods, state, replay })
```

After `new` or `load`, the host sends a full snapshot. After each `act`, it sends a delta. Every action is appended to the replay, and replaying `{ seed, width, height, mods, actions }` must reproduce `stateHash`.

## Package boundaries

| Package                                    | May depend on                             |
| ------------------------------------------ | ----------------------------------------- |
| core                                       | nothing                                   |
| content, testkit                           | core (testkit tests may also use content) |
| ui, render-ascii, render-canvas, modern-ui | core, `import type` only                  |
| app                                        | everything                                |

`vendor/nethack` is reference only. dependency-cruiser enforces this table (`pnpm boundaries`).
