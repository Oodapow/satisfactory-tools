# Node editor

The node editor draws your factory as blocks joined by schematic lines, at two levels:

- **Factory map** (`#/map`): each outpost is a block, and each import between outposts is a link.
- **Floor plan** (`#/map/<outpost id>`): the inside of one outpost. Blocks are machines, generators, splitters, mergers and ports.

It sits on top of the outpost plans from the planning flow (`src/plan/`). A plan says what an outpost must deliver, which resource nodes it has and what it imports. The editor shows those plans and lets you link them up. It never stores a second copy of goals, imports or recipes.

Tracked in #12. The layout algorithm is #13, the floor-plan grid is #29.

## Factory map

![Factory map](node-editor/1-factory-map.png)

Each block shows the outpost's goal, what it extracts, what it imports, what it exports (goal, surplus resources and byproducts, from the solver) and how much power it uses. Shortfalls show in red.

Links are coloured by how they travel: belt, pipe, truck, train, drone, or power line. When two outposts have several links, they are drawn side by side.

## How lines and ports are drawn

Both levels draw lines like a circuit schematic: horizontal and vertical runs with 90° corners, a small hop where one line crosses another (so a crossing never looks like a join), and every connection point a small circle, hollow while free and filled once connected (orange for inputs, teal for outputs).

On the factory map, lines between outposts are routed one by one (`src/editor/router.ts`): a line whose target is behind it goes round through the gap between blocks, and lines that would share a channel are nudged apart.

