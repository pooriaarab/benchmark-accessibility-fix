import { createMcpServer as create, startMcp as start } from "benchmark-core";
import { benchmark, makeBenchmark } from "./benchmark.js";
import { envTasksPath } from "./taskpath.js";

// The server operator can point the whole MCP surface at an alternate
// task list (for example a hidden split) with the A11Y_TASKS environment
// variable, or pass --tasks <path> to the `mcp` CLI command.
const bench = (() => {
  const path = envTasksPath();
  return path === undefined ? benchmark : makeBenchmark(path);
})();

export const createMcpServer = () => create(bench);
export const startMcp = () => start(bench);
