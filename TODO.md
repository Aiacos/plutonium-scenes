# TODO

Open work for the DDB scene data generator (`_node/ddb-import/`, published to the `generated` branch). The Foundry side lives in [Aiacos/ddb-plutonium-scenes › TODO.md](https://github.com/Aiacos/ddb-plutonium-scenes/blob/main/TODO.md). See [CHANGELOG.md](CHANGELOG.md) for what each item changed.

## 🐞 Known issues
- [x] Unmatched maps: 354 → 276 with image-bounds matching confirmed by walls. The rest have no DDB scene with the same name and image shape, or no 5etools map; see "Known limitations".
- [x] Differently cropped player maps are matched against DDB scenes directly (13 more with data).
- [x] Walls past the map image are trimmed to it.
- [x] NPC matching: plurals, and the book's own aliases ("Prince Livid" → Gray Ooze).

## 🧪 Quality
- [x] Unit tests for creature resolution, wall clipping, player transforms and wall registration.
- [x] CI lints and tests only `_node/ddb-import/`; upstream files stay untouched.
- [x] Generated data validates: `build.js` adds `flags` to the schema before `npm run test:data`.

## ⚙️ CI
- [x] Lint + unit tests on pull requests (`ddb-ci.yml`) and before every build (`ddb-sync.yml`).
- [x] `ddb-sync` accepts `ddb_ref` / `vet_ref`; each `generated` commit records the refs it was built from.

## ℹ️ Known limitations
- Maps whose DDB scene has another name or image shape (another crop, a combined map) stay unmatched: matching them needs wall registration, which fails when the two wall sets differ too much. `ddb-import-report.json` on `generated` lists them with their best candidate.
- Curse of Strahd's Castle Ravenloft maps ("Map 2–6", "Map 11 & 12") have no DDB data to copy; their player versions only get a chapter folder.
