# Kickoff: NetHack TypeScript port, milestone 1

You're starting a new project: a TypeScript port of NetHack that plays like the same game but is not an exact clone. It has a headless, deterministic core, swappable renderers, and two mod layers (game mods and client mods). Mobile portrait and large scrollable maps are first-class targets.

Read this whole prompt and `docs/ARCHITECTURE.md` first. If `docs/ARCHITECTURE.md` is missing, stop and ask me for it. Then enter plan mode and propose a plan before writing any code.

## Non-negotiable architecture rules

Copy these into `CLAUDE.md` as the project rules. Follow them in every session.

1. **Headless core.** `@nh/core` has zero runtime dependencies and never touches DOM, `window` or browser APIs. It must run in Node and in a Web Worker.
2. **Determinism.** All randomness comes from the seeded RNG stored in state (`ctx.rng`). `Math.random`, `Date`, `performance.now` and `crypto` are banned in `core` and `content`. Never let object key order affect outcomes; iterate sorted arrays.
3. **Plain data state.** `GameState` is JSON-serializable: no class instances, `Map`, `Set`, functions or typed arrays. Saving is `JSON.stringify` plus a version header.
4. **View boundary.** Renderers and UI never read `GameState`. They receive a `ViewSnapshot` (full on first send, then deltas) and `GameEvent[]`. They send `PlayerAction`s and call the read-only `CoreQuery` API.
5. **Two mod layers.**
    - Game mods run in the core, must be deterministic, and are recorded in saves.
    - Client mods run in the UI and only change presentation, input and menus. They are never saved.
    - Vanilla content registers through the public `ModApi` exactly like a third-party mod. No private back doors.
6. **Discoverable actions.** Every action, including mod-defined ones, must be returned by `query.actionsFor(target)`. No feature may require a keyboard.
7. **No fixed map size.** 80 x 21 is only the vanilla default; any size must work.
8. **Messages are keys plus params**, never hardcoded English strings in game logic.
9. **Log deviations.** Every intentional rule difference from NetHack goes in `DEVIATIONS.md`.
10. **License.** The project is under the NetHack General Public License (NGPL). Dependencies must be permissive only (MIT, BSD, ISC, Apache-2.0). No GPL dependencies.

## Stack

- pnpm workspaces, Node LTS.
- TypeScript strict, plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- Vite for the app, Vitest for tests, fast-check for property tests.
- ESLint flat config and Prettier.
- dependency-cruiser to enforce package boundaries.
- GitHub Actions CI running typecheck, lint, boundaries and tests.

## Repo layout

```
packages/
  core/           state, step loop, actions, events, hooks, queries, RNG, save format
  content/        vanilla definitions and behaviors, registered as a game mod
  ui/             client mod host: input, keymaps, menus, panels, message log
  render-ascii/   default renderer (Canvas 2D glyph grid with camera)
  render-canvas/  stub for now (future UTF-8 and sprite renderer)
  modern-ui/      stub for now (future client mods)
  testkit/        scenario builder, replay runner, state hash, soak bot
  app/            Vite app: worker wiring, renderer, mod loading, save storage
vendor/nethack/   git submodule of github.com/NetHack/NetHack (reference only)
docs/             ARCHITECTURE.md and future design notes
```

Allowed dependencies between packages:

- `core` depends on nothing.
- `content` and `testkit` depend on `core`.
- `ui` and the renderers import types from `core` only.
- `app` may depend on everything.

Enforce these rules with dependency-cruiser. `vendor/nethack` is reference material only: never import or compile it.

## Milestone 1 scope

Build these, following the contracts in `docs/ARCHITECTURE.md`:

1. **Core types:** `GameState`, `Entity`, `Components`, `Level`, `PlayerAction`, `StepResult`, `GameEvent`, `ViewSnapshot` and `ViewDelta`, `Prompt`, `Hooks`, `Mod` and `ModApi`, `ClientMod` and `ClientApi`, and `CoreQuery`.
2. **RNG:** sfc32 or xoshiro128 with serializable state. Helpers `rn2`, `rnd` and `d(n, s)`, plus a separate cosmetic stream for display-only randomness.
3. **Turn loop:** a movement-point energy system where actions cost 12 points by default. Add an end-of-turn hook and an empty timer queue.
4. **Mod loader:**
    - Register definitions and prioritized hooks.
    - Validate definitions at load and fail loudly with clear errors.
    - `content` registers terrain definitions and a stub player role through `ModApi`.
