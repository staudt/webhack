# Kickoff: NetHack TypeScript port, milestone 4 (draft)

Milestone 4 makes the early dungeon feel like NetHack: elemental damage and resistances, doors you can kick, smarter monsters, and the display fixes left over from M2. Read `CLAUDE.md`, `docs/ARCHITECTURE.md` and `DEVIATIONS.md` first, then enter plan mode and propose a plan before writing any code.

The architecture rules in `CLAUDE.md` still apply unchanged.

## Milestone 4 scope

1. **Damage types and resistances:**
    - Port AD_ELEC, AD_FIRE, AD_COLD, AD_SLEE, AD_DRST (poison) and AD_ACID for monster attacks (ref: src/mhitu.c hitmu()), plus the resistance fields of `MonsterDef` (mresists, mconveys).
    - Hero intrinsics as data: the Valkyrie's cold resistance and stealth at start, and speed at XL 7 (ref: src/attrib.c val_abil).
    - Corpse intrinsics from eating (ref: src/eat.c cpostfx(), givit()), replacing the M3 "no intrinsics from corpses" deviation.
    - Re-add the grid bug, and add a handful of early monsters that use these attacks (check include/monsters.h for difficulty 1 to 5: yellow mold, lichen, floating eye, acid blob, ...).
2. **Doors:** locked doors from level generation (ref: src/mklev.c dodoor()), `#force`-free kicking (ref: src/dokick.c dokick() for doors and objects), and the "This door is locked." message. Remove the locked-doors DEVIATIONS row.
3. **Monster behavior:**
    - Fleeing on low HP (ref: src/monmove.c monflee(), distfleeck()).
    - Monster ranged attacks: throwing daggers and darts, firing arrows from launchers (ref: src/mthrowu.c). This lets monsters keep the launchers and ammo M3 skipped, so add darts, arrows, bows, crossbows and slings to the object table.
    - Peaceful monster handling (ref: src/uhitm.c attack_checks(): "Really attack the X?").
4. **Vision and display:**
    - The dark-corridor door rule.
    - Remembered monster glyphs, as NetHack shows the last seen position until you look again (ref: src/display.c).
    - Fit-to-width zoom and pinch zoom on phones.
5. **Item follow-ups from M3:**
    - Count prefixes for pick-up and drop ("take 3 of 10 daggers").
    - Naming object types (`#name` / call).
    - The alternate weapon and `x` to swap.
    - A compass-style direction picker on phones instead of the 8-option menu.
    - Decide with the player whether stepping onto a 2-4 item pile should open the "Things that are here" sheet (NetHack's behavior) or just log the items.
6. **Skills:** training by use and `#enhance` (ref: src/weapon.c use_skill(), enhance_weapon_skill()). Remove the fixed-skills deviation.

Out of scope: shops, pets, spellcasting, wands, rings, amulets, tools, containers, traps beyond what kicking needs.

## Exit criteria

- Monsters with elemental attacks exist and resistances work both ways.
- I can kick open a locked door on a phone without a keyboard.
- Monsters flee when hurt and some throw or fire missiles.
- Monster glyphs stay remembered where I last saw them.
- The map can be zoomed to fit the screen width on a phone.
- Replays and the golden test are deterministic (with an explained golden update).
- `pnpm check` is green locally and in CI.

## Testing

- Unit tests for every damage type and resistance, `monflee`, kicking odds, and missile flight.
- Scenario tests: a floating eye paralyzing the hero, a locked door kicked open, a monster fleeing and returning.
- The soak bot kicks locked doors and fights ranged monsters; new invariants for intrinsics as plain data.

## Carry-overs from milestone 3

- **CI:** confirm the workflow once a remote exists.
- **`UiCommand` arguments:** the UI encodes picker arguments in the command id (`pick:nh:drop`). Consider a `params` field.
- **Double tap to run:** on a real phone the double tap makes no visible difference (single taps already push toward the tap until something interrupts, which the player likes). Check whether the gesture fires at all on touch devices (tap timing, `click` vs touch events) before deciding to keep, fix or drop it.
- **`ctx.interrupt()` reasons:** eating needs content-side `stopOccupation` to print "You stop eating". Consider passing a reason.
