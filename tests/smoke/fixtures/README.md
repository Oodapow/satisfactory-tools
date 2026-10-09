# Smoke test fixtures

- `storage-before-navigation.json`: everything the app stored in `localStorage` at commit 574294e (before the navigation redesign in #30), after loading the sample save, the map's example outposts and each outpost's floor plan. The smoke test loads the current build on top of it to check that older saved data still opens.
- `sample-1.2.sav`: a small Satisfactory 1.2 save (`Another-1-2.sav`) from the test saves of [satisfactory-file-parser](https://github.com/etothepii4/satisfactory-file-parser) (MIT).
