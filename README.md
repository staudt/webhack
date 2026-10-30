# webhack

A TypeScript port of NetHack. It plays like the same game but is not an exact clone.

- Headless, deterministic core (`@nh/core`) with no runtime dependencies.
- Swappable renderers.
- Game mods (recorded in saves) and client mods (presentation only).
- Mobile portrait is a first-class target.

## Running

```sh
pnpm install
pnpm dev            # open the printed URL
pnpm dev --host     # play from a phone on the LAN
pnpm check          # typecheck, lint, boundaries and tests
```

## Repo layout

- `packages/core`: state, step loop, actions, events, hooks, queries, RNG, save format
- `packages/content`: vanilla definitions and behaviors, registered as a game mod
- `packages/ui`: client mod host (input, keymaps, menus, panels, message log)
- `packages/render-ascii`: default Canvas 2D glyph renderer
- `packages/render-canvas`: stub for a future UTF-8 and sprite renderer
- `packages/modern-ui`: stub for future client mods
- `packages/testkit`: scenario builder, replay runner, state hash, soak bot
- `packages/app`: Vite app (worker wiring, renderer, mod loading, save storage)
- `vendor/nethack`: NetHack source, reference only (git submodule)
- `docs/`: architecture and design notes

## License

Distributed under the NetHack General Public License (see [LICENSE](LICENSE)).

NetHack is copyright the NetHack DevTeam (Stichting Mathematisch Centrum and M. Stephenson). This project is derived from and credits the NetHack DevTeam.

## Cloning

```sh
git clone --recurse-submodules <repo-url>
```

The submodule is optional. It is only used as a reference.
