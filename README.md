# benchmark-accessibility-fix

[![npm](https://img.shields.io/npm/v/benchmark-accessibility-fix)](https://www.npmjs.com/package/benchmark-accessibility-fix) [![downloads](https://img.shields.io/npm/dm/benchmark-accessibility-fix)](https://www.npmjs.com/package/benchmark-accessibility-fix) [![license](https://img.shields.io/npm/l/benchmark-accessibility-fix)](./LICENSE) [![types](https://img.shields.io/badge/TypeScript-types-3178c6)](#sdk)

[AI Benchmark Index](https://private-repo-337e.com/benchmarks/benchmark-accessibility-fix) · [npm](https://www.npmjs.com/package/benchmark-accessibility-fix) · [API](#http-api) · [MCP](#model-context-protocol)

benchmark-accessibility-fix measures whether a model can repair a broken
web page so keyboard, screen-reader, and contrast checks pass — and whether
the repair is genuine rather than deleted or hidden content.

```bash
npx benchmark-accessibility-fix run --model offline --provider mock
```

```text
# Accessibility Fix

- Model: `mock:1`
- Score: **50.0%**
- 95% CI: 35.0%–65.0%
- Tasks: 40

| Task | Score | Reason |
| --- | ---: | --- |
| a11y-02 | 100.0% | Fixed 3/3 defects; 0 regressions; text kept 100%. |
| a11y-04 | 100.0% | Fixed 2/2 defects; 0 regressions; text kept 100%. |
| a11y-01 | 0.0% | Fixed 1/2 defects; 3 regressions; text kept 0%. |
```

The mock provider needs no key. It answers half the tasks with the
reference fix and half with garbage, so a 50% mock score means the grader
sees both outcomes. The table above is excerpted from a real mock run.

The 40 public tasks are synthetic fixtures built by
`scripts/gen-tasks.mjs` (seed 20261015). Page text, section order, class
names, and colors are randomized per seed, so no two tasks share a page.
Each task carries two to five seeded defects: two or three on `easy`
tasks, three to five on `hard` ones. Defect kinds: missing alt text,
unlabeled inputs, low contrast, broken heading order, positive
`tabindex`, a `div` used as a button, a missing `lang` attribute, no
visible focus style, an empty link, or a table without headers. A
separately seeded hidden split uses `a11yh-` ids and never enters git.

## Install

benchmark-accessibility-fix requires Node.js 20 or newer.

```bash
npm install benchmark-accessibility-fix
```

## Run your first benchmark

The mock provider needs no key or network access.

```bash
npx benchmark-accessibility-fix run --model offline --provider mock
```

To run a real model through OpenRouter:

```bash
export OPENROUTER_API_KEY=...
npx benchmark-accessibility-fix run --model "anthropic/claude-sonnet-4" --provider openrouter
```

An OpenAI-compatible endpoint works the same way with `OPENAI_BASE_URL`
and `OPENAI_API_KEY` plus `--provider openai`. Never put keys in repo
files; the runners read them from the environment only.

## How it works

```text
tasks.jsonl -> model adapter -> static analyzer grader -> report
                         |-> CLI / SDK / MCP / HTTP API
```

Each task hands the model a broken HTML page and asks for the complete
fixed document. The grader parses the answer with a dependency-free
analyzer: ten checks, each tied to one WCAG 2.2 criterion by number
(1.1.1, 1.3.1, 1.4.3, 2.1.1 family, 2.4.3, 2.4.4, 2.4.7, 3.1.1, 3.3.2,
4.1.2). See [docs/grading.md](./docs/grading.md) for the full table and
the failure modes it was written against.

## How to read the score

A task scores 1 when every injected defect passes in the fixed page.
Fixing one of three defects earns about a third of the points. The
grader subtracts for three kinds of cheating: regressions in checks that
used to pass, deleted text or removed elements, and newly hidden content
(`display: none`, `visibility: hidden`, `aria-hidden`). The per-task
`details` object reports `defectsFixed`, `regressions`, and
`contentLost` separately, so a low score tells you which behavior broke.
The report mean comes with a bootstrap 95% confidence interval.

There is no public leaderboard yet. Until real models are run and
published, the only reference number is the mock's 50%.

## Why it exists

Automated checkers flag accessibility problems; this benchmark asks the
harder question of whether a model fixes them. A fix that deletes the
image instead of writing alt text silences the checker while making the
page worse. The grader treats removal and hiding as failures, so the
score tracks repaired barriers, not quieted warnings.

Prior art includes axe-core (Deque Systems), the WAVE tool (WebAIM), and
the WCAG guidelines themselves (W3C), which this package cites by
criterion number only. This benchmark differs from a checker: it ships
seeded broken pages, reference fixes, and a grader that verifies the
repair and penalizes gaming, all runnable offline with no browser.

## Compare

Checked on 2026-10-16.

| Property | benchmark-accessibility-fix | General chat leaderboard | Ad hoc prompt test |
| --- | --- | --- | --- |
| Target | Repairing page accessibility barriers | Broad model quality | One local example |
| Grading | Deterministic static analysis | Varies | Manual |
| Anti-gaming | Removal and hiding penalties | Varies | Usually absent |
| Offline run | Mock provider | Varies | Varies |
| Provenance | Package record | Varies | Usually absent |

## Coverage

| Surface | Status |
| --- | --- |
| single tasks | 40 included |
| SDK | Included |
| CLI | Included |
| MCP server | Included |
| HTTP API | Included |

The E2E gate checks every listed surface against the package source. It
also scores every reference fix (each must reach 1) and four trivial
answers per task — empty, random prose, confident non-fix, and the
broken page unchanged — which must all score 0.

## Common use cases

1. **Model developers:** compare adapters with the same seeded tasks.
2. **Agent developers:** inspect `defectsFixed` and `regressions` before changing prompts.
3. **Release teams:** run the mock gate before publishing a data update.
4. **Researchers:** export per-task scores for a reproducible analysis.

## Features

- **Deterministic grading:** Each row includes a score, a reason, and a details object.
- **Reproducible data:** A committed seeded script creates the public tasks and any hidden split.
- **Share cards:** The `card` command writes a 1200×630 SVG.
- **Provenance:** Code and Markdown carry the same source record.

## SDK

```ts
import { benchmark, run, score } from "benchmark-accessibility-fix";
```

`run(adapter, options)` creates a report. `score(taskId, submission)` grades one trace.

## CLI

Commands are `list`, `show`, `run`, `score`, `card`, `provenance`, `index-entry`, `serve`, and `mcp`. Pass `--json` for machine-readable output.

## Model Context Protocol

Start the MCP stdio server:

```bash
npx benchmark-accessibility-fix mcp
```

Tools are `list_tasks`, `get_task`, `score_answer`, `run_benchmark`, and `get_provenance`.

## HTTP API

Import `handler` from `benchmark-accessibility-fix/api`, or run `npx benchmark-accessibility-fix serve`. Routes are `GET /health`, `GET /v1/tasks`, `GET /v1/tasks/:id`, `POST /v1/score`, `GET /v1/provenance`, and `GET /v1/index-entry`.

## Data provenance

`data/tasks.jsonl` contains the 40 public tasks. `data/PROVENANCE.md`
names the generator, seed, licence, cutoff, and refresh steps. Rebuild
with `npm run generate:tasks` and refresh the provenance file with
`npm run provenance` after a build. A hidden split for final
comparisons uses another seed and stays out of git and npm:

```bash
node scripts/gen-tasks.mjs --seed 999 --split hidden --out artifacts/tasks.hidden.jsonl
```

Every surface accepts an alternate task file, so a hidden split runs the
same way as the public one:

- CLI: `--tasks <path>` on any command, for example
  `benchmark-accessibility-fix run --model offline --provider mock --tasks artifacts/tasks.hidden.jsonl`.
  Any readable JSONL path works.
- SDK: `run(adapter, { tasksPath })` or `score(id, submission, { tasksPath })`.
  Each call builds a fresh benchmark object, so alternating paths in one
  process never shares a cached task list.
- HTTP API: `?tasks=<path>` on any route, or a `"tasksPath"` field in the
  `POST /v1/score` body. The path must land inside the package or in a
  directory named by the `A11Y_TASK_DIRS` environment allow-list
  (colon-separated); anything else gets a 403.
- MCP: set `A11Y_TASKS` to the file path before starting the server, or
  pass `--tasks` to the `mcp` command.

The generator ships in the npm package (`scripts/gen-tasks.mjs`), so
`npx` users can build a split without cloning the repo. It contains no
private seed - pick your own.

## Limits

The static analyzer cannot run layout, zoom, or assistive technology,
and it reads only hex and common named colors for contrast. Fixtures
are small synthetic pages, not production sites. Public tasks can enter
training data, so keep a separately seeded hidden split for final
comparisons. Remote providers can add cost and retain prompts under
their own policies.

## Integration guides

- [TypeScript SDK integration](#sdk)
- [Model Context Protocol integration](#model-context-protocol)
- [HTTP API integration](#http-api)

## Status

Version 0.1.0 is alpha. Task schemas and grading may change before 1.0. Report defects through the GitHub issue tracker. Public case studies are not yet published.

## FAQ

### What does benchmark-accessibility-fix measure?

Whether a model repairs injected keyboard, screen-reader, and contrast
defects in a small HTML page without deleting or hiding content. The
committed grader defines the exact pass conditions.

### Can benchmark-accessibility-fix run offline?

Yes. The mock provider runs end to end with no key, and the analyzer
has no dependencies. Real model runs need a configured provider.

### Which providers work?

OpenRouter, an OpenAI-compatible base URL, and the offline mock
adapter through benchmark-core.

### Does benchmark-accessibility-fix provide a hosted service?

No. It provides a server you run. It does not provide a managed
benchmark service.

### Where do the tasks come from?

Seeded synthetic fixtures from `scripts/gen-tasks.mjs`. The provenance
file explains how to reproduce and refresh them, including the hidden
split plan.

### How are answers graded?

Ten deterministic static checks over the fixed HTML, with penalties
for regressions, content loss, element removal, and hiding. Model
judging is off. [docs/grading.md](./docs/grading.md) lists every check
and the gaming attempts it stops.

### How is this different from axe-core?

axe-core finds barriers in a page you give it. This package tests
whether a model removes them: it ships broken pages, reference fixes,
and a grader that verifies the repair instead of trusting the model.

### Can I use a hidden split?

Yes. Generate one with another seed, keep the file outside git, and run
or score against it with `--tasks` / `tasksPath` on any surface. The
public seed is 20261015.

## License

[MIT](LICENSE) © Pooria Arab
