# Changelog

Changes to this fork's DDB generator (`_node/ddb-import/`) and the data it publishes on the `generated` branch. Upstream data changes are in [TheGiddyLimit/plutonium-scenes](https://github.com/TheGiddyLimit/plutonium-scenes).

## 2026-11-02 (3)

### Added
- **Creature aliases from the book text**: `{@creature Gray Ooze||Prince Livid}` tags tell which creature a personal name is ("Prince Livid" → Gray Ooze). Names that are creatures themselves are never aliased.
- **Image-bounds matching with walls on both sides**: a DDB scene with the same name and image aspect ratio is matched by its bounds when wall registration fails, if one side's walls land on the other's (≥ 80 % coverage, ≥ 10 walls). Unmatched maps 354 → 276. No earlier match changed.
- **Player maps cropped differently** from their DM map are matched against the DDB scenes directly (13 more player maps with data, e.g. *Waterdeep* Trollskull Alley, *Baldur's Gate* Elfsong Tavern).
- Overall: maps with creatures 770 → 842, with lights 753 → 817, with DDB walls 736 → 747.
- Unit tests (`node --test _node/ddb-import/test/`), and lint + tests in CI before every build and on pull requests.
- `ddb-sync` can be re-run on given `ddb_ref` / `vet_ref` commits; each `generated` commit records the commits it was built from.

### Fixed
- Walls drawn past the map image are trimmed to it (half a grid cell of margin), also on player versions.
- Plural names ("Tribal Warrior Spore Servants") find their statblock.

## 2026-11-02 (2)

### Added
- **Named adventure NPCs**: tokens DDB places with a generic statblock and a personal name resolve to the book's own creature (Danika Martikov → Danika Dorakova, Rose Durst → Rosavalda "Rose" Durst), marked `npc: true`. Matching: exact name or alias, every word, unique first name not used by other books, near-identical spelling; numbers must agree.

## 2026-11-02 (1)

### Added
- **Player versions**: each 5etools player map gets its DM map's lights, walls, creatures and chapter folder, rescaled when the image has another resolution.

### Fixed
- Maps are keyed by exact name, as Plutonium matches them; tag markup is stripped from map titles.
