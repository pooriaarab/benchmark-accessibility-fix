# Working on benchmark-accessibility-fix

## Commands

- Install with `npm ci`.
- Run the full gate with `npm run ci:local`.
- Generate tasks with `npm run generate:tasks`.
- Generate provenance after building with `npm run provenance`.
- Add no unit tests. Extend `scripts/e2e.mjs` through a public surface.

## Contracts

Keep tasks, deterministic grading, and provenance in sync. All tasks here are single-turn HTML repairs graded by `src/a11y.ts`; the failure modes in `docs/grading.md` are written before the grader code. Hidden splits stay in `artifacts/` and out of git and npm.

Never read provider keys from repository files. OpenRouter uses `OPENROUTER_API_KEY`. OpenAI-compatible providers use `OPENAI_BASE_URL` and `OPENAI_API_KEY`.

Open an issue before a branch. Use `bacf-<issue>-<slug>` and `[BACF-<issue>] Imperative subject` (uppercase tag). Keep pull requests below 500 counted lines. Do not merge your own pull request or push `release`.
