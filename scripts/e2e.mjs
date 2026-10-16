import assert from "node:assert/strict";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer as createNetServer } from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const execFile = promisify(execFileCallback);

await execFile("npm", ["run", "build"]);
const taskLines = (await readFile("data/tasks.jsonl", "utf8")).trim().split("\n");
const taskCount = taskLines.length;
assert.ok(taskCount >= 40, `expected at least 40 tasks, saw ${taskCount}`);
const firstId = JSON.parse(taskLines[0]).id;
const cli = await execFile(process.execPath, ["dist/cli.js", "run", "--model", "offline", "--provider", "mock", "--json"], { maxBuffer: 10_000_000 });
const report = JSON.parse(cli.stdout);
assert.equal(report.rows.length, taskCount);
assert.ok(report.rows.some((row) => row.score === 1));
assert.ok(report.rows.some((row) => row.score === 0));

// Grader passes through the SDK: the mock's good policy (task.expected)
// must score 1 on every task, while trivial bad answers score 0.
const { benchmark } = await import("../dist/index.js");
const brokenOf = (prompt) => prompt.match(/```html\s*([\s\S]*?)```/)?.[1] ?? "";
const badAnswers = (task) => [
  "",
  "lorem ipsum dolor sit amet consectetur adipiscing elit",
  "Yes, this page is fully accessible and needs no changes.",
  brokenOf(task.prompt),
];
let goodHits = 0;
const tasks = await benchmark.listTasks();
for (const task of tasks) {
  const good = await benchmark.score(task, { answer: task.expected });
  assert.equal(good.score, 1, `${task.id} good answer scored ${good.score}: ${good.reason}`);
  if (good.score === 1) goodHits += 1;
  for (const answer of badAnswers(task)) {
    const bad = await benchmark.score(task, { answer });
    assert.equal(bad.score, 0, `${task.id} bad answer scored ${bad.score}: ${bad.reason}`);
  }
}

