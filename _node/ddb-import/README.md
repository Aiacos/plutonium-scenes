# DDB import

Enriches Plutonium's scene data with the [DDB Importer community scene data](https://github.com/MrPrimate/ddb-meta-data): lights, walls where Plutonium has none, creature placements and Book › Chapter folders. Output is published to the `generated` branch by `.github/workflows/ddb-sync.yml`; the [ddb-plutonium-scenes](https://github.com/Aiacos/ddb-plutonium-scenes) Foundry module places the creatures.

## 🎯 Usage

```sh
node _node/ddb-import/build.js --ddb <ddb-meta-data>/content --vet <5etools-src>/data [--report report.json]
npx eslint _node/ddb-import          # lint (upstream files are not ours to lint)
node --test _node/ddb-import/test/   # unit tests
```

The build rewrites `data/` in place and takes about 10 minutes.

## ⚙️ How maps are matched

| Method | When |
| --- | --- |
| `walls` | Both scenes have walls and they register (scale + offset fit, ≥ 50 % coverage both ways). |
| `bounds` | Similar name (one contains the other) and the same image aspect ratio (± 2 %), and one side has no walls to compare. |
| `bounds-agree` | Similar name and same aspect ratio; registration scored low, but on its own it found the image-bounds transform (≤ 1 % scale, ≤ 1 grid cell). |
| `bounds-walls` | Similar name and same aspect ratio; under the image-bounds transform one side's walls land on the other's (≥ 80 %; ≥ 10 walls unless the names are equal). |

Name similarity ignores the "Map 6.2:" prefix, except among DDB scenes that share a name once it is dropped, where a different map number halves it.

Everything else is `unmatched` in the report. Tokens DDB keeps outside the map image (reserves in the scene padding) stay there. Player versions copy their DM map's data through `getPlayerTransform` when the images have the same aspect ratio; a player image cropped differently is matched against the DDB scenes directly, like a map of its own.

## 🐉 How creatures are resolved

Each token gets the 5etools creature for both rules editions (`creatures: {"2024", "2014"}`), in this order:

1. The book's own aliases from its text (`{@creature Gray Ooze||Prince Livid}`), for names that are not creatures themselves.
2. A personal name on a generic statblock → the book's own NPC (`npc: true`): exact/alias, every word, unique first name not used by other books, near-identical spelling; numbers must agree.
3. The DDB statblock name → the newest statblock of each edition (following `reprintedAs` to 2024 renames).
4. DDB's own NPC name → the book's NPC, as in 2.

## 📚 Files

| File | Role |
| --- | --- |
| `build.js` | Orchestration, player versions, folders, report. |
| `match.js` | Candidate selection and matching methods. |
| `loaders.js` | 5etools maps, bestiary, creature aliases; DDB scenes. |
| `convert.js` | Coordinate transforms, wall/light/token conversion, creature resolution. |
| `geometry.js` | Wall registration (Hough + ICP) and transform scoring. |
| `test/` | Unit tests. |
