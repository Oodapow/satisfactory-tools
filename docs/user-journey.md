# User journey and outpost planning

What the site does today, how the pieces fit, and where to extend them. Screenshots for each step live in [`ui-journey/`](ui-journey/).

## The flow

1. **Welcome** (`#/`): upload a save or set up by hand. Returning players get "Continue planning".
2. **Upload** (`#/upload`): drop a `.sav` file. Parsing isn't built yet, so the result screen shows a sample game state and says so (`src/screens/Upload.tsx`, `mockParse`).
3. **Game state** (`#/setup`): pick a tier to tick every milestone up to it, set the Space Elevator phase, then fine-tune milestones, MAM research and alternates. Spoiler rules:
   - only tiers the HUB would show are listed (tutorial done, Space Elevator phase reached);
   - MAM trees stay folded until the player has researched something in them or opens them, since the game data doesn't order nodes within a tree; seasonal research is hidden;
   - alternates list only what a hard drive could give right now;
   - "Show anyway" reveals later tiers. The spoiler setting (hide or blur locked things) also lives here.
4. **Planning** (`#/plan`): catalog of unlocked recipes (per-minute rates), items and buildings, plus the milestones you can buy next. Locked content is a count, or blurred cards with no names. "Plan an outpost" on an item starts an outpost with that goal.
5. **Outposts** (`#/outposts`): the network of outposts, each showing what goes in (nodes, imports) and what comes out (goal, spare resources, byproducts, power).
6. **Outpost editor** (`#/outposts/:id/goal|resources|plan`), declarative in three steps:
   - **Goal**: what it must deliver. Products (anything producible or a raw resource) and/or power in MW from a chosen generator and fuel. Optionally self-powered.
   - **Resources**: the nodes it sits on (resource, purity, extractor) and imports. Imports are picked from what other outposts still have spare, with amount and transport. Items the outpost is short on are highlighted, with one-tap "add a node" buttons.
   - **Plan**: the proposed production steps, generators and extractors. Each item with more than one unlocked recipe has a picker; the suggested one is marked and "Reset to suggested recipes" drops overrides.
   - A **Balance** panel stays visible: in, out, power, shortfalls and unneeded imports.

All state is stored in the browser (`usePersistentState`, keys `gameState` and `outposts`) and is covered by Export/Import on the game state page.

## Plan model

`src/plan/types.ts` is the contract other views (the node editor, a future layout planner) build on.

- `OutpostPlan`: `goals` (`ItemGoal` or `PowerGoal`), `nodes` (`ResourceNode`), `imports` (`Import`, from another outpost id, with a `Transport`), `recipeChoices` (overrides per item), `selfPowered`. This is all that's stored.
- `OutpostSolution` is derived and never stored: `steps`, `generators`, `extraction`, per-item `flows` (extracted, imported, produced, consumed, exported, shortfall), `power`, and the recipe used per item.

Outposts saved before plans existed (one `target` and `choices`) are migrated on read in `src/plan/store.ts`.

## How a plan is solved

`src/plan/solve.ts`, pure functions over the game data and `availability()`:

1. Walk demand back from each goal. Imports of an item are used before producing it; resources go to the raw ledger; anything with no unlocked recipe is a shortfall.
2. A power goal adds generators: fuel per minute is `MW × 60 / energyMJ`, water is `MW × 60 × supplementalPerMJ`. When self-powered, the outpost's own draw is added and solved again until it settles.
3. Every node runs at full speed (`extractor rate × purity`); water comes from Water Extractors without a node. Raw demand beyond the nodes is a shortfall.
4. Everything left over (spare node output, byproducts, the goal itself) is exported. Unused imports are reported, not exported.

`suggestRecipes` picks a recipe per item the user hasn't overridden: the option that leaves nothing short, then uses the least raw input, then the fewest machines (a few greedy passes). `src/plan/network.ts` solves every outpost and lists what each can still offer to others after existing imports.

Simplifications: machines run at 100% (fractional counts are shown so one can be underclocked), power scales linearly with machines, and outposts are solved independently (an import doesn't check the exporter's live surplus beyond the offer list).

## Icons

`src/screens/Icon.tsx` shows game icons through `iconUrl(id)` from `src/data/game/icons.ts` (files in `public/icons/`, keyed by the same ids as the game data), and `PowerIcon` for MW amounts. An id with no icon falls back to a colored badge with the name's initials.

## Next

- Layout proposal per outpost: floors by production type, manifolds, best unlocked belts, generated from `OutpostSolution` (tracked as an issue).
- Node editor: macro view of outposts and their transport links, micro view of machines, built on the plan model.
- Real save parsing to fill the game state.
