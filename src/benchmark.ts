import { readFile } from "node:fs/promises";
import { defineBenchmark, type JsonValue, type Task, type Trace } from "benchmark-core";
import { analyze, CHECK_IDS, extractHtml, NEEDS_TARGETS, type CheckId } from "./a11y.js";

async function loadTasks(): Promise<Task[]> {
  const text = await readFile(new URL("../data/tasks.jsonl", import.meta.url), "utf8");
  return text.trim().split("\n").map((line) => JSON.parse(line) as Task);
}

function isCheckId(value: unknown): value is CheckId {
  return typeof value === "string" && (CHECK_IDS as readonly string[]).includes(value);
}

function injectedDefects(task: Task): CheckId[] {
  const defects = (task.metadata as Record<string, JsonValue> | undefined)?.["defects"];
  if (Array.isArray(defects)) {
    const ids = defects.filter(isCheckId);
    if (ids.length > 0) return [...new Set(ids)];
  }
  // Fall back to whatever fails on the shipped page when metadata is absent.
  const broken = analyze(extractHtml(task.prompt));
  return broken.checks.filter((c) => !c.pass).map((c) => c.id);
}

function recall(brokenWords: string[], fixedWords: string[]): number {
  if (brokenWords.length === 0) return 1;
  const have = new Map<string, number>();
  for (const word of fixedWords) have.set(word, (have.get(word) ?? 0) + 1);
  let kept = 0;
  for (const word of brokenWords) {
    const left = have.get(word) ?? 0;
    if (left > 0) {
      kept += 1;
      have.set(word, left - 1);
    }
  }
  return kept / brokenWords.length;
}

export function gradeAnswer(task: Task, submission: Trace): { score: number; reason: string; details: Record<string, JsonValue> } {
  const answer = submission.answer;
  if (answer === undefined || answer.trim() === "") {
    return { score: 0, reason: "Submission has no answer.", details: { defectsFixed: 0, regressions: 0, contentLost: true, autoZero: true } };
  }
  const defects = injectedDefects(task);
  const brokenHtml = extractHtml(task.prompt);
  const fixedHtml = extractHtml(answer);
  const broken = analyze(brokenHtml);
  const fixed = analyze(fixedHtml);
  const byId = (checks: ReturnType<typeof analyze>["checks"], id: CheckId) => checks.find((c) => c.id === id);
  const fixedIds = defects.filter((id) => {
    const check = byId(fixed.checks, id);
    return check !== undefined && check.pass && (!NEEDS_TARGETS.has(id) || check.targets > 0);
  });
  const regressions = CHECK_IDS.filter((id) => byId(broken.checks, id)?.pass === true && byId(fixed.checks, id)?.pass !== true);
  const contentRatio = recall(broken.words, fixed.words);
  const contentLost = contentRatio < 0.9;
  const keys = Object.keys(broken.counts) as (keyof typeof broken.counts)[];
  const elementRemoved = keys.some((key) => fixed.counts[key] < broken.counts[key]);
  const hideAbuse = fixed.hideCount > broken.hideCount;
  // A defect that still fails counts as silenced when the answer carries a
  // quieting gesture (empty alt, empty aria-label, negating focus rule)
  // rather than a repair.
  const silenced = defects.filter((id) => {
    const check = byId(fixed.checks, id);
    const stillFails = check === undefined || !check.pass || (NEEDS_TARGETS.has(id) && check.targets === 0);
    return stillFails && check !== undefined && check.silenced;
  });
  // Dropping every stylesheet and every inline style deletes the page's
  // styling outright; contrast passing by default is not a repair.
  const hadStyle = /<style[\s>]/i.test(brokenHtml) || /\bstyle\s*=/i.test(brokenHtml);
  const stylesDeleted = hadStyle && !/<style[\s>]/i.test(fixedHtml) && !/\bstyle\s*=/i.test(fixedHtml);
  const causes = [
    contentLost ? "content lost" : null,
    elementRemoved ? "element removed" : null,
    hideAbuse ? "content hidden" : null,
    stylesDeleted ? "styles deleted" : null,
    silenced.length ? `silenced ${silenced.join(",")}` : null,
  ].filter((c): c is string => c !== null);
  const autoZero = causes.length > 0;
  const raw = (fixedIds.length - 0.5 * regressions.length) / Math.max(1, defects.length);
  const score = autoZero ? 0 : Math.min(1, Math.max(0, raw));
  const tier = (task.metadata as Record<string, JsonValue> | undefined)?.["tier"];
  let reason = `Fixed ${fixedIds.length}/${defects.length} defects; ${regressions.length} regressions; text kept ${(contentRatio * 100).toFixed(0)}%.`;
  if (autoZero) reason += ` Auto-zero: ${causes.join("; ")}.`;
  if (typeof tier === "string") reason += ` Tier: ${tier}.`;
  return {
    score,
    reason,
    details: {
      defectsFixed: fixedIds.length,
      defectsTotal: defects.length,
      regressions: regressions.length,
      regressionIds: regressions,
      contentLost,
      contentRatio: Math.round(contentRatio * 1000) / 1000,
      hideAbuse,
      elementRemoved,
      stylesDeleted,
      silenced,
      autoZero,
      ...(typeof tier === "string" ? { tier } : {}),
    },
  };
}

export const benchmark = defineBenchmark({
  id: "benchmark-accessibility-fix", name: "Accessibility Fix", tagline: "Fix a broken page so keyboard, screen-reader and contrast checks pass.", tags: ["helpful"], category: "coding",
  whatItMeasures: "Whether a fixed HTML page really repairs injected keyboard, screen-reader, and contrast defects without deleting or hiding content.", version: "0.1.0", status: "alpha", loadTasks,
  async grade(task, submission) {
    return gradeAnswer(task, submission);
  },
  provenance: [{
    name: "Synthetic accessibility fixtures", kind: "synthetic", url: "https://github.com/pooriaarab/benchmark-accessibility-fix/blob/main/scripts/gen-tasks.mjs",
    licence: "MIT", howToGet: "Run `node scripts/gen-tasks.mjs --seed 20261015` from the repository root. A hidden split uses another seed: `node scripts/gen-tasks.mjs --seed <n> --split hidden --out <path>`; hidden files stay out of git and npm.", retrievedAt: "2026-10-16T00:00:00.000Z",
    contaminationNotes: "Public tasks use seed 20261015. Treat them as possibly in training data; use a separately seeded hidden split for final comparisons.",
    refresh: "Change the seed, run the generator, and review the JSONL diff.",
  }],
  gradingMethod: "Deterministic static analysis of the fixed HTML: ten WCAG-cited checks score defects fixed, minus regressions, content loss, element removal, and hiding abuse. Model judging is off.",
});
