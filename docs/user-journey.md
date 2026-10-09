# User journey and outpost planning

What the site does today, how the pieces fit, and where to extend them. Screenshots live in [`ui-journey/`](ui-journey/) and, for the navigation, [`navigation/`](navigation/).

## The flow

The top bar has four tabs, not steps: **Game state**, **Factory map**, **Outposts** and **Catalog**. The main flow is game state, then the factory map; the catalog is for looking things up, and the outposts screens are where one outpost is defined. A footer with the game data version and the "not actually approved" notice is always visible, with the page scrolling between the top bar and the footer.

1. **Welcome** (`#/`): upload a save or set up by hand. Returning players get "Open your factory map".
2. **Upload** (`#/upload`): drop a `.sav` file. It is parsed in the browser (`src/save/`) and the result screen shows what was read: tier, Space Elevator phase, milestones, MAM research, alternates and AWESOME Shop unlocks, plus how many unknown (usually modded) unlocks were skipped. "Try a sample" shows a made-up mid-game state instead. In Chrome and Edge on a computer the player can instead link the save folder (or one file, or drop either on the page): the browser keeps a handle to it in IndexedDB, and every visit re-reads the newest save of the linked session when it changed (`src/save/linked.ts`, `src/save/sync.ts`). Browsers ask again for access once per visit, through the "Update from save" chip in the top bar. Other browsers get a note to upload again after playing.
3. **Game state** (`#/setup`), which ends with "Open the factory map": pick a tier to tick every milestone up to it, set the Space Elevator phase, then fine-tune milestones, MAM research and alternates. Spoiler rules:
   - only tiers the HUB would show are listed (tutorial done, Space Elevator phase reached);
   - MAM research is offered in tree order: a node shows once a node above it is researched. Trees stay folded until the player has researched something in them or opens them; seasonal research is hidden;
   - alternates list only what a hard drive could give right now;
   - "Show anyway" reveals later tiers. The spoiler setting (hide or blur locked things) also lives here.
4. **Catalog** (`#/catalog`, `#/plan` still works): index and search of unlocked recipes (per-minute rates), items and buildings, plus the milestones you can buy next. Locked content is a count, or blurred cards with no names. "Plan an outpost" on an item starts an outpost with that goal.
5. **Outposts** (`#/outposts`): the network of outposts, each showing what goes in (nodes, imports) and what comes out (goal, spare resources, byproducts, power).
6. **Outpost editor** (`#/outposts/:id/goal|resources|plan`), declarative, in three tabs that can be opened in any order. A breadcrumb leads back to the factory map (or the outposts list), and the header has "Floor plan" and "Delete":
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

1. Walk demand back from each goal. Imports of an item are used first, then byproducts the outpost already makes (for example the water Aluminum Scrap gives off covers part of what Alumina Solution needs), then new production. Resources go to the raw ledger; anything with no unlocked recipe is a shortfall. Because byproducts depend on the steps chosen, the walk repeats until they settle.
2. A power goal adds generators: fuel per minute is `MW × 60 / energyMJ`, water is `MW × 60 × supplementalPerMJ`, and fuel byproducts (nuclear waste) leave the outpost. When self-powered, the outpost's own draw is added and solved again until it settles.
3. Machines are sized to the plan's highest clock speed (`maxClock`, 100% until Overclock Production is researched, up to 250%). A step that doesn't divide evenly gets the fewest machines that do the work, all at the same lower clock, so a manifold feeds them evenly: 2.5 machines of work at 100% is 3 machines at 83.3%. Each machine draws `power × clock^1.321928`, and needs one power shard per 50% above 100%.
4. Somersloops (`somersloops`, per recipe, once Production Amplifier is researched) multiply a machine's output by `1 + slots × boost` and its power by the square of that.
5. Every node runs at its own clock (`extractor rate × purity × clock`); water comes from Water Extractors without a node, sized like machines. Raw demand beyond the nodes is a shortfall.
6. Everything left over (spare node output, byproducts, the goal itself) is exported. Unused imports are reported, not exported.

`suggestRecipes` picks a recipe per item the user hasn't overridden: the option that leaves nothing short, then uses the least raw input, then the fewest machines (a few greedy passes). `src/plan/network.ts` solves every outpost and lists what each can still offer to others after existing imports.

The Plan step shows each step's machine count, clock and power shards, and has a "Highest clock speed" picker and a Somersloop field per recipe once those are researched. The Resources step has a clock per node.

Simplifications: generators run at 100% (fractional counts), and outposts are solved independently (an import doesn't check the exporter's live surplus beyond the offer list). Tests for this math are in `src/plan/solve.test.ts` (`npm test`).

## Icons

`src/screens/Icon.tsx` shows game icons through `iconUrl(id)` from `src/data/game/icons.ts` (files in `public/icons/`, keyed by the same ids as the game data), and `PowerIcon` for MW amounts. An id with no icon falls back to a colored badge with the name's initials.

## Next

- Layout proposal per outpost: floors by production type, manifolds, best unlocked belts, generated from `OutpostSolution` (tracked as an issue).
- Node editor: macro view of outposts and their transport links, micro view of machines, built on the plan model.
