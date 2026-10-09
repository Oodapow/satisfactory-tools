# Game data

Everything the app knows about Satisfactory (items, recipes, buildings, milestones, MAM research,
alternate recipes, AWESOME Shop) comes from the data file the game ships for tool makers, plus a
few hand-written supplements for things that file does not contain.

**Game version:** 1.2.4.0 (see `gameVersionNote` in `src/data/game/meta.json` for how this was established).

## Layout

| Path | What it is |
| --- | --- |
| `data/raw/en-US.json` | Copy of the game's `CommunityResources/Docs/en-US.json`, re-encoded from UTF-16 to UTF-8 so git can diff it. Otherwise untouched. |
| `data/supplements/progression.json` | Space Elevator phases and which tiers each phase opens. Not in the game file. |
| `data/supplements/resource-nodes.json` | Resource node counts per purity on the map, and purity multipliers. Not in the game file. |
| `data/supplements/items.json` | Items the game file references but does not describe (FICSIT Coupon, Hard Drive). |
| `scripts/generate-game-data.mjs` | Turns the above into the files below. |
| `src/data/game/*.json` | Generated, normalized data the app imports. Do not edit by hand. |
| `src/data/game/types.ts` | TypeScript types for the generated files. |
| `src/data/game/index.ts` | Typed exports and lookup maps (by id, recipes producing/consuming an item). |
| `src/data/game/availability.ts` | Given a game state, what is unlocked and what can be bought next. |
| `scripts/fetch-icons.mjs` | Collects icons into `public/icons/<id>.webp` (96 px) and lists them in `src/data/game/icons.json`. |
| `src/data/game/icons.ts` | `iconUrl(id)` for items and buildings, and `powerIconUrl` for electricity. |

Generated files:

| File | Contents |
| --- | --- |
| `items.json` | Parts, resources, fuels, equipment, ammo, vehicles: name, form, stack size, sink points, energy. |
| `resources.json` | Raw resources, which buildings extract them, which milestone adds them to the scanner, node counts. |
| `recipes.json` | Every recipe: kind (production, building, equipment, manual), alternate flag, inputs, outputs, time, machines, what unlocks it. |
| `buildings.json` | Every buildable: power, footprint, overclock and Somersloop slots, generator fuels, extractor rates, build recipe. |
| `schematics.json` | Milestones, HUB upgrades, MAM research, alternate recipes, AWESOME Shop: cost, tier, dependencies, everything it unlocks. |
| `progression.json` | Tiers with their milestones and gates, Space Elevator phases, what each schematic type needs before it can be bought. |
| `meta.json` | Game version, units, counts, attribution. |

## Conventions

- **Ids are the game's class names** (`Desc_IronPlate_C`, `Recipe_IronPlate_C`, `Schematic_3-1_C`), so they line up with save files. Buildings are keyed by their descriptor (`Desc_ConstructorMk1_C`); `buildClass` gives the placed actor (`Build_ConstructorMk1_C`) that save files contain.
- **Units:** fluids in m³ (the game stores litres; we divide by 1000 like the in-game UI), power in MW, time in seconds, sizes in metres. `extractor.itemsPerCycle` is left as the game stores it (litres for fluids).
- **Unlock links:** `recipe.unlockedBy` lists schematics; `schematic.unlocks` lists recipes, granted schematics, scanner resources, slots and features. Building recipes carry `building`, so unlocked buildings follow from unlocked recipes.
- Cosmetics (paint, patterns, tapes, emotes, statues) are listed by id under `unlocks.cosmetics` but not described.

## Regenerating

After a game update, point the script at your install (Steam default shown):

```sh
npm run data:generate -- --from "C:/Program Files (x86)/Steam/steamapps/common/Satisfactory/CommunityResources/Docs/en-US.json" --game-version 1.2.5.0 --game-version-note "..."
```

Without `--from` it regenerates from `data/raw/en-US.json`. The script fails if anything references an id it cannot resolve, so renames in a game update show up immediately. CI runs `npm run data:check`, which fails if the generated files do not match what the script produces.

## Icons

Icons are keyed by the same ids as the data (`Desc_IronPlate_C`, `Desc_ConstructorMk1_C`). Items, buildings and schematics also carry `iconTexture`, the game's own texture asset name, so icons can be extracted straight from a game install.

`npm run icons:fetch` fills in missing icons, trying in order:

1. `--dir <folder>`: PNGs extracted from the game files, named by id or by texture (for example the output of [satisfactory-icon-extractor](https://github.com/relyen-dev/satisfactory-icon-extractor)).
2. The [Official Satisfactory Wiki](https://satisfactory.wiki.gg/), by display name.
3. A mirror of the wiki's icons named by game id ([Satisfunction](https://github.com/jdcravenBD/Satisfunction) `public/icons`).

Each entry in `icons.json` records which source it came from. Behind a proxy, run it with `NODE_USE_ENV_PROXY=1`. CI runs `npm run icons:check` to make sure `icons.json` and `public/icons/` agree.

The electricity icon (`public/icons/power.svg`) is our own drawing; power is not an item in the game.

**Coverage right now:** 176 of 753: 159 items (every part, raw resource and fluid except Somersloop, Mercer Sphere and FICSMAS items) and the 17 production machines and extractors. Missing: equipment, vehicles, generators, and the other buildables (logistics, power poles, storage, walls, foundations). They were not reachable from where the data was generated; running `npm run icons:fetch` with access to the wiki, or with `--dir` pointed at icons extracted from the game, fills them in.

## Known gaps

- **MAM tree order.** The game file says which tree a research node belongs to (`mamTree`) but not which node must be researched before which. `purchasable()` therefore offers every node of the MAM once the MAM is built.
- **Space Elevator phases and tier gates** are hand-written from the wiki (`data/supplements/progression.json`), at the default 1× cost. Game-mode cost multipliers (1.2) are not applied.
- **Map data** is limited to node counts per purity for solid resources, crude oil and geysers. Resource wells (water, nitrogen, oil) and node locations are not included.

## Sources and licensing

- Game data: `CommunityResources/Docs/en-US.json` from Satisfactory 1.2.4.0, © Coffee Stain Studios. Coffee Stain ships this file for community tools; it is kept here so the app works without a game install. All rights remain with Coffee Stain Studios.
- Supplements: adapted from the [Official Satisfactory Wiki](https://satisfactory.wiki.gg/) ([Space Elevator](https://satisfactory.wiki.gg/wiki/Space_Elevator), [Resource node](https://satisfactory.wiki.gg/wiki/Resource_node)), licensed [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).
- Icons: © Coffee Stain Studios, as published on the Official Satisfactory Wiki. Used for a non-commercial fan tool; all rights remain with Coffee Stain Studios.
- Cross-check: production recipes, cycle times and machine power were compared against the independent 1.2.4.0 extraction in [Satisfunction](https://github.com/jdcravenBD/Satisfunction) (`public/data.js`, CL 502094) and matched exactly.
