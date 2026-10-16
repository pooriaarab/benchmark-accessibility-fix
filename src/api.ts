import { createHandler, type Benchmark, type Task } from "benchmark-core";
import { benchmark, makeBenchmark } from "./benchmark.js";
import { resolveTasksPath } from "./taskpath.js";

const forbidden = (message: string) =>
  Response.json({ error: { code: "TASKS_PATH", message } }, { status: 403 });

// Alternate task lists arrive as ?tasks=<path> on any route or a
// "tasksPath" field in a JSON POST body. The path must resolve inside the
// package or inside a directory named by the A11Y_TASK_DIRS allow-list.
export function makeHandler(bench: Benchmark<Task> = benchmark): (request: Request) => Promise<Response> {
  const base = createHandler(bench);
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    let requested = url.searchParams.get("tasks");
    let bodyText: string | undefined;
    if (request.method === "POST" || request.method === "PUT") {
      bodyText = await request.text();
      if (requested === null) {
        try {
          const payload: unknown = JSON.parse(bodyText);
          if (payload !== null && typeof payload === "object") {
            const field = Reflect.get(payload, "tasksPath");
            if (typeof field === "string") requested = field;
          }
        } catch {
          // Malformed JSON: forward the raw body so the base handler
          // answers INVALID_JSON itself.
        }
      }
    }
    const forward = bodyText === undefined
      ? request
      : new Request(url, { method: request.method, headers: request.headers, body: bodyText });
    if (requested === null) return base(forward);
    const resolved = resolveTasksPath(requested);
    if (resolved === null) {
      return forbidden("tasks path must point inside the package or an A11Y_TASK_DIRS directory and be readable.");
    }
    return createHandler(makeBenchmark(resolved))(forward);
  };
}

export const handler = makeHandler();
