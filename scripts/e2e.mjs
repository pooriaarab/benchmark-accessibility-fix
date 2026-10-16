import assert from "node:assert/strict";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer as createNetServer } from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
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
// Focus rules must draw on a real focusable target: a rule whose base
// selector matches nothing, or that only paints invisible colors, fails
// the check even when every other fix is right.
const FOCUS_RULE = /a:focus-visible,[^{]*\{[^}]*\}/;
const bodyBg = (t) => t.expected.match(/body\{[^}]*background-color:(#[0-9a-fA-F]{6})/)?.[1] ?? "#ffffff";
for (const task of tasks) {
  const variants = [
    ["negating", task.expected.replace(FOCUS_RULE, ":focus{outline:none;background:transparent}")],
    ["no-match", task.expected.replace(FOCUS_RULE, ".nothing:focus{outline:3px solid red}")],
    ["backdrop-color", task.expected.replace(FOCUS_RULE, `a:focus{background-color:${bodyBg(task)}}`)],
    ["transparent-color", task.expected.replace(FOCUS_RULE, "a:focus{outline:2px solid transparent}")],
  ];
  for (const [name, answer] of variants) {
    const r = await benchmark.score(task, { answer });
    assert.ok(r.score < 1, `${task.id} invisible/unmatched focus "${name}" scored ${r.score}: ${r.reason}`);
  }
  // A rule that does reach a control with a real indicator still passes.
  const ok = task.expected.replace(FOCUS_RULE, "a:focus-visible{outline:2px dashed #123456}");
  const good = await benchmark.score(task, { answer: ok });
  assert.equal(good.score, 1, `${task.id} valid focus variant scored ${good.score}: ${good.reason}`);
}
// A role="button" with a keyboard handler but no tabindex cannot take
// focus; adding tabindex="0" completes the repair. Only tasks whose
// broken page divved the CTA qualify: when the defect hit the tab
// widget instead, the CTA is still a real <button> and swapping it for
// a div is a genuine element removal, not a fake-button probe.
for (const task of tasks.filter((t) => t.metadata.defects.includes("div-button") && !brokenOf(t.prompt).includes('type="button"'))) {
  const noTab = task.expected.replace(/<button class="[^"]*" type="button">([^<]*)<\/button>/, '<div role="button" onkeydown="go()">$1</div>');
  const bad = await benchmark.score(task, { answer: noTab });
  assert.ok(bad.score < 1, `${task.id} role+keydown without tabindex scored ${bad.score}: ${bad.reason}`);
  const withTab = task.expected.replace(/<button class="[^"]*" type="button">([^<]*)<\/button>/, '<div role="button" onkeydown="go()" tabindex="0">$1</div>');
  const good = await benchmark.score(task, { answer: withTab });
  assert.equal(good.score, 1, `${task.id} role+keydown+tabindex scored ${good.score}: ${good.reason}`);
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
// Deleted styles still count when a `<style>` tag survives only inside an
// HTML comment or `style=` only in prose - the test reads parsed markup.
{
  const t = tasks[0];
  const gutted = t.expected
    .replace(/<style>[\s\S]*?<\/style>/g, "<!-- <style></style> -->")
    .replace(/ style="[^"]*"/g, "")
    .replace("</main>", "<p>See the style= attribute docs.</p>\n</main>");
  const r = await benchmark.score(t, { answer: gutted });
  assert.equal(r.score, 0, `commented style remnants scored ${r.score}: ${r.reason}`);
  assert.equal(r.details.stylesDeleted, true, "stylesDeleted not flagged with comment remnants");
}
// ---- Visible-information policy ----
// Concealment that does not remove the element from the parsed render -
// clip-path, transform, zero height, tiny font, off-screen position - is
// neither a fix nor a penalty: it cannot rescue a broken page and it does
// not hurt a correct one. Documented in docs/grading.md; the classic
// sr-only pattern relies on the same machinery.
const OFFSCREEN = [
  'p{clip-path:inset(100%)}',
  'p{transform:scale(0)}',
  'p{height:0;overflow:hidden}',
  'p{font-size:1px}',
  'p{position:absolute;left:-9999px}',
];
for (const t of tasks.slice(0, 6)) {
  for (const rule of OFFSCREEN) {
    const hidden = inStyles(t.expected, (b) => `${b}\n${rule}`);
    const good = await benchmark.score(t, { answer: hidden });
    assert.equal(good.score, 1, `${t.id} offscreen "${rule}" on a correct fix scored ${good.score}`);
    const stillBroken = await benchmark.score(t, { answer: inStyles(brokenOf(t.prompt), (b) => `${b}\n${rule}`) });
    assert.equal(stillBroken.score, 0, `${t.id} offscreen "${rule}" rescued a broken page (score ${stillBroken.score})`);
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

// ---- Template-leak tokens never reach the data ----
// A builder or breaker that reads a missing field strings "undefined",
// "NaN", "[object Object]" or "null" into the page (a hard-tier breaker
// once shipped `href="undefined"` on 9 of 13 public tasks). The
// generator throws on these tokens; the gate scans shipped data too.
const JUNK = /\bundefined\b|\bNaN\b|\[object Object\]|\bnull\b/;
for (const t of [...tasks, ...hidden]) {
  assert.ok(!JUNK.test(t.prompt) && !JUNK.test(t.expected), `${t.id} contains a template-leak token`);
}

// ---- Every hidden reference page scores 1 under the grader ----
// A reference page that fails a check caps its own task below 1 (an
// inline span once drew under 4.5:1 against the body background on
// seeds 7 and 91). The generator re-draws until the real grader scores
// it 1; this gate holds that over 25 hidden seeds.
const EXPECTED_SEEDS = [7, 91, ...Array.from({ length: 23 }, (_, i) => i + 100)];
let expectedChecked = 0;
for (const s of EXPECTED_SEEDS) {
  const out = `artifacts/tasks.hidden-${s}.jsonl`;
  await execFile(process.execPath, ["scripts/gen-tasks.mjs", "--seed", String(s), "--split", "hidden", "--out", out]);
  const list = (await readFile(out, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
  for (const t of list) {
    assert.ok(!JUNK.test(t.prompt) && !JUNK.test(t.expected), `${t.id} (seed ${s}) contains a template-leak token`);
    const r = await benchmark.score(t, { answer: t.expected });
    assert.equal(r.score, 1, `seed ${s} ${t.id} expected scored ${r.score}: ${r.reason}`);
    expectedChecked += 1;
  }
}

// ---- Hard tier is structurally different ----
// A template-aware regex fixer that repairs every easy task must score
// clearly below 1 on hard tasks: the hard skeleton carries defects a
// template fixer cannot see (dangling name chains, Tab traps, nested
// controls, widgets hidden from AT, spanning-header tables).
const regexFix = (html) => {
  let out = html;
  if (!/<html[^>]*\blang\s*=/.test(out)) out = out.replace(/<html\b/, '<html lang="en"');
  out = out.replace(/<img\b(?![^>]*\balt\s*=)[^>]*>/g, (m) => m.replace(/>$/, ' alt="photo">'));
  out = out.replace(/ alt=""/g, ' alt="photo"');
  out = out.replace(/<input\b(?![^>]*\baria-label)[^>]*>/g, (m) => /aria-labelledby/.test(m) ? m : m.replace(/>$/, ' aria-label="field">'));
  out = out.replace(/<label for="([^"]*)"><\/label>/g, '<label for="$1">Label</label>');
  out = out.replace(/<label for="missing-([^"]*)">/g, '<label for="$1">');
  out = out.replace(/<\/style>/, 'body,p,span,div,td,th,label,legend,button,a,input{color:#101418 !important;background-color:#ffffff !important}</style>');
  if (!/<h1[ >]/.test(out)) out = out.replace(/<h2>/, '<h1>').replace(/<\/h2>/, '</h1>');
  out = out.replace(/<h5\b/g, '<h3').replace(/<\/h5>/g, '</h3>');
  out = out.replace(/\s*tabindex="(?:[1-9]\d*|-\d+)"/g, '');
  out = out.replace(/<(div|span)\b[^>]*\bonclick="[^"]*"[^>]*>([\s\S]*?)<\/\1>/g, '<button type="button">$2</button>');
  out = out.replace(/<div\b[^>]*\brole="button"[^>]*>([\s\S]*?)<\/div>/g, '<button type="button">$1</button>');
  if (!/:focus/.test(out)) out = out.replace(/<\/style>/, 'a:focus-visible,button:focus-visible,input:focus-visible,[role]:focus-visible{outline:3px solid #0057d8}</style>');
  out = out.replace(/<a([^>]*?)\s*aria-label=""([^>]*)>/g, '<a$1$2>');
  out = out.replace(/<a([^>]*)>\s*<\/a>/g, '<a$1>Link</a>');
  out = out.replace(/<a([^>]*)>\s*<span[^>]*><\/span>\s*<\/a>/g, '<a$1>Link</a>');
  out = out.replace(/(<tr>)([\s\S]*?)<\/tr>/g, (m, o, cells) => /<td/.test(cells) && !/<th/.test(cells)
    ? `${o}${cells.replace(/<td/g, '<th scope="col"').replace(/<\/td>/g, '</th>')}</tr>`
    : m);
  return out;
};
const fixerTier = { easy: [], hard: [] };
for (const t of [...tasks, ...hidden]) {
  const r = await benchmark.score(t, { answer: regexFix(brokenOf(t.prompt)) });
  (fixerTier[t.metadata.tier] ??= []).push(r.score);
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
assert.ok(mean(fixerTier.easy) >= 0.95, `template fixer should still clear easy tasks (got ${mean(fixerTier.easy).toFixed(3)})`);
assert.ok(mean(fixerTier.hard) <= 0.75, `template fixer scored ${mean(fixerTier.hard).toFixed(3)} on hard tasks - hard tier is not structurally different`);
// Each hard-only barrier shape fails even when every other fix is right.
const hardTasks = tasks.filter((t) => t.metadata.tier === "hard");
assert.ok(hardTasks.length >= 10, "not enough hard tasks to probe");
for (const t of hardTasks) {
  const cases = [
    ["dangling-name", t.expected.replace('aria-labelledby="l-a l-b"', 'aria-labelledby="l-a l-gone"')],
    ["tab-trap", t.expected.replace('onkeydown="pickTab(\'a\')"', "onkeydown=\"if(event.key==='Tab')event.preventDefault()\"")],
    ["nested-control", t.expected.replace(/<button class="[^"]*" type="button">([^<]*)<\/button>/, '<a href="/x"><button type="button">$1</button></a>')],
    ["hidden-widget", t.expected.replace('role="tablist"', 'role="tablist" aria-hidden="true"')],
    ["unconditional-trap", t.expected.replace('onkeydown="pickTab(\'b\')"', 'onkeydown="event.preventDefault()"')],
  ];
  for (const [name, answer] of cases) {
    assert.notEqual(answer, t.expected, `${t.id} hard probe "${name}" changed nothing`);
    const r = await benchmark.score(t, { answer });
    assert.ok(r.score < 1, `${t.id} hard probe "${name}" scored ${r.score}: ${r.reason}`);
  }
  // A handler that cancels a named non-Tab key is a normal repair, not a trap.
  const ok = t.expected.replace('onkeydown="pickTab(\'a\')"', "onkeydown=\"if(event.key===' '){event.preventDefault();pickTab('a')}\"");
  const good = await benchmark.score(t, { answer: ok });
  assert.equal(good.score, 1, `${t.id} space-key handler scored ${good.score}: ${good.reason}`);
}

// ---- Alternate task paths on every surface ----
// benchmark-core caches the task list inside each benchmark object, so
// every path needs a fresh object. Run default, hidden, default, hidden
// in ONE process and check the ids each time.
const hiddenPath = resolve("artifacts/tasks.hidden.jsonl");
const { makeBenchmark, run: runSdk } = await import("../dist/index.js");
const { mockAdapter } = await import("benchmark-core");
const seq = [];
for (const path of [undefined, hiddenPath, undefined, hiddenPath]) {
  const r = await runSdk(mockAdapter({ seed: 1 }), path === undefined ? {} : { tasksPath: path });
  seq.push(r.rows);
}
assert.ok(seq[0].every((r) => r.taskId.startsWith("a11y-")), "default run lost a11y- ids");
assert.ok(seq[1].every((r) => r.taskId.startsWith("a11yh-")), "hidden run lost a11yh- ids");
assert.ok(seq[2].every((r) => r.taskId.startsWith("a11y-")), "second default run leaked hidden ids");
assert.ok(seq[3].every((r) => r.taskId.startsWith("a11yh-")), "second hidden run leaked public ids");
const listedHidden = await makeBenchmark(hiddenPath).listTasks();
assert.equal(listedHidden.length, hidden.length);
assert.equal((await benchmark.listTasks()).length, taskCount, "default benchmark cache was clobbered");
// CLI --tasks swaps the list for any command.
const cliList = await execFile(process.execPath, ["dist/cli.js", "list", "--tasks", hiddenPath, "--json"], { maxBuffer: 10_000_000 });
assert.ok(JSON.parse(cliList.stdout).tasks.every((t) => t.id.startsWith("a11yh-")), "CLI --tasks list returned public ids");
const cliRun = await execFile(process.execPath, ["dist/cli.js", "run", "--model", "offline", "--provider", "mock", "--tasks", hiddenPath, "--json"], { maxBuffer: 10_000_000 });
assert.ok(JSON.parse(cliRun.stdout).rows.every((r) => r.taskId.startsWith("a11yh-")), "CLI --tasks run returned public ids");
// npm users must be able to regenerate a split: the generator ships.
const pack = await execFile("npm", ["pack", "--dry-run", "--json"], { maxBuffer: 10_000_000 });
const packFiles = JSON.parse(pack.stdout)[0].files.map((f) => f.path);
assert.ok(packFiles.includes("scripts/gen-tasks.mjs"), "npm pack drops scripts/gen-tasks.mjs");
assert.ok(packFiles.includes("data/tasks.jsonl"), "npm pack drops data/tasks.jsonl");

// ---- Report breakdown ----
// The run report carries grading details and per-tier totals on every
// surface that prints a report.
assert.ok(report.rows.every((r) => r.details && typeof r.details.defectsFixed === "number"), "run rows lack details");
assert.ok(report.rows.every((r) => typeof r.details.tier === "string"), "run rows lack tier");
assert.deepEqual(Object.keys(report.tiers).sort(), ["easy", "hard"]);
assert.equal(report.tiers.easy.tasks + report.tiers.hard.tasks, taskCount);
assert.equal(report.tiers.easy.solved + report.tiers.hard.solved, report.totals.passed);
assert.ok(typeof report.totals.defectsFixed === "number" && typeof report.totals.regressions === "number");
const cliText = await execFile(process.execPath, ["dist/cli.js", "run", "--model", "offline", "--provider", "mock"], { maxBuffer: 10_000_000 });
assert.match(cliText.stdout, /## By tier/);
assert.match(cliText.stdout, /\| easy \| \d+\/\d+ \| [\d.]+% \| \d+\/\d+ \| \d+ \| \d+ \|/);
// The SDK run() returns the same enriched shape.
const sdkReport = await runSdk(mockAdapter({ seed: 2 }));
assert.ok(sdkReport.tiers?.easy && sdkReport.rows.every((r) => r.details), "SDK run lacks breakdown");
await writeFile("artifacts/run.json", cli.stdout);
const rescored = JSON.parse((await execFile(process.execPath, ["dist/cli.js", "score", "artifacts/run.json", "--json"], { maxBuffer: 10_000_000 })).stdout);
assert.ok(rescored.tiers?.hard && rescored.rows.every((r) => r.details), "score output lacks breakdown");

const probe = createNetServer();
await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
const address = probe.address(); assert.ok(address && typeof address === "object");
await new Promise((resolve) => probe.close(resolve));
const server = spawn(process.execPath, ["dist/cli.js", "serve", String(address.port)], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, A11Y_TASK_DIRS: resolve("artifacts") } });
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
  // API task-path option: inside an A11Y_TASK_DIRS directory is allowed,
  // anything else is refused.
  const hiddenListed = await get(`/v1/tasks?tasks=${encodeURIComponent(hiddenPath)}`);
  assert.ok(hiddenListed.value.tasks.every((t) => t.id.startsWith("a11yh-")), "API ?tasks= returned public ids");
  const hiddenScore = await fetch(`${base}/v1/score`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId: hidden[0].id, tasksPath: hiddenPath, submission: { answer: hidden[0].expected } }) });
  routes["POST /v1/score?tasksPath"] = hiddenScore.status;
  assert.equal(hiddenScore.status, 200);
  assert.equal((await hiddenScore.json()).score, 1, "hidden reference fix did not score 1 via tasksPath");
  const outside = await get("/v1/tasks?tasks=/etc/passwd");
  assert.equal(outside.response.status, 403, "API ?tasks=/etc/passwd was not refused");
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
  const scored = await client.callTool({ name: "score_answer", arguments: { taskId: firstId, submission: report.rows[0].submission } });
  const scoredJson = JSON.parse(scored.content[0].text);
  assert.ok(typeof scoredJson.details?.defectsFixed === "number" && typeof scoredJson.details?.tier === "string", "MCP score_answer lacks details");
} finally { await client.close(); }

// The MCP surface follows A11Y_TASKS for an operator-picked split.
const hiddenTransport = new StdioClientTransport({ command: process.execPath, args: ["dist/cli.js", "mcp"], cwd: process.cwd(), env: { ...process.env, A11Y_TASKS: hiddenPath }, stderr: "pipe" });
const hiddenClient = new Client({ name: "benchmark-accessibility-fix-e2e-hidden", version: "0.1.0" });
await hiddenClient.connect(hiddenTransport);
try {
  const result = await hiddenClient.callTool({ name: "list_tasks", arguments: {} });
  const listed = JSON.parse(result.content[0].text).tasks;
  assert.ok(listed.every((t) => t.id.startsWith("a11yh-")), "MCP A11Y_TASKS returned public ids");
} finally { await hiddenClient.close(); }

const artifact = { task_count: report.rows.length, scores: report.rows.map((row) => row.score), route_status_codes: routes, tool_names: toolNames, grader: { good_scored_1: goodHits, bad_scored_0: taskCount * 4, valid_variants: variantRuns, defect_kinds: variantsPerDefect.size, tricks_below_03: trickRuns, hidden_tasks: hidden.length, hidden_leak: leaked, hidden_seeds: EXPECTED_SEEDS.length, hidden_expected_checked: expectedChecked, fixer_easy_mean: Math.round(mean(fixerTier.easy) * 1000) / 1000, fixer_hard_mean: Math.round(mean(fixerTier.hard) * 1000) / 1000 } };
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/e2e-report.json", `${JSON.stringify(artifact, null, 2)}\n`);
assert.match(await readFile("data/PROVENANCE.md", "utf8"), /Synthetic accessibility fixtures/);
console.log(`e2e: ${artifact.task_count} tasks, ${variantRuns} variants, ${trickRuns} tricks, ${hidden.length} hidden, ${Object.keys(routes).length} routes, ${toolNames.length} tools, fixer easy ${mean(fixerTier.easy).toFixed(3)} hard ${mean(fixerTier.hard).toFixed(3)} -> all surfaces passed, ok`);
