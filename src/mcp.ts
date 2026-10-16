import {
  MAX_TOOL_LOG_ENTRIES, openrouterAdapter, run as runCore,
  type Benchmark, type Task,
} from "benchmark-core";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { benchmark, makeBenchmark } from "./benchmark.js";
import { enrichReport } from "./report.js";
import { envTasksPath } from "./taskpath.js";

// Same five tools as benchmark-core's server; run_benchmark returns the
// enriched report (per-row details, per-tier totals) and score_answer
// already carries details. The server operator can point the whole
// surface at an alternate task list with the A11Y_TASKS environment
// variable, or pass --tasks <path> to the `mcp` CLI command.
const tools = [
  { name: "list_tasks", description: "List benchmark tasks.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "get_task", description: "Get one benchmark task by id.", inputSchema: { type: "object", properties: { taskId: { type: "string" } }, required: ["taskId"], additionalProperties: false } },
  { name: "score_answer", description: "Score a trace with the deterministic benchmark grader.", inputSchema: { type: "object", properties: { taskId: { type: "string" }, submission: { type: "object" }, seed: { type: "number" } }, required: ["taskId", "submission"], additionalProperties: false } },
  { name: "run_benchmark", description: "Run every task through an OpenRouter model.", inputSchema: { type: "object", properties: { model: { type: "string" } }, required: ["model"], additionalProperties: false } },
  { name: "get_provenance", description: "Get benchmark data provenance.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
];

const content = (value: unknown, isError = false) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
  ...(isError ? { isError: true } : {}),
});
const toolArgs = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function createMcpServer(bench: Benchmark<Task> = defaultBench()): Server {
  const server = new Server(
    { name: bench.definition.id, version: bench.definition.version },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const input = toolArgs(request.params.arguments);
      if (request.params.name === "list_tasks") return content({ tasks: await bench.listTasks() });
      if (request.params.name === "get_task") {
        if (typeof input["taskId"] !== "string") return content({ error: "taskId is required." }, true);
        const task = await bench.getTask(input["taskId"]);
        return task ? content({ task }) : content({ error: "Task not found." }, true);
      }
      if (request.params.name === "score_answer") {
        if (typeof input["taskId"] !== "string" || !input["submission"] || typeof input["submission"] !== "object" || Array.isArray(input["submission"])) {
          return content({ error: "taskId and submission are required." }, true);
        }
        const log = Reflect.get(input["submission"], "toolLog");
        if (Array.isArray(log) && log.length > MAX_TOOL_LOG_ENTRIES) return content({ error: `toolLog may not exceed ${MAX_TOOL_LOG_ENTRIES} entries.` }, true);
        const task = await bench.getTask(input["taskId"]);
        if (!task) return content({ error: "Task not found." }, true);
        const result = await bench.score(task, input["submission"] as never, typeof input["seed"] === "number" ? { seed: input["seed"] } : {});
        return content({ taskId: task.id, ...result });
      }
      if (request.params.name === "run_benchmark") {
        if (typeof input["model"] !== "string") return content({ error: "model is required." }, true);
        if (!process.env.OPENROUTER_API_KEY) return content({ error: "OPENROUTER_API_KEY is required to run a benchmark." }, true);
        return content(await enrichReport(bench, await runCore(bench, openrouterAdapter({ model: input["model"] }))));
      }
      if (request.params.name === "get_provenance") return content({ provenance: bench.definition.provenance });
      return content({ error: `Unknown tool: ${request.params.name}` }, true);
    } catch (caught) {
      return content({ error: caught instanceof Error ? caught.message : "Unknown error." }, true);
    }
  });
  return server;
}

function defaultBench(): Benchmark<Task> {
  const path = envTasksPath();
  return path === undefined ? benchmark : makeBenchmark(path);
}

export const startMcp = async (bench?: Benchmark<Task>): Promise<void> => {
  await createMcpServer(bench ?? defaultBench()).connect(new StdioServerTransport());
};
