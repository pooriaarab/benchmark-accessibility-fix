// Report enrichment: benchmark-core's RunReport rows carry only score and
// reason, so the per-task grading details (tier, defectsFixed,
// regressions, contentLost) are re-derived here and aggregated per tier.
// Re-grading is deterministic and cheap (static analysis, no model calls).
import type { Benchmark, JsonValue, RunReport, RunRow, Task } from "benchmark-core";

export interface ReportRow extends RunRow {
  details: Record<string, JsonValue>;
}

export interface TierTotals {
  tasks: number;
  solved: number;
  mean: number;
  defectsFixed: number;
  defectsTotal: number;
  regressions: number;
  contentLost: number;
}

export interface EnrichedReport extends Omit<RunReport, "rows" | "totals"> {
  rows: ReportRow[];
  totals: RunReport["totals"] & {
    defectsFixed: number;
    defectsTotal: number;
    regressions: number;
    contentLost: number;
  };
  tiers: Record<string, TierTotals>;
}

const asDetails = (value: JsonValue | undefined): Record<string, JsonValue> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, JsonValue>
    : {};

export async function enrichReport(bench: Benchmark<Task>, report: RunReport): Promise<EnrichedReport> {
  const tasksById = new Map((await bench.listTasks()).map((t) => [t.id, t]));
  const rows: ReportRow[] = [];
  for (const row of report.rows) {
    const task = tasksById.get(row.taskId);
    let details: Record<string, JsonValue> = {};
    if (task !== undefined && row.submission !== undefined) {
      const grade = await bench.score(task, row.submission, { seed: report.seed });
      details = asDetails(grade.details);
    }
    const tier = task?.metadata?.["tier"];
    if (typeof tier === "string" && details["tier"] === undefined) details = { ...details, tier };
    rows.push({ ...row, details });
  }
  const tiers: Record<string, TierTotals> = {};
  const empty = (): TierTotals => ({ tasks: 0, solved: 0, mean: 0, defectsFixed: 0, defectsTotal: 0, regressions: 0, contentLost: 0 });
  const totals = { defectsFixed: 0, defectsTotal: 0, regressions: 0, contentLost: 0 };
  for (const row of rows) {
    const tier = typeof row.details["tier"] === "string" ? row.details["tier"] : "all";
    const t = tiers[tier] ??= empty();
    const d = row.details;
    const defectsFixed = Number(d["defectsFixed"] ?? 0);
    const defectsTotal = Number(d["defectsTotal"] ?? 0);
    const regressions = Number(d["regressions"] ?? 0);
    const lost = d["contentLost"] === true ? 1 : 0;
    t.tasks += 1;
    t.solved += row.score === 1 ? 1 : 0;
    t.mean += row.score;
    t.defectsFixed += defectsFixed;
    t.defectsTotal += defectsTotal;
    t.regressions += regressions;
    t.contentLost += lost;
    totals.defectsFixed += defectsFixed;
    totals.defectsTotal += defectsTotal;
    totals.regressions += regressions;
    totals.contentLost += lost;
  }
  for (const t of Object.values(tiers)) t.mean = Math.round((t.mean / Math.max(1, t.tasks)) * 1000) / 1000;
  return { ...report, rows, totals: { ...report.totals, ...totals }, tiers };
}

// Markdown section appended to the standard report table.
export function renderBreakdown(report: EnrichedReport): string {
  const entries = Object.entries(report.tiers);
  if (entries.length === 0) return "";
  const lines = [
    "",
    "## By tier",
    "",
    "| Tier | Solved | Mean | Defects fixed | Regressions | Content lost |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const [tier, t] of entries) {
    lines.push(`| ${tier} | ${t.solved}/${t.tasks} | ${(t.mean * 100).toFixed(1)}% | ${t.defectsFixed}/${t.defectsTotal} | ${t.regressions} | ${t.contentLost} |`);
  }
  return `${lines.join("\n")}\n`;
}
