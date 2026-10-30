# CLAUDE.md

NetHack TypeScript port that plays like the original but is not an exact clone. It has a headless, deterministic core (`@nh/core`), swappable renderers, and two mod layers (game mods in the core, client mods in the UI). Mobile portrait and large scrollable maps are first-class targets. For contracts see `docs/ARCHITECTURE.md`; for the current milestone brief see `docs/kickoff-m1.md`.

## Rules

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

## Package boundaries

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
```

Allowed dependencies:

- `core` depends on nothing.
- `content` and `testkit` depend on `core`.
- `ui` and the renderers import types from `core` only.
- `app` may depend on everything.

Enforced by dependency-cruiser (`pnpm boundaries`). Run it after adding any import.

`vendor/nethack/` is a git submodule of github.com/NetHack/NetHack, used as reference only. Never import or compile it.

## Commands

- `pnpm dev`: Vite app. Use `pnpm dev --host` to reach it over LAN from a phone.
- `pnpm test`: Vitest unit, property and determinism tests.
- `pnpm lint`: ESLint flat config (includes the core/content global bans).
- `pnpm typecheck`: TypeScript strict across all packages.
- `pnpm boundaries`: dependency-cruiser package boundary check.
- `pnpm format`: Prettier.
- `pnpm check`: typecheck + lint + boundaries + tests with coverage. Must be green before a step is done, locally and in CI.

## Conventions

- Conventional Commits; small vertical steps; run `pnpm check` before committing.
- Port citations: `// ref: src/hack.c domove()` on every ported mechanic.
- Don't invent mechanics: check `vendor/nethack`, then NetHackWiki, then ask.
- Def ids are namespaced `mod:name` (vanilla uses `nh:`).
- Iterate entities via `sortedIds()`; never `for...in` in `core` or `content` (lint-banned).
- `engine.step(state, action)` mutates state in place; clone first if you need the old one.
- Messages: emit `{ type: 'msg', key, params }`; English text lives in `packages/content/src/messages.en.ts`.
- Don't change a public interface in `core` without explaining why.
- Log intentional rule differences in `DEVIATIONS.md`.
- Packages are source-only (`exports` point at `src/index.ts`); no library build step.
- Plan first for new milestones: show the file tree, key type signatures and order of work before writing code.

## Gotchas

- pnpm lives in `~/.local/share/pnpm/bin`; in non-login shells use `export PATH=$HOME/.local/share/pnpm/bin:$PATH`.
- `core` and `content` compile without DOM lib; any DOM/browser global is a type error there.
- TS has `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`: array reads are `T | undefined`, and optional props can't be assigned `undefined` explicitly.
- GameState must stay JSON-plain: no Map/Set/class instances/typed arrays.
