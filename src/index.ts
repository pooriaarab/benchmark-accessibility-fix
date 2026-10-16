import { run as runBenchmark, type ModelAdapter, type RunOptions, type Trace } from "benchmark-core";
import { benchmark, makeBenchmark } from "./benchmark.js";
export { benchmark, makeBenchmark };

export interface AccessibilityFixRunOptions extends RunOptions {
  // Path to an alternate tasks JSONL (for example a hidden split from
  // scripts/gen-tasks.mjs). Each run builds a fresh benchmark object, so
  // alternating paths in one process never reuses a cached task list.
  tasksPath?: string;
}

export const run = (adapter: ModelAdapter, options?: AccessibilityFixRunOptions) => {
  const { tasksPath, ...rest } = options ?? {};
  return runBenchmark(tasksPath === undefined ? benchmark : makeBenchmark(tasksPath), adapter, rest);
};

export async function score(taskId: string, submission: Trace, options?: { tasksPath?: string }) {
  const bench = options?.tasksPath === undefined ? benchmark : makeBenchmark(options.tasksPath);
  const task = await bench.getTask(taskId); if (!task) throw new Error(`Task not found: ${taskId}`);
  return bench.score(task, submission);
}
