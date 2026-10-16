#!/usr/bin/env node
import { parseArgs } from "node:util";
import { createCli, serve } from "benchmark-core";
import { benchmark, makeBenchmark } from "./benchmark.js";
import { makeHandler } from "./api.js";
import { envTasksPath } from "./taskpath.js";

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
    if (clean[0] === "serve") {
      // Served through the local handler so ?tasks= and tasksPath are honored.
      const jsonOutput = clean.includes("--json");
      const parsed = parseArgs({
        args: clean.slice(1).filter((a) => a !== "--json"),
        options: { host: { type: "string" } },
        allowPositionals: true,
        strict: true,
      });
      if (parsed.positionals.length > 1) throw new Error("serve accepts at most one port.");
      const port = Number(parsed.positionals[0] ?? process.env.PORT ?? 3000);
      const hostname = parsed.values.host ?? "127.0.0.1";
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("serve port must be an integer from 0 to 65535.");
      if (!hostname.trim()) throw new Error("--host must not be empty.");
      await serve(makeHandler(bench), { port, hostname });
      console.log(jsonOutput ? JSON.stringify({ listening: port, host: hostname }) : `Listening on http://${hostname}:${port}`);
      process.exitCode = 0;
    } else {
      process.exitCode = await createCli(bench, { bin: "benchmark-accessibility-fix" }).main(clean);
    }
  } catch (error) {
    exit(2, error instanceof Error ? error.message : String(error));
  }
}