// ---- Valid-fix variants (docs/grading.md mode 8) ----
// Every rewrite below is a differently-spelled correct fix and must keep
// scoring 1. Together they exercise the cascade through the public score
// surface: hex/rgb()/hsl()/named/var()/inherit colors, background
// shorthand, source-order overrides, comments, fences, and pseudo-state
// rules that must not leak into the base render.
const hexToRgb = (h) => {
  const n = parseInt(h.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};
const hexToHsl = (h) => {
  const n = parseInt(h.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const mx = Math.max(r, g, b); const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2; const d = mx - mn;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let hh = 0;
  if (d !== 0) hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  hh = Math.round(hh * 60); if (hh < 0) hh += 360;
  return `hsl(${hh}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
};
const inStyles = (html, fn) =>
  html.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi, (m, o, b, c) => o + fn(b) + c);
const VARIANTS = {
  fenced: (h) => `\`\`\`html\n${h}\n\`\`\``,
  collapsedWhitespace: (h) => h.replace(/\n\s*/g, "\n"),
  htmlComments: (h) => h.replace("<body>", "<body>\n<!-- reviewed -->\n")
    .replace("</body>", "<!-- <img src=\"junk.png\"><h4>skip</h4><table><tr><td>x</td></tr></table> -->\n</body>"),
  cssComments: (h) => inStyles(h, (b) => `/* wcag 2.2 */\n${b}`),
  rgbColors: (h) => h.replace(/#[0-9a-fA-F]{6}\b/g, hexToRgb),
  hslColors: (h) => h.replace(/#[0-9a-fA-F]{6}\b/g, hexToHsl),
  namedColor: (h) => inStyles(h, (b) => `${b}\nfooter{color:black}`),
  bgShorthand: (h) => inStyles(h, (b) => b.replace(/background-color:/g, "background:")),
  customProperty: (h) => {
    const m = h.match(/color:\s*(#[0-9a-fA-F]{6})/);
    return m ? inStyles(h, (b) => `${b.replace(m[0], "color:var(--e2e-ink)")}\n:root{--e2e-ink:${m[1]}}`) : null;
  },
  duplicateRules: (h) => inStyles(h, (b) => `${b}/* order */\n${b}`),
  singleQuotes: (h) => h.split(/(<style[\s\S]*?<\/style>)/i)
    .map((p, i) => (i % 2 ? p : p.replace(/="([^"]*)"/g, "='$1'"))).join(""),
  inheritLinks: (h) => inStyles(h, (b) => `${b}\na{color:inherit}`),
  bgInherit: (h) => inStyles(h, (b) => `${b}\nheader{background-color:inherit}`),
  transparentButton: (h) => inStyles(h, (b) => `${b}\nbutton{background:none}`),
  hoverRule: (h) => inStyles(h, (b) => `${b}\na:hover{color:#000000;background-color:#ffff00}`),
};
const variantsPerDefect = new Map();
let variantRuns = 0;
for (const task of tasks) {
  for (const [name, fn] of Object.entries(VARIANTS)) {
    const fixed = fn(task.expected);
    if (fixed === null) continue;
    variantRuns += 1;
    const r = await benchmark.score(task, { answer: fixed });
    assert.equal(r.score, 1, `${task.id} valid variant "${name}" scored ${r.score}: ${r.reason}`);
    for (const d of task.metadata.defects) variantsPerDefect.set(d, (variantsPerDefect.get(d) ?? 0) + 1);
  }
}
assert.equal(variantsPerDefect.size, 10, "variant table did not cover all defect kinds");
for (const [id, n] of variantsPerDefect) {
  assert.ok(n >= 5, `defect ${id} has only ${n} passing valid-fix variants (need >= 5)`);
}
// Large text is graded at 3:1, not 4:5: the generator lands some
// headings in the 3.05-4.5 band, so their fixes must still pass.
assert.ok(tasks.filter((t) => t.expected.includes("big-head")).length >= 5, "no large-text tasks exercised");

// ---- Failure modes 4-9 and cheap tricks (docs/grading.md) ----
// Mode 4: deleting the offender. Removing rendered images and inputs
// drops element counts and auto-zeros.
for (const task of tasks) {
  const removed = task.expected.replace(/<img[^>]*>/g, "").replace(/<input[^>]*>/g, "");
  const r = await benchmark.score(task, { answer: removed });
  assert.equal(r.score, 0, `${task.id} delete-offender scored ${r.score}: ${r.reason}`);
  assert.equal(r.details.elementRemoved, true, `${task.id} elementRemoved not flagged`);
}
// Mode 5: hiding the offender. aria-hidden on body, a main{display:none}
// sheet rule, or the hidden attribute all auto-zero.
for (const task of tasks) {
  const hides = [
    task.expected.replace("<body>", "<body aria-hidden=\"true\">"),
    inStyles(task.expected, (b) => `${b}\nmain{display:none}`),
    task.expected.replace("<body>", "<body hidden>"),
  ];
  for (const [i, hid] of hides.entries()) {
    const r = await benchmark.score(task, { answer: hid });
    assert.equal(r.score, 0, `${task.id} hide variant ${i} scored ${r.score}: ${r.reason}`);
    assert.equal(r.details.autoZero, true, `${task.id} hide variant ${i} not auto-zero`);
  }
}
// A prose mention of the word "hidden" is not a hiding signal.
{
  const r = await benchmark.score(tasks[0], { answer: tasks[0].expected.replace("</main>", "<p>This form has a hidden extra field.</p>\n</main>") });
  assert.equal(r.score, 1, `prose "hidden" scored ${r.score}: ${r.reason}`);
}
// Mode 6: a fresh regression halves the credit. Blanking alt text on a
// task without the missing-alt defect regresses a passing check.
for (const task of tasks.filter((t) => !t.metadata.defects.includes("missing-alt"))) {
  const r = await benchmark.score(task, { answer: task.expected.replace(/alt="[^"]+"/, 'alt=""') });
  assert.ok(r.score < 1 && r.score > 0, `${task.id} regression scored ${r.score}: ${r.reason}`);
  assert.ok(r.details.regressions >= 1, `${task.id} regression not counted`);
}
// Mode 9: a duplicate h1 regresses or still fails the heading check.
for (const task of tasks) {
  const r = await benchmark.score(task, { answer: task.expected.replace("<h1>", "<h1>Extra</h1>\n<h1>") });
  assert.ok(r.score < 1, `${task.id} duplicate-h1 scored ${r.score}: ${r.reason}`);
}
// Cheap tricks must stay below 0.3; each quiets or bypasses a check.
const brokenCache = new Map(tasks.map((t) => [t.id, brokenOf(t.prompt)]));
const TRICKS = [
  ["alt-emptied", (t) => t.metadata.defects.includes("missing-alt"), (t) => t.expected.replace(/alt="[^"]*"/g, 'alt=""')],
  ["img-presentation", (t) => t.metadata.defects.includes("missing-alt"), (t) => t.expected.replace(/(<img [^>]*?)alt="[^"]*"/, '$1role="presentation" alt=""')],
  ["aria-label-spam", (t) => t.metadata.defects.includes("unlabeled-input"), (t) => t.expected.replace(/<label for="[^"]*">[^<]*<\/label>\s*/g, "").replace(/<input /g, '<input aria-label="" ')],
  ["tabindex-minus-one", (t) => t.metadata.defects.includes("tabindex-positive"), (t) => t.expected.replace('<a href="#main">', '<a tabindex="-1" href="#main">')],
  ["outline-none", (t) => t.metadata.defects.includes("no-focus-style"), (t) => t.expected.replace(/outline:\s*3px solid [^;}]+/, "outline: none")],
  ["onclick-stripped", (t) => t.metadata.defects.includes("div-button"), (t) => brokenCache.get(t.id).replace(/ onclick="[^"]*"/g, "")],
  ["styles-deleted", () => true, (t) => t.expected.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/ style="[^"]*"/g, "")],
  ["content-deleted", () => true, (t) => t.expected.replace(/<main[\s\S]*?<\/main>/, "<main><p>done</p></main>")],
];
let trickRuns = 0;
for (const [name, applies, fn] of TRICKS) {
  for (const task of tasks.filter(applies)) {
    const r = await benchmark.score(task, { answer: fn(task) });
    trickRuns += 1;
    assert.ok(r.score < 0.3, `${task.id} trick "${name}" scored ${r.score}: ${r.reason}`);
  }
}

// ---- Hidden split: public reference pages must not transfer ----
// Regenerate with a private seed; hidden ids use the a11yh- prefix and
// the pages differ per seed, so a public fix scores below 1 on each.
const gen = await execFile(process.execPath, ["scripts/gen-tasks.mjs", "--seed", "777", "--split", "hidden", "--out", "artifacts/tasks.hidden.jsonl"]);
const fingerprints = Number(gen.stdout.match(/fingerprints: (\d+)/)?.[1]);
assert.ok(fingerprints >= 30, `only ${fingerprints} distinct hidden pages`);
const hidden = (await readFile("artifacts/tasks.hidden.jsonl", "utf8")).trim().split("\n").map((l) => JSON.parse(l));
assert.equal(hidden.length, taskCount);
assert.ok(hidden.every((t) => /^a11yh-\d+$/.test(t.id)), "hidden split lost its a11yh- id prefix");
assert.ok(hidden.every((t) => t.metadata.split === "hidden"));
const tiers = new Set([...tasks, ...hidden].map((t) => t.metadata.tier));
assert.ok(tiers.has("easy") && tiers.has("hard"), `expected easy and hard tiers, saw ${[...tiers]}`);
let leaked = 0;
for (const [i, h] of hidden.entries()) {
  const r = await benchmark.score(h, { answer: tasks[i % tasks.length].expected });
  assert.ok(r.score < 1, `public reference scored ${r.score} on hidden ${h.id}`);
  if (r.score === 1) leaked += 1;
}

const probe = createNetServer();
await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
const address = probe.address(); assert.ok(address && typeof address === "object");
await new Promise((resolve) => probe.close(resolve));
const server = spawn(process.execPath, ["dist/cli.js", "serve", String(address.port)], { stdio: ["ignore", "pipe", "pipe"] });
const base = `http://127.0.0.1:${address.port}`; const routes = {};
async function get(path) {
  const response = await fetch(`${base}${path}`); routes[`GET ${path}`] = response.status;
  return { response, value: await response.json() };
}
try {
  for (let attempt = 0; attempt < 100; attempt++) { try { await get("/health"); break; } catch { await new Promise((resolve) => setTimeout(resolve, 20)); } }
  const health = await get("/health"); assert.equal(health.response.status, 200);
  const listed = await get("/v1/tasks"); assert.equal(listed.value.tasks.length, taskCount);
  const shown = await get(`/v1/tasks/${firstId}`); assert.equal(shown.value.task.id, firstId);
  const score = await fetch(`${base}/v1/score`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId: firstId, submission: report.rows[0].submission }) });
  routes["POST /v1/score"] = score.status; assert.equal(score.status, 200);
  assert.equal((await get("/v1/provenance")).response.status, 200);
  assert.equal((await get("/v1/index-entry")).value.task_count, taskCount);
} finally { if (server.exitCode === null) { server.kill("SIGTERM"); await once(server, "exit"); } }

const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/cli.js", "mcp"], cwd: process.cwd(), stderr: "pipe" });
const client = new Client({ name: "benchmark-accessibility-fix-e2e", version: "0.1.0" });
await client.connect(transport); let toolNames;
try {
  const available = await client.listTools(); toolNames = available.tools.map((tool) => tool.name).sort();
  assert.deepEqual(toolNames, ["get_provenance", "get_task", "list_tasks", "run_benchmark", "score_answer"]);
  const calls = [
    ["list_tasks", {}], ["get_task", { taskId: firstId }],
    ["score_answer", { taskId: firstId, submission: report.rows[0].submission }],
    ["get_provenance", {}], ["run_benchmark", { model: "offline" }],
  ];
  for (const [name, args] of calls) {
    const result = await client.callTool({ name, arguments: args });
    if (name === "run_benchmark") assert.equal(result.isError, true); else assert.notEqual(result.isError, true);
  }
} finally { await client.close(); }

const artifact = { task_count: report.rows.length, scores: report.rows.map((row) => row.score), route_status_codes: routes, tool_names: toolNames, grader: { good_scored_1: goodHits, bad_scored_0: taskCount * 4, valid_variants: variantRuns, defect_kinds: variantsPerDefect.size, tricks_below_03: trickRuns, hidden_tasks: hidden.length, hidden_leak: leaked } };
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/e2e-report.json", `${JSON.stringify(artifact, null, 2)}\n`);
assert.match(await readFile("data/PROVENANCE.md", "utf8"), /Synthetic accessibility fixtures/);
console.log(`e2e: ${artifact.task_count} tasks, ${variantRuns} variants, ${trickRuns} tricks, ${hidden.length} hidden, ${Object.keys(routes).length} routes, ${toolNames.length} tools -> all surfaces passed, ok`);
