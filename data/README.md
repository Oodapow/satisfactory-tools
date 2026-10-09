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
| `data/supplements/mam-trees.json` | MAM research tree layout: which nodes sit in each tree and which node opens which. Not in the game file. |
| `data/supplements/world-nodes.json` | Position, resource and purity of every resource node, resource well spot and geyser on the map. Not in the game file. |
| `data/supplements/taxonomy.json` | How the catalog groups things: display names and order for the game's build menu categories, and item categories (the game file has none; these follow the in-game AWESOME Shop part categories). Every item must be listed once. |
| `data/supplements/items.json` | Items the game file references but does not describe (FICSIT Coupon, Hard Drive). |
| `scripts/generate-game-data.mjs` | Turns the above into the files below. |
| `src/data/game/*.json` | Generated, normalized data the app imports. Do not edit by hand. |
| `src/data/game/types.ts` | TypeScript types for the generated files. |
| `src/data/game/index.ts` | Typed exports and lookup maps (by id, recipes producing/consuming an item). |
| `src/data/game/availability.ts` | Given a game state, what is unlocked and what can be bought next. |
| `scripts/fetch-icons.mjs` | Collects icons into `public/icons/<id>.webp` (96 px) and lists them in `src/data/game/icons.json`. |
| `src/data/game/icons.ts` | `iconUrl(id)` for items and buildings, and `powerIconUrl` for electricity. |
| `scripts/fetch-map.mjs` | Downloads the in-game map picture and writes `public/map/overview.webp` (2048 px) plus 4×4 full-resolution tiles in `public/map/tiles/`. |
| `src/data/game/worldMap.ts` | Typed `world-map.json` and the map picture's URL, for the world map screen only. |

Generated files:

| File | Contents |
| --- | --- |
| `items.json` | Parts, resources, fuels, equipment, ammo, vehicles: name, form, stack size, sink points, energy. |
| `resources.json` | Raw resources, which buildings extract them, which milestone adds them to the scanner, node counts. |
| `recipes.json` | Every recipe: kind (production, building, equipment, manual), alternate flag, inputs, outputs, time, machines, what unlocks it. |
| `buildings.json` | Every buildable: power, footprint, overclock and Somersloop slots, generator fuels, extractor rates, build recipe. |
| `schematics.json` | Milestones, HUB upgrades, MAM research, alternate recipes, AWESOME Shop: cost, tier, dependencies, everything it unlocks. |
| `progression.json` | Tiers with their milestones and gates, Space Elevator phases, what each schematic type needs before it can be bought. |
| `world-map.json` | The world area the map picture covers, and the nodes from `world-nodes.json`. |
| `taxonomy.json` | Items and buildings grouped into categories and subcategories, in display order. Buildings follow the in-game build menu. Use `groupByTaxonomy` from `src/data/game/index.ts` to sort a list into it. |
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
2. The [Official Satisfactory Wiki](https://satisfactory.wiki.gg/). The wiki names architecture icons by shape, size and material (`Inv._Ramp_2m_(Coated).png`), so the script reads the wiki's `Template:DocsBuildings.json` and `Template:DocsItems.json` (class name to wiki name) and its file list to pick the right file for each variant, then falls back to the display name.
3. A mirror of the wiki's icons named by game id ([Satisfunction](https://github.com/jdcravenBD/Satisfunction) `public/icons`).

Each entry in `icons.json` records which source it came from. Behind a proxy, run it with `NODE_USE_ENV_PROXY=1`. CI runs `npm run icons:check` to make sure `icons.json` and `public/icons/` agree.

The electricity icon (`public/icons/power.svg`) is our own drawing; power is not an item in the game.

**Coverage right now:** 734 of 753. The wiki has no icon for the other 19: Foundation Stairs (1 m) and (2 m) in all five materials (the wiki only has 4 m), Inverted Outer Corner Quarter Pipe (Polished), Old Jump Pad, Old Tilted Jump Pad, Perpendicular Wall Conveyor (both materials), and four unnamed leftovers in the game file (`Desc_QuarterPipeMiddle_Ficsit_4x1_C`, `_4x2_C`, `_4x4_C`, `Desc_Wall_Window_8x4_03_Steel_C`). Running `npm run icons:fetch -- --dir` with icons extracted from the game fills these in.

## Known gaps

- **MAM tree order** is transcribed from the wiki's tree diagrams (`data/supplements/mam-trees.json`): per tree, every node with the nodes drawn directly above it (`parents`). The generator copies them onto each research as `mamParents` and sets `mamTree` from the supplement (the game's folders put Blade Runners and one Inflated Pocket Dimension under Caterium; in the game they sit in the Quartz tree). A node opens once any one parent is researched, as Bio-Organic Properties does after any of the four remains. Research in the game file that no tree shows (Signal Systems, Volatile Applications, an unnamed Sulfur node) is listed under `notInTree` and never offered. `data:check` fails when a supplement id is unknown, its name doesn't match the game's, a parent is outside its tree, or a research node is in neither list, so a game update that adds research shows up.
- **Space Elevator phases and tier gates** are hand-written from the wiki (`data/supplements/progression.json`), at the default 1× cost. Game-mode cost multipliers (1.2) are not applied.
- **Map data:** node positions, resources and purities come from `world-nodes.json` (see Sources). `data:check` fails if its counts per resource and purity stop matching `resource-nodes.json`. The map bounds in the generator were checked against a 1.x save: node actors in the save sit exactly at these positions, and the save's fog of war lines up with the picture. Collectibles (Power Slugs, Somersloops, Mercer Spheres) are not included; crash sites come from the save itself.

## World map from a save

`src/save/readMap.ts` reads the world map's part of a save: the fog of war (`mFogOfWarRawData` on the map manager, 512×512 RGBA with how explored each texel is in the blue channel, kept at 256×256), which nodes have an extractor on them (`mExtractableResource`), and where the HUB, the players and the crash sites are.

## Sources and licensing

- Game data: `CommunityResources/Docs/en-US.json` from Satisfactory 1.2.4.0, © Coffee Stain Studios. Coffee Stain ships this file for community tools; it is kept here so the app works without a game install. All rights remain with Coffee Stain Studios.
- Node positions (`data/supplements/world-nodes.json`): adapted from [`WorldResourceNodes.json`](https://github.com/rockfactory/satisfactory-logistics/blob/main/src/recipes/WorldResourceNodes.json) in rockfactory/satisfactory-logistics, MIT License, Copyright (c) 2024 Leonardo Ascione; extracted from the game's map.
- Map picture (`public/map/`): the in-game map, [File:Map.jpg](https://satisfactory.wiki.gg/wiki/File:Map.jpg) on the Official Satisfactory Wiki. © Coffee Stain Studios.
- Supplements: adapted from the [Official Satisfactory Wiki](https://satisfactory.wiki.gg/) ([Space Elevator](https://satisfactory.wiki.gg/wiki/Space_Elevator), [Resource node](https://satisfactory.wiki.gg/wiki/Resource_node), research tree diagrams on [MAM](https://satisfactory.wiki.gg/wiki/MAM) and [FICSMAS](https://satisfactory.wiki.gg/wiki/FICSMAS)), licensed [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).
- Icons: © Coffee Stain Studios, as published on the Official Satisfactory Wiki. Used for a non-commercial fan tool; all rights remain with Coffee Stain Studios.
- Cross-check: production recipes, cycle times and machine power were compared against the independent 1.2.4.0 extraction in [Satisfunction](https://github.com/jdcravenBD/Satisfunction) (`public/data.js`, CL 502094) and matched exactly.
