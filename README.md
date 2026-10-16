# benchmark-accessibility-fix

[![npm](https://img.shields.io/npm/v/benchmark-accessibility-fix)](https://www.npmjs.com/package/benchmark-accessibility-fix) [![downloads](https://img.shields.io/npm/dm/benchmark-accessibility-fix)](https://www.npmjs.com/package/benchmark-accessibility-fix) [![license](https://img.shields.io/npm/l/benchmark-accessibility-fix)](./LICENSE) [![types](https://img.shields.io/badge/TypeScript-types-3178c6)](#sdk)

[AI Benchmark Index](https://private-repo-337e.com/benchmarks/benchmark-accessibility-fix) · [npm](https://www.npmjs.com/package/benchmark-accessibility-fix) · [API](#http-api) · [MCP](#model-context-protocol)

benchmark-accessibility-fix is an open-source AI model benchmark for coding tasks. It measures this behavior: Fix a broken page so keyboard, screen-reader and contrast checks pass.

```bash
npx benchmark-accessibility-fix run --model offline --provider mock --json
```

```json
{"model":"mock:1","mean":0.5,"totals":{"tasks":2,"passed":1,"failed":0}}
```

The starter data comes from a committed seeded generator. Seed 20261015 reproduces the public tasks.

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

A successful run prints two scored rows and a mean of 0.5.

## How it works

```text
tasks.jsonl -> model adapter -> deterministic grader -> report
                         |-> CLI / SDK / MCP / HTTP API
```

The runner keeps task order and records score, reason, latency, retries, usage, and cost when available.

## Why it exists

General model leaderboards do not isolate coding behavior. This package keeps the task data, grading rules, and provenance together for inspection.

## Compare

Checked on 2026-10-15.

| Property | benchmark-accessibility-fix | General chat leaderboard | Ad hoc prompt test |
| --- | --- | --- | --- |
| Target | Fix a broken page so keyboard, screen-reader and contrast checks pass. | Broad model quality | One local example |
| Grading | Deterministic code | Varies | Manual |
| Offline run | Mock provider | Varies | Varies |
| Provenance | Package record | Varies | Usually absent |

## Coverage

| Surface | Status |
| --- | --- |
| single tasks | Included |
| SDK | Included |
| CLI | Included |
| MCP server | Included |
| HTTP API | Included |

The E2E gate checks every listed surface against the package source.

## Common use cases

1. **Model developers:** compare adapters with the same seeded tasks.
2. **Agent developers:** inspect task-level failures before changing prompts.
3. **Release teams:** run the mock gate before publishing a data update.
4. **Researchers:** export per-task scores for a reproducible analysis.

## Features

- **Deterministic grading:** Each row includes a score and reason.
- **Reproducible data:** A committed seeded script creates the public tasks.
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

`data/tasks.jsonl` contains the public tasks. `data/PROVENANCE.md` names the generator, seed, licence, cutoff, and refresh steps. Run `npm run generate:tasks` to rebuild tasks and `npm run provenance` after a build.

## Limits

The starter tasks prove package wiring, not model quality. Replace them before publishing a real benchmark. Public tasks can enter training data. Keep a separately seeded hidden split for final comparisons. Remote providers can add cost and retain prompts under their own policies.

## Integration guides

- [TypeScript SDK integration](#sdk)
- [Model Context Protocol integration](#model-context-protocol)
- [HTTP API integration](#http-api)

## Status

Version 0.1.0 is alpha. Task schemas and grading may change before 1.0. Report defects through the GitHub issue tracker. Public case studies are not yet published.

## FAQ

### What does benchmark-accessibility-fix measure?

benchmark-accessibility-fix measures this behavior: Fix a broken page so keyboard, screen-reader and contrast checks pass. The committed grader defines the exact pass conditions.

### Can benchmark-accessibility-fix run offline?

benchmark-accessibility-fix runs end to end with the mock provider and no key. Real model runs need a configured provider.

### Which providers work?

benchmark-accessibility-fix supports OpenRouter, an OpenAI-compatible base URL, and the offline mock adapter through benchmark-core.

### Does benchmark-accessibility-fix provide a hosted service?

benchmark-accessibility-fix provides a server you run. It does not provide a managed benchmark service.

### Where do the tasks come from?

benchmark-accessibility-fix ships seeded synthetic starter tasks. The provenance file explains how to reproduce and refresh them.

### How are answers graded?

benchmark-accessibility-fix uses exact match for single answers and simulator replay for episode traces. Model judging is off.

### How is this different from a general leaderboard?

benchmark-accessibility-fix measures one named behavior with inspectable tasks and grading. General leaderboards combine broader capabilities.

### Can I use a hidden split?

benchmark-accessibility-fix supports the same schema for public and hidden tasks. Keep hidden data outside the npm package and public repository.

## License

[MIT](LICENSE) © Pooria Arab
