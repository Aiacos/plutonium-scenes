# Security Policy

Covers this fork's additions: the DDB generator (`_node/ddb-import/`), the `ddb-sync` workflow and the `generated` branch. Issues in upstream data belong to [TheGiddyLimit/plutonium-scenes](https://github.com/TheGiddyLimit/plutonium-scenes).

## 📦 Supported versions

Only the current `generated` branch, rebuilt daily from `main`.

## 🔒 Reporting a vulnerability

Report privately through GitHub: **Security → Report a vulnerability** on [Aiacos/plutonium-scenes](https://github.com/Aiacos/plutonium-scenes/security/advisories/new). Please do not open a public issue.

## 🛡️ Security model

- [x] `generated` holds data only (`data/`, the build report and a README). Plutonium and the companion module read it as JSON; nothing in it is executed.
- [x] The workflow runs with `contents: write` only, on `Aiacos/plutonium-scenes` only, and never pushes upstream's merge.
- [x] Inputs come from three public repositories: TheGiddyLimit/plutonium-scenes, MrPrimate/ddb-meta-data, 5etools-mirror-3/5etools-src. The generator only reads their JSON.
- [x] The generator is linted and unit-tested before every build and on pull requests.
- [x] Commits are scanned by a gitleaks pre-commit hook.

## ⚠️ Trust boundary

Each scheduled build trusts the latest commit of its three inputs. A compromised input could change walls, lights or creature placements on imported scenes, but not run code. Every `generated` commit records the `ddb_ref` / `vet_ref` it was built from; to roll back, re-run `ddb-sync` with earlier refs.
