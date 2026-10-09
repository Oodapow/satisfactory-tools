# Satisfactory Tools: overview

Start here. This page covers what we're building, how the code is laid out, where the game data comes from, and how changes reach the live site. Feature docs live next to it in `docs/` and are listed at the bottom.

Live site: https://oodapow.github.io/satisfactory-tools/
Work is tracked in [GitHub issues](https://github.com/Oodapow/satisfactory-tools/issues).

## Vision

A planner for Satisfactory factories that respects where the player is in the game. You tell it your game state, then plan **outposts**: self-contained factories that take some inputs and produce some outputs. The app only ever shows what you have unlocked, so new players don't get spoiled.

Planning is declarative. You say what an outpost should make and what it has access to ("20 Reinforced Iron Plate/min from 240 Iron Ore/min, and I'll import 120 Screws/min"), and the app proposes a buildable layout: manifolds, the best belts you have, one floor per production step. You review it, edit it, and save it. Outposts then become building blocks for each other: one outpost's exports (parts, raw resources, power) are another's imports.

## User flow

1. **Game state.** Upload a save ([#9](https://github.com/Oodapow/satisfactory-tools/issues/9)) or set it up by hand: tier, milestones, Space Elevator phase, MAM research, alternates. Only what the game itself would show is listed. ([#7](https://github.com/Oodapow/satisfactory-tools/issues/7))
2. **Planning.** Browse unlocked recipes, items and buildings, and see what can be bought next. Locked content is hidden or blurred. ([#7](https://github.com/Oodapow/satisfactory-tools/issues/7))
3. **Define an outpost.** Start from its goal and the resources it has access to. Pick imports from other outposts' outputs; list its exports, including raw resources and power. ([#11](https://github.com/Oodapow/satisfactory-tools/issues/11), see [user journey](user-journey.md))
4. **Get a layout.** The layout algorithm turns the declaration into floors, machine groups, manifolds and belts, honoring imports and chosen recipes. ([#13](https://github.com/Oodapow/satisfactory-tools/issues/13), math in [#14](https://github.com/Oodapow/satisfactory-tools/issues/14))
5. **Edit visually.** A node editor at two levels: the network of outposts linked by belts, trains, trucks and power (macro), and the machines inside one outpost with its external ports (micro). ([#12](https://github.com/Oodapow/satisfactory-tools/issues/12), see [node editor](node-editor.md))

Icons for items, buildings, resources and power appear throughout. ([#8](https://github.com/Oodapow/satisfactory-tools/issues/8))

## Architecture

- **Static web app, no backend.** Everything runs in the browser, which keeps hosting free and the app usable on mobile. Save parsing will also run client-side.
- **Vite + React + TypeScript.** Plain CSS with color variables, light and dark mode following the device, mobile-first.
- **Routing:** hash routes (`#/setup`, `#/plan`, `#/outposts/:id`), because GitHub Pages can't serve fallback routes for a single-page app.
- **State:** kept in `localStorage` through `usePersistentState` (`src/storage/persisted.ts`), with export and import to a JSON backup file. ([#5](https://github.com/Oodapow/satisfactory-tools/issues/5))
- **Game state** is `{ purchased, spaceElevatorPhase }`, the shape `src/data/game/availability.ts` expects, plus UI settings.

| Path | What it is |
| --- | --- |
| `src/data/game/` | Generated game data and typed helpers (see below). |
| `src/storage/` | Browser persistence. |
| `scripts/generate-game-data.mjs` | Builds `src/data/game/` from `data/`. |
| `data/` | Raw game file and hand-written supplements. |
| `.github/workflows/` | CI and deploy. |

## Data pipeline

The app ships its own copy of everything a game state can contain. Full details are in [data/README.md](../data/README.md); in short:

1. **Source:** the game's own `CommunityResources/Docs/en-US.json` (1.2.4.0), copied to `data/raw/` as UTF-8, plus small supplements in `data/supplements/` for things that file doesn't contain (Space Elevator phases, node counts).
2. **Generate:** `npm run data:generate` normalizes it into `src/data/game/*.json`: items, resources, recipes, buildings, schematics (milestones, MAM, alternates, AWESOME Shop) and progression. Ids are the game's class names, so they match save files.
3. **Check:** `npm run data:check` fails if the generated files differ from what the script produces; CI runs it on every PR.
4. **Use:** `src/data/game/index.ts` exports typed data and lookups; `availability.ts` answers "what is unlocked" and "what can be bought next" for a game state.

Known gap: MAM research order ([#10](https://github.com/Oodapow/satisfactory-tools/issues/10)). Icons are fetched by `scripts/fetch-icons.mjs` into `public/icons/` and listed in `src/data/game/icons.json` ([#8](https://github.com/Oodapow/satisfactory-tools/issues/8)).

To update after a game patch, run the generator with `--from` pointing at your install's `en-US.json` (command in [data/README.md](../data/README.md#regenerating)).

## Deploys

`main` is always live: merging a PR is deploying. ([#4](https://github.com/Oodapow/satisfactory-tools/issues/4))

- **Every pull request** (`.github/workflows/ci.yml`): `npm ci`, lint (oxlint), `data:check`, then build (`tsc -b && vite build`). A red check means don't merge.
- **Every push to `main`** (`.github/workflows/deploy.yml`, also runnable by hand): lint and build, then publish `dist/` to GitHub Pages. Only the latest push deploys.
- Vite uses `base: './'` so the site works under the `/satisfactory-tools/` sub-path.
- **Every PR links an issue.** The PR template starts with `Closes #N`, and the `PR issue link` check fails a PR whose description has no `Closes`/`Fixes`/`Resolves`/`Refs #N` (or `No issue: <reason>` for trivial changes). Closing keywords only work on PRs merged into `main`; a stacked PR merged into another branch closes nothing, so keep the `Closes` line on the PR that lands on `main`.

Local development:

```sh
npm install
npm run dev     # dev server
npm run build   # production build into dist/
npm run lint
```

## Work so far

| Issue | What | Where |
| --- | --- | --- |
| [#4](https://github.com/Oodapow/satisfactory-tools/issues/4) | Static app with CI and Pages deploy | done |
| [#5](https://github.com/Oodapow/satisfactory-tools/issues/5) | Browser persistence, outposts, backup | done in #1 |
| [#6](https://github.com/Oodapow/satisfactory-tools/issues/6) | Game data for 1.2 | done in #2 |
| [#7](https://github.com/Oodapow/satisfactory-tools/issues/7) | User journey: game state, spoiler-free planning, outposts | done in [#3](https://github.com/Oodapow/satisfactory-tools/pull/3) |
| [#8](https://github.com/Oodapow/satisfactory-tools/issues/8) | Game icons | done in [#17](https://github.com/Oodapow/satisfactory-tools/pull/17) |
| [#9](https://github.com/Oodapow/satisfactory-tools/issues/9) | Read game state from a save file | planned |
| [#10](https://github.com/Oodapow/satisfactory-tools/issues/10) | MAM research tree order | planned |
| [#11](https://github.com/Oodapow/satisfactory-tools/issues/11) | Declarative outpost planning with imports and exports | done in [#3](https://github.com/Oodapow/satisfactory-tools/pull/3) and [#18](https://github.com/Oodapow/satisfactory-tools/pull/18) |
| [#12](https://github.com/Oodapow/satisfactory-tools/issues/12) | Node editor: outpost network and factory floor | done in [#18](https://github.com/Oodapow/satisfactory-tools/pull/18) |
| [#13](https://github.com/Oodapow/satisfactory-tools/issues/13) | Layout algorithm: manifolds, belts, floors | in review |
| [#14](https://github.com/Oodapow/satisfactory-tools/issues/14) | Production math: overclocking, purity, byproducts | in review |

The [issue list](https://github.com/Oodapow/satisfactory-tools/issues) is the source of truth; this table is a snapshot.

## Feature docs

- [Game data](../data/README.md): sources, units, regeneration, licensing.
- [User journey and outpost planning](user-journey.md): the flow, the plan model, how a plan is solved, icons. Screenshots in `ui-journey/`.
- [Node editor](node-editor.md): factory map and floor plans.

New feature docs go in `docs/` as their own file and get a line here.
