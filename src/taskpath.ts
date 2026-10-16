// Resolves a caller-supplied task file for the HTTP API and the MCP
// server. A path is allowed when it lands inside the package directory
// (for example the bundled data/tasks.jsonl) or inside a directory named
// in the A11Y_TASK_DIRS environment allow-list (colon-separated).
import { accessSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const inside = (dir: string, file: string): boolean =>
  file === dir || file.startsWith(dir.endsWith(sep) ? dir : dir + sep);

function allowDirs(env: string | undefined): string[] {
  return (env ?? "").split(":").map((d) => d.trim()).filter(Boolean).map((d) => resolve(d));
}

const readEnv = (name: string): string | undefined =>
  typeof process !== "undefined" ? process.env[name] : undefined;

// Absolute path of a task file the caller may read, or null. Relative
// paths resolve against the package root first, then each allow-listed
// directory. The file must exist and be readable.
export function resolveTasksPath(requested: string, env: string | undefined = readEnv("A11Y_TASK_DIRS")): string | null {
  const trimmed = requested.trim();
  if (trimmed === "" || trimmed.includes("\0")) return null;
  const dirs = allowDirs(env);
  const candidates = isAbsolute(trimmed)
    ? [trimmed]
    : [resolve(PKG_ROOT, trimmed), ...dirs.map((d) => resolve(d, trimmed))];
  for (const file of candidates.map((c) => resolve(c))) {
    if (!inside(PKG_ROOT, file) && !dirs.some((d) => inside(d, file))) continue;
    try {
      accessSync(file);
      return file;
    } catch {
      continue;
    }
  }
  return null;
}

// A task file the server operator picked through A11Y_TASKS (MCP) or the
// CLI --tasks flag takes any readable path; the allow-list only bounds
// paths that arrive over the wire.
export function envTasksPath(): string | undefined {
  const v = readEnv("A11Y_TASKS");
  return v !== undefined && v.trim() !== "" ? v : undefined;
}
