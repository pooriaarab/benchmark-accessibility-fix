# Accessibility Fix provenance

This file is generated from the benchmark definition.

## Synthetic accessibility fixtures

- Kind: `synthetic`
- URL: https://github.com/pooriaarab/benchmark-accessibility-fix/blob/main/scripts/gen-tasks.mjs
- Licence: `MIT`
- Retrieved: 2026-10-16T00:00:00.000Z
- How to get it: Run `npm run generate:tasks` (or `node scripts/gen-tasks.mjs --seed 20261015` after `npm run build`) from the repository root. The generator grades every reference page with the built package and re-draws until it scores 1. A hidden split uses another seed: `node scripts/gen-tasks.mjs --seed <n> --split hidden --out <path>`; hidden files use a11yh- ids and stay out of git and npm.
- Contamination notes: Public tasks use seed 20261015. Treat them as possibly in training data; use a separately seeded hidden split for final comparisons.
- Refresh: Change the seed, run the generator, and review the JSONL diff.