The floor plan is stricter, see [The grid](#the-grid) below.

What you can do:

- **Add an outpost**: drag "Outpost" from the left onto the map, or click it. This creates an empty plan.
- **Import between outposts**: drag from one outpost's right edge to another's left edge. The new link imports whatever the first outpost has spare (its first open offer). If it only has power spare, you get a power line instead. Select the link to change the item, rate or transport.
- **See what you could import**: select an outpost. The panel lists its imports and exports, and everything the other outposts still have spare, each with an Import button. Power from power outposts has a Connect button.
- **Open the floor plan**: double-click an outpost, or use "Open floor plan" in its panel.
- **Delete**: select a block or link and press Delete or Backspace, or use the button in the panel. Deleting an outpost deletes its plan and any imports that came from it.
- **Edit the plan itself** (goal, resource nodes, recipes): "Edit goal, resources and recipes" opens the outpost in the planning flow.

![Outpost selected](node-editor/2-outpost-inspector.png)

With no outposts yet, the panel offers **Load example outposts**: Iron Fields (two pure iron nodes, makes 120 screws), Coal Power (200 MW) and Plate Works (20 Reinforced Iron Plates from imported ore and screws).

## Floor plan

![Floor plan proposal](node-editor/4-floor-plan.png)

The first time you open an outpost, the editor proposes a floor plan from the plan's solution (`src/editor/layout.ts`, then `generate.ts` puts it on the grid):

- **One floor per production type.** Steps that use the same machine at the same depth of the chain share a floor: smelting, then plates and rods, then screws, then assembly. A floor sits one level above the highest floor that feeds it, so raw processing is at the bottom and the goal at the top. Each floor's label gives its size in foundations (machines side by side along the manifold, a belt per input and output, a walkway) and its height.
- **Manifolds.** Each step is a row of identical machines. Above it, a splitter chain per ingredient feeds every machine; below it, a merger chain per product collects them. All machines in a step run at the same clock from the solver (for example 3 machines at 83.3%).
- **Lines split to fit your best belt.** When one belt (or pipe) of your best tier can't carry a step's input or output, the step becomes several parallel lines, each with its own belts. A line also splits above 16 machines. Imports and exports that need more than one belt get one port per belt. Each belt gets the lowest Mk that carries its rate, and turns red only when even the best can't (one machine needing more than a belt carries).
- **Imports are honored.** Anything the plan imports, say 240 Screws/min by truck, arrives at a port and is not made here.
- **Gutter and ports.** Every line starts at the left edge of its floor. Left of the floors is a gutter where belts climb between floors (each belt that changes floor shows a conveyor lift with the number of floors). Where one source feeds several consumers, splitters sit in the gutter next to it; where a consumer takes from several sources, mergers do. Ports sit in a column left of the gutter: resource nodes (with extractor, purity and clock) and imports first, then exports. Exports are split by who takes them (one port per importing outpost), and the rest is shown as Goal or Surplus. Power lines become power ports.

![Zoomed in](node-editor/5-floor-zoom.png)

The toolbar shows machine count, floors and power draw against the power coming in. Warnings appear at the bottom: not enough power, shortfalls, imports nothing uses, lines that had to be split, and links on the factory map that changed since the plan was proposed.

Power outposts get a generator floor fed by fuel and water:

![Power outpost](node-editor/6-power-outpost.png)

### The grid

Everything on the floor plan sits on a 20 px grid (`src/editor/grid.ts`). Blocks have fixed sizes in grid cells and snap to the grid when dragged. Every connection point is a grid point on the block's border: a machine has one input per ingredient along its top and one output per product along its bottom.

Belts are routed along grid lines (`src/editor/gridRouter.ts`) with these rules:

- No two belts share a grid edge, so lines never run on top of each other.
- A belt only turns where no other belt is, and two belts only meet where they cross straight through each other (drawn with a hop).
- The grid point just outside each connection point is kept for that point's belt.
- Belts don't run through blocks. Each belt is an A* search that prefers few turns and few crossings; short belts (the manifolds) are routed first.

If a belt can't find a clean path it still gets the best one, sharing as little as possible.

**Splitters and mergers turn to face their belts.** Their connection points rotate (and mirror) to the orientation that points each one at the block at the other end, the single belt (into a splitter, out of a merger) counting double. Only the connection points move: the icon stays upright. Ports turn the same way.

Routes are worked out for the whole plan whenever blocks or belts change. While you drag a block its belts follow it with a plain route, and they snap back onto the grid when you drop it:

![Belts rerouted on the grid after moving a machine](node-editor/5b-grid.png)

### Editing

Everything is editable. Drag blocks in from the left (or click them): any production machine, generator, splitter, merger, or a port for each transport. Connect an output (bottom or right handle) to an input (top or left handle). New belts take their item from whatever feeds them. Select a block or belt to edit it: machine type, recipe or fuel, clock, count and floor; port direction, transport, item and rate; belt item and rate. Short belts (a splitter dropping into its machine) show their label when selected.

Edits change the drawing, not the plan. Once you edit, the toolbar says "Edited" and **Propose layout** asks before replacing your changes. To change what the outpost makes or imports, change the plan or the factory map, then propose again. Floor plans saved before the grid existed are moved onto it when opened.

## Storage

Plans live where the planning flow keeps them (`outposts` in localStorage). The editor adds one entry, `node-editor`, with block positions, power lines and floor plans per outpost. Both go into the existing backup file.

## Icons

Icons come from `src/data/game/icons.ts` (the game icon set, #17). The editor looks that file up at build time, so it also builds on a branch without it. When an item or building has no icon, blocks show a coloured badge with the name's initials, and splitters, mergers and conveyor lifts show the editor's own symbols. Everything is looked up by game id, so new icons appear without code changes.

## Code

All of it is in `src/editor/`:

| File | What it does |
| --- | --- |
| `EditorScreen.tsx` | Both editors, the palette and the selection handling. Loaded lazily with React Flow. |
| `model.ts` | Types for links, power lines, floor plans, ports, belts; belt tier lookup. |
| `layout.ts` | The layout algorithm (`planLayout`): floors, lines, ports and which belt carries what, as plain data. |
| `generate.ts` | Puts that layout on the grid as blocks and belts (`proposeLayout`). |
| `grid.ts` | Grid size, block sizes, connection points, and turning joints and ports to face their belts. |
| `gridRouter.ts` | Floor-plan belt routing on the grid. |
| `nodes.tsx` | Block and line components for both levels. |
| `router.ts` | Factory-map routing and the hops drawn at crossings on both levels. |
| `Symbols.tsx` | Splitter, merger and conveyor lift symbols. |
| `Inspector.tsx` | The right-hand panel for whatever is selected. |
| `store.ts` | The editor's own stored state, the example outposts, palette lists. |
| `icons.ts`, `GameIcon.tsx` | Icon lookup with the lettered fallback. |
| `route.ts` | `#/map` routes. |

It uses [React Flow](https://reactflow.dev) (`@xyflow/react`), MIT licensed, for panning, zooming, dragging and connecting.

## Known gaps

- The layout is one proposal, not a search over alternatives: it doesn't try other floor groupings or machine orders to shorten belts.
- Footprints are estimates from building sizes; they don't place real foundations or check that a floor fits a given area.
- Power lines are kept by the editor because the plan model has no power imports yet. Power lines don't feed into the solver.
- Floor plan edits are not checked against the plan (for example, deleting a machine doesn't show a shortfall).
- On phones you can add blocks by tapping the palette, but linking needs a drag between two small handles, which is fiddly.
