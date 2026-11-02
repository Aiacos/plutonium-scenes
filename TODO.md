# TODO

Open work for the DDB scene data generator (`_node/ddb-import/`, published to the `generated` branch). The Foundry side lives in [Aiacos/ddb-plutonium-scenes › TODO.md](https://github.com/Aiacos/ddb-plutonium-scenes/blob/main/TODO.md).

## 🐞 Known issues
- [ ] 354 Plutonium maps have DDB scenes that do not register well enough to match (see `ddb-import-report.json` on `generated`, `status: "unmatched"`).
- [ ] Player maps whose aspect ratio differs from the DM map (Curse of Strahd "Map 2–6", "Map 11 & 12") get only their chapter folder.
- [ ] A few walls inherited from DM data fall outside the scene (Argynvostholt, Tser Pool).
- [ ] NPC matching misses plural or retitled names ("Tribal Warrior Spore Servants", OotA "Prince Livid").

## 🧪 Quality
- [ ] Unit tests for `findBookCreature` / `resolveCreatures` (named NPCs, numbered tokens, false positives such as "King Groak") and for `getPlayerTransform`.
- [ ] `npm test` lint fails on upstream's own `RegionDataOptimizer.js`; scope our lint to `_node/ddb-import/` in CI instead of editing upstream files.
- [ ] Upstream's schema rejects the `flags` key on `generated` data; validate it with our own schema.

## ⚙️ CI
- [ ] Add a lint + unit test job on pull requests touching `_node/ddb-import/`.
- [ ] Pin the 5etools and ddb-meta-data checkouts to a commit recorded in the build, so a bad upstream push can be reverted.
