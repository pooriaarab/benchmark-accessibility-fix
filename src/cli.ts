#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  bootstrapCI, createCli, mockAdapter, openaiCompatAdapter, openrouterAdapter,
  renderMarkdown, run as runCore, serve,
  type Benchmark, type ModelAdapter, type RunOptions, type RunReport, type Task,
} from "benchmark-core";
import { benchmark, makeBenchmark } from "./benchmark.js";
import { makeHandler } from "./api.js";
import { enrichReport, renderBreakdown } from "./report.js";
import { envTasksPath } from "./taskpath.js";
import { startMcp } from "./mcp.js";

// --tasks <path> (or --tasks=<path>) swaps in an alternate task list such
// as a hidden split from scripts/gen-tasks.mjs. Any readable JSONL path is
// accepted; benchmark-core caches tasks per object, so a fresh benchmark
// is built for each invocation.
const argv = process.argv.slice(2);
const clean: string[] = [];
let tasksPath: string | undefined;
let badTasksFlag = false;
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i] ?? "";
  if (arg === "--tasks") {
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) badTasksFlag = true;
    else { tasksPath = value; i += 1; }
  } else if (arg.startsWith("--tasks=")) {
    tasksPath = arg.slice("--tasks=".length);
  } else {
    clean.push(arg);
  }
}

const exit = (code: number, message?: string) => {
  if (message !== undefined) console.error(message);
  process.exitCode = code;
};

const pickAdapter = (provider: string, model: string, seed: number, bench: Benchmark<Task>): ModelAdapter => {
  if (provider === "mock") return mockAdapter({ seed, ...(bench.definition.mockPolicies ? { policies: bench.definition.mockPolicies } : {}) });
  if (provider === "openrouter") return openrouterAdapter({ model });
  if (provider === "openai") return openaiCompatAdapter({ model });
  throw new Error("--provider must be openrouter, openai, or mock.");
};

const asReport = (value: unknown): RunReport => {
  if (value === null || typeof value !== "object" || !Array.isArray(Reflect.get(value, "rows"))) throw new Error("File is not a run report.");
  return value as RunReport;
};

// run and score are re-implemented here (same flags as benchmark-core) so
// the printed report carries grading details and per-tier totals, which
// the stock renderMarkdown drops.
async function runCommand(bench: Benchmark<Task>, args: string[], jsonOutput: boolean): Promise<number> {
  const parsed = parseArgs({
    args, strict: true,
    options: {
      model: { type: "string" }, provider: { type: "string" }, concurrency: { type: "string" },
      timeout: { type: "string" }, retries: { type: "string" }, seed: { type: "string" },
      "max-turns": { type: "string" }, "max-tool-calls": { type: "string" }, budget: { type: "string" },
    },
  });
  const model = parsed.values.model;
  const provider = parsed.values.provider;
  if (!model || !provider) throw new Error("run needs --model and --provider.");
  const seed = Number(parsed.values.seed ?? 1);
  const v = parsed.values;
  const opts: RunOptions = { seed };
  if (v.concurrency !== undefined) opts.concurrency = Number(v.concurrency);
  if (v.timeout !== undefined) opts.timeoutMs = Number(v.timeout);
  if (v.retries !== undefined) opts.retries = Number(v.retries);
  if (v["max-turns"] !== undefined) opts.maxTurns = Number(v["max-turns"]);
  if (v["max-tool-calls"] !== undefined) opts.maxToolCalls = Number(v["max-tool-calls"]);
  if (v.budget !== undefined) opts.budgetUsd = Number(v.budget);
  const report = await runCore(bench, pickAdapter(provider, model, seed, bench), opts);
  const enriched = await enrichReport(bench, report);
  console.log(jsonOutput ? JSON.stringify(enriched) : renderMarkdown(enriched) + renderBreakdown(enriched));
  return report.rows.some((row) => row.error) ? 2 : 0;
}

async function scoreCommand(bench: Benchmark<Task>, args: string[], jsonOutput: boolean): Promise<number> {
  const file = args[0];
  if (!file) throw new Error("score needs a results JSON file.");
  const original = asReport(JSON.parse(await readFile(file, "utf8")));
  const rows = [];
  for (const row of original.rows) {
    const task = await bench.getTask(row.taskId);
    if (!task || row.submission === undefined) throw new Error(`Cannot score task ${row.taskId}.`);
    const grade = await bench.score(task, row.submission, { seed: original.seed });
    rows.push({ ...row, score: grade.score, reason: grade.reason });
  }
  const scores = rows.map((row) => row.score);
  const rescored: RunReport = {
    ...original, rows,
    mean: scores.reduce((a, b) => a + b, 0) / scores.length,
    confidenceInterval95: bootstrapCI(scores, original.seed),
  };
  const enriched = await enrichReport(bench, rescored);
  console.log(jsonOutput ? JSON.stringify(enriched) : renderMarkdown(enriched) + renderBreakdown(enriched));
  return 0;
}

if (badTasksFlag || tasksPath === "") {
  exit(1, "--tasks needs a path to a tasks JSONL file.");
} else {
  try {
    // The flag wins; the A11Y_TASKS environment variable is the
    // operator-level default (so `mcp` and `serve` can be pointed at a
    // hidden split without touching argv).
    const fromEnv = envTasksPath();
    const source = tasksPath ?? fromEnv;
    const bench = source === undefined ? benchmark : makeBenchmark(source);
    if (source !== undefined) await bench.listTasks();
    const command = clean[0];
    const jsonOutput = clean.includes("--json");
    const rest = clean.slice(1).filter((a) => a !== "--json");
    if (command === "run") {
      process.exitCode = await runCommand(bench, rest, jsonOutput);
    } else if (command === "score") {
      process.exitCode = await scoreCommand(bench, rest, jsonOutput);
    } else if (command === "serve") {
      // Served through the local handler so ?tasks= and tasksPath are honored.
      const parsed = parseArgs({ args: rest, options: { host: { type: "string" } }, allowPositionals: true, strict: true });
      if (parsed.positionals.length > 1) throw new Error("serve accepts at most one port.");
      const port = Number(parsed.positionals[0] ?? process.env.PORT ?? 3000);
      const hostname = parsed.values.host ?? "127.0.0.1";
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("serve port must be an integer from 0 to 65535.");
      if (!hostname.trim()) throw new Error("--host must not be empty.");
      await serve(makeHandler(bench), { port, hostname });
      console.log(jsonOutput ? JSON.stringify({ listening: port, host: hostname }) : `Listening on http://${hostname}:${port}`);
      process.exitCode = 0;
    } else if (command === "mcp") {
      // The local MCP server so run_benchmark returns the enriched report.
      await startMcp(bench);
      process.exitCode = 0;
    } else {
      process.exitCode = await createCli(bench, { bin: "benchmark-accessibility-fix" }).main(clean);
    }
  } catch (error) {
    exit(2, error instanceof Error ? error.message : String(error));
  }
}