5. **Level generator:**
    - Seeded rooms-and-corridors, with width and height as parameters.
    - Doors plus up and down stairs.
    - All rooms connected.
6. **Vision and memory:** FOV (recursive shadowcasting is fine), with player map memory stored separately from the true map.
7. **Core API:**
    - `step(state, action)` handling move, wait and search.
    - `query.describe(pos)`.
    - `query.actionsFor(target)`.
    - `query.pathTo(pos)` using A*.
8. **Worker boundary:**
    - The app runs the core in a Web Worker behind a typed message protocol.
    - The worker sends a full snapshot first, then deltas with only changed cells.
9. **Renderer and input:**
    - Canvas 2D ASCII renderer that draws only the cells inside the camera.
    - Camera follows the player with a dead zone and scrolls when the level is bigger than the screen.
    - Works in mobile portrait: viewport meta tag, resize handling, crisp rendering on high-DPI screens.
    - Input through the UI host: arrows, vi-keys and numpad, plus tapping an adjacent tile to move.
10. **Persistence:**
    - Save and load in the app layer (IndexedDB), outside the core.
    - Replay from `{ seed, mods, actions }`.

Out of scope: monsters, combat and items, which start in milestone 2. Define their interfaces only where the types above need them.

## Exit criteria

- I can walk around a generated level in the browser on desktop and on a phone in portrait.
- I can save, reload and continue.
- A replay produces an identical state hash.
- A 200 x 200 test level scrolls smoothly on a phone.
- `pnpm check` (typecheck, lint, boundaries, tests) is green locally and in CI.

## Testing

I'm an SDET, so treat tests as first-class work rather than an afterthought.

- **`@nh/testkit`:**
    - Scenario builder: `scenario(name, s => { s.level(...); s.player(...); s.act(...); s.expectEvent(...) })`.
    - Replay runner and a stable state hash.
- **Unit tests:**
    - RNG known sequences and serialization round-trip.
    - FOV cases.
    - `pathTo`.
    - Save round-trip.
- **Property tests:**
    - Level generator invariants for many seeds and sizes: all rooms connected, stairs reachable, nothing out of bounds.
- **Determinism test:** run the same seed and actions twice, and once through the worker message path. All hashes must match.
- **Soak bot:**
    - Random legal actions, taken from `actionsFor()`, for N turns per test run.
    - Check invariants every turn: entities in bounds, no entity in two places, state still serializable.
- **Lint bans:** use ESLint `no-restricted-globals` and `no-restricted-properties` to enforce rule 2 in `core` and `content`.
- **Coverage threshold** on `core`.

## Working agreements

- **Plan first.** In plan mode, show the file tree, key type signatures and the order of work. Wait for my approval before writing code.
- **Small steps.** Work in small vertical steps. After each step, run typecheck, lint and tests, then commit using Conventional Commits.
- **Public interfaces.** Don't change a public interface in `core` without telling me why.
- **Cite the source.** When porting a mechanic, add a comment pointing to the original: `// ref: src/hack.c domove()`.
- **Don't invent mechanics.** If NetHack behavior is unclear, check `vendor/nethack` first, then NetHackWiki. If it's still unclear, ask me.
- **Keep `CLAUDE.md` short and current:** rules, commands, conventions and gotchas, under about 150 lines.
- **Before saying a step is done,** run the full `pnpm check` and fix anything red.

## Files to create first

- `CLAUDE.md`: rules above, commands (`pnpm dev`, `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm check`), conventions.
- `DEVIATIONS.md`: empty table with columns Area, NetHack behavior, Our behavior, Reason.
- `LICENSE`: the NetHack General Public License, copied from the license file in the vendored NetHack source.
- `README.md`: what this is, how to run, NGPL notice and credit to the NetHack DevTeam.

## When you finish milestone 1

Give me:

- A short summary of what was built.
- How to run it on desktop and on a phone over the LAN (`vite --host`).
- What's stubbed.
- A proposed milestone 2 plan (combat and monsters) in the same format as this prompt.
