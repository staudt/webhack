# Kickoff: NetHack TypeScript port, milestone 2 (draft)

Milestone 2 adds monsters and melee combat, plus multi-level dungeons, which the stairs from milestone 1 are waiting for. Read `CLAUDE.md`, `docs/ARCHITECTURE.md` and `DEVIATIONS.md` first, then enter plan mode and propose a plan before writing any code.

The architecture rules in `CLAUDE.md` still apply unchanged.

## Milestone 2 scope

1. **Hero stats:**
    - Components `hp`, `attributes` (Str/Int/Wis/Dex/Con/Cha), `level`, `experience` and `alignment`.
    - Port role/race starting stats for the stub Valkyrie (ref: src/role.c, src/u_init.c, src/attrib.c).
    - Status line fields in `ViewSnapshot.status`.
2. **Monster definitions:**
    - `ModApi.defineMonster` with a `MonsterDef` ported from `struct permonst` (ref: include/permonst.h, src/monst.c): level, speed, AC, MR, alignment, attacks (`AT_*`/`AD_*`), size, flags, glyph and generation frequency.
    - `content` registers about 20 early-game monsters (newt, jackal, grid bug, sewer rat, kobold, gnome, …), each validated at load.
3. **Monster generation:**
    - `makemon` and `rndmonst` with difficulty by depth (ref: src/makemon.c).
    - The initial population is created in levelgen through a `newLevel` hook.
    - Periodic spawns use the 1/70 (or 1/50) end-of-turn roll (ref: src/allmain.c).
4. **Monster turns:**
    - Monsters are entities with `actor` energy; `mcalcmove` speed randomization (ref: src/mon.c).
    - The `dochug`/`m_move` basics: approach the hero if it can see you, otherwise wander (ref: src/monmove.c).
    - Grid bugs move orthogonally only.
    - Use the deterministic sorted-id actor order that already exists.
5. **Monster vision:** monsters notice the hero via line of sight; there's no stealth or invisibility yet.
6. **Melee combat:**
    - The hero attacks by moving into a monster (ref: src/uhitm.c `find_roll_to_hit`, `hmon`) using bare hands or a fixed starting weapon stat block (items arrive in M3).
    - Monster attacks come from `mattacku` for `AT_BITE`/`AT_CLAW`/`AT_TUCH`… with `AD_PHYS` only (ref: src/mhitu.c).
    - Death and experience (ref: src/exper.c), HP regeneration (ref: src/allmain.c `u_regen`).
7. **Hero death:**
    - A game-over prompt with a tombstone summary, using `Prompt`, which is first used in M2.
    - New game afterwards. No bones.
8. **Multi-level dungeon:**
    - `<` and `>` actions (ref: src/do.c `goto_level`).
    - Levels are generated lazily on arrival and kept in `state.levels`; memory is per level.
    - `ViewSnapshot` full resend on level change.
9. **Secret doors and search:**
    - Restore SDOOR/SCORR generation (remove those `DEVIATIONS.md` rows).
    - `dosearch0` with luck as 0 (ref: src/detect.c).
10. **Travel:**
    - A `travel` action that follows `query.pathTo`, stopping when a monster comes into view (ref: src/hack.c `findtravelpath`).
    - Tapping a distant remembered cell offers "Travel here".
11. **Messages:** every combat line is a key plus params (for example `combat.you_hit { target: '@nh:newt' }`), and the UI gains a "--More--"-free message queue that groups messages per turn.

Out of scope: items, inventory, armor and weapons as objects (M3); spells, prayer, shops, special levels and pets. Define interfaces only where M2 types need them (for example a `weapon` field reserved on attack resolution).

## Exit criteria

- On desktop and on a phone, I can fight early monsters, die, and start again; there is no keyboard requirement (attacks come from `actionsFor`).
- I can take stairs down and up and return to remembered levels.
- Replays with monsters reproduce the same hash, including through the worker path.
- The soak bot survives or dies cleanly for N turns with invariants checked, and a death ends the soak run without errors.
- `pnpm check` is green locally and in CI.

## Testing

- **Scenario builder:** `s.monster(def, pos)`, `s.expectHp(...)`, `s.expectDead(...)`, and seeding helpers to force hit/miss rolls.
- **Unit tests:**
    - to-hit and damage formulas against hand-computed NetHack values
    - `mcalcmove` distribution
    - `rndmonst` difficulty bounds by depth
    - `goto_level` memory and position
- **Property tests:**
    - monsters never share a cell or stand in walls
    - HP stays within [0, max] except for death handling
    - every generated level has a reachable down staircase
- **Soak bot:** attacks offered targets, takes stairs, and records deaths as outcomes, not failures.
- **Golden replay:** a fixed seed plus action list checked into the repo, whose hash may only change with a commit that explains why.

## Working agreements

Same as milestone 1. Port mechanics with `// ref:` citations, log every deviation, and run `pnpm check` before each commit.

## Carry-overs from milestone 1

- **Desktop zoom:** the default 16px cell size leaves the 80×21 map small on wide screens. Add fit-to-width zoom and pinch zoom on touch.
- **Vision:** port the dark-corridor door/wall hiding rule (see `DEVIATIONS.md`).
- **Door opening:** "door is stuck" failures need attributes from item 1.
- **CI:** confirm the GitHub Actions workflow is green once the repo has a remote.
