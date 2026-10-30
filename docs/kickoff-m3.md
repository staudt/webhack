# Kickoff: NetHack TypeScript port, milestone 3 (draft)

Milestone 3 adds objects: inventory, the real starting kit, and hunger. It replaces the M2 fixed starting-gear stat block with real items. Read `CLAUDE.md`, `docs/ARCHITECTURE.md` and `DEVIATIONS.md` first, then enter plan mode and propose a plan before writing any code.

The architecture rules in `CLAUDE.md` still apply unchanged.

## Milestone 3 scope

1. **Object definitions:**
    - `ModApi.defineObject` with an `ObjectDef` ported from `struct objclass` (ref: include/objclass.h, include/objects.h): class, name and description, weight, cost, nutrition, material, and weapon or armor fields.
    - `content` registers the starting kit plus a small, coherent subset per class: about 15 weapons, 10 armor pieces, 6 food items, gold, and 5 potions and 5 scrolls whose effects can be ported now (for example healing, extra healing, see invisible as no-op, identify, enchant weapon, enchant armor, remove curse).
2. **Object instances:** entities with an `item` component (`def`, quantity, BUC, enchantment, known flags, worn/wielded slot), on the floor (`pos`) or in a container (`inventory` component on the hero and monsters). Object stacking via `merged()` (ref: src/invent.c).
3. **Randomized appearances:** per-game shuffled potion and scroll descriptions, stored in state and seeded (ref: src/o_init.c `shuffle_all`). Discoveries list.
4. **Starting inventory:** the Valkyrie's real kit (ref: src/u_init.c): +1 spear, +0 dagger, +3 small shield, food ration. Delete the gear stat block and its DEVIATIONS row; AC and to-hit come from worn and wielded items (ref: src/do_wear.c `find_ac`, src/weapon.c).
5. **Actions (all discoverable via `actionsFor`):** pick up, drop, wield, wear, take off, eat, quaff, read, throw (daggers), and multi-item pick-up and drop menus using `Prompt` kind `menu` (ref: src/pickup.c, src/do.c, src/wield.c, src/do_wear.c, src/eat.c, src/potion.c, src/read.c, src/dothrow.c).
6. **Hunger:** nutrition, hunger states on the status line, fainting and starving to death (ref: src/eat.c `gethungry`, `newuhs`).
7. **Level objects:** objects on new levels (ref: src/mklev.c `mkobj_at` in rooms), monster death drops and corpses (ref: src/mon.c `xkilled`, src/mkobj.c `mkcorpstat`), and monsters picking up and wielding weapons where 5.0 does so for our roster (gnomes, dwarves, hill orcs).
8. **Gold:** `$` on the status line, gold piles on levels.
9. **UI:**
    - an inventory panel (a slide-up sheet on phones) with item actions;
    - object glyphs drawn under monsters and over terrain;
    - remembered object glyphs on seen cells (memory gains an object layer);
    - `i`, `,`, `d`, `w`, `W`, `T`, `e`, `q`, `r` and `t` key bindings in the app keys mod.
10. **Messages:** "You see here a dagger.", "j - a food ration.", and similar, as keys plus params with object naming done in content (ref: src/objnam.c `xname`/`doname`, simplified).

Out of scope: shops, containers (bags), wands, rings, amulets, tools, spellcasting, polymorph, artifacts, and pets.

## Exit criteria

- The Valkyrie starts with her real inventory, and AC and to-hit now come from it.
- I can pick up, drop, wield, wear, eat, quaff and read on desktop and phone without a keyboard.
- Hunger works, and I can starve.
- Monsters drop corpses, and weapon-using monsters pick up and use weapons.
- Replays and the golden test are deterministic (with an explained golden update).
- `pnpm check` is green locally and in CI.

## Testing

- **Scenario builder:** `s.item(def, pos | 'inventory', opts)`, `s.expectInventory(...)`, `s.expectWielded(...)`, `s.expectAc(n)`.
- **Unit tests:**
    - `find_ac`
    - weapon to-hit and damage with real objects
    - stacking and merging
    - appearance shuffle determinism per seed
    - the hunger state machine
- **Property tests:**
    - an item is in exactly one place (a floor cell or one inventory)
    - weight totals match
    - no duplicate inventory letters
- **Soak bot:** also picks up, wields and eats from offered actions; new invariants for item placement.

## Carry-overs from milestone 2

- **Grid bug:** needs AD_ELEC. Consider porting the elemental damage types (AD_ELEC, AD_FIRE, AD_COLD, AD_SLEE) with the resistance fields of `MonsterDef`.
- **Doors:** locked doors and kicking (`#force`/`kick`); remove that DEVIATIONS row.
- **Vision:** the dark-corridor door rule, and remembered monster glyphs.
- **Monster behavior:** fleeing on low HP (`monflee`).
- **Display:** fit-to-width zoom and pinch zoom.
- **CI:** confirm the workflow once a remote exists.
