# Satisfactory Tools

Web tools for Satisfactory. Vite + React + TypeScript, deployed to GitHub Pages on every push to `main`.

```sh
npm install
npm run dev    # local dev server
npm run build  # production build into dist/
```

Live: https://oodapow.github.io/satisfactory-tools/

CI runs lint + build on every pull request; pushes to `main` deploy automatically.

## Game data

Recipes, items, buildings, milestones and research for Satisfactory 1.2 live in `src/data/game/`, generated from the game's own data file. See [data/README.md](data/README.md) for sources, units and how to regenerate after a game update.
