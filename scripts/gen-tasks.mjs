// Generates synthetic accessibility-fix fixtures (MIT).
// Usage: node scripts/gen-tasks.mjs [--seed N] [--split public|hidden] [--out path] [--count N]
// Public split defaults to data/tasks.jsonl with seed 20261015.
// Hidden split defaults to artifacts/tasks.hidden.jsonl (gitignored, never published).
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const args = process.argv.slice(2);
const get = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
if (args.includes("--help")) {
  console.log("Usage: node scripts/gen-tasks.mjs [--seed N] [--split public|hidden] [--out path] [--count N]");
  process.exit(0);
}
const seed = Number(get("--seed", "20261015"));
const split = get("--split", "public");
const count = Number(get("--count", "40"));
const out = get("--out", split === "hidden" ? "artifacts/tasks.hidden.jsonl" : "data/tasks.jsonl");
if (!Number.isInteger(seed) || !Number.isInteger(count) || count < 1) throw new Error("seed and count must be positive integers");
if (split !== "public" && split !== "hidden") throw new Error("--split must be public or hidden");

function mulberry32(start) {
  let state = start >>> 0;
  return () => {
    state += 1831565813;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

// WCAG relative luminance for #rgb / #rrggbb.
function luminance(hex) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

const GOOD = { body: "#1f1f1f", note: "#595959", span: "#434343", ctaBg: "#0b3d66", white: "#ffffff" };
const BAD = { note: "#8a8a8a", span: "#8a8a8a" };
// Self-check the palette so the contrast defect is real in both directions.
for (const [name, fg] of [["body", GOOD.body], ["note-fixed", GOOD.note], ["span-fixed", GOOD.span]]) {
  if (ratio(fg, GOOD.white) < 4.5) throw new Error(`fixed pair ${name} fails 4.5:1`);
}
for (const [name, fg] of [["note-broken", BAD.note], ["span-broken", BAD.span]]) {
  if (ratio(fg, GOOD.white) >= 4.5) throw new Error(`broken pair ${name} passes 4.5:1`);
}
if (ratio(GOOD.white, GOOD.ctaBg) < 4.5) throw new Error("cta pair fails 4.5:1");

const CHECKS = [
  ["missing-alt", "1.1.1"], ["unlabeled-input", "3.3.2"], ["low-contrast", "1.4.3"],
  ["heading-order", "1.3.1"], ["tabindex-positive", "2.4.3"], ["div-button", "4.1.2"],
  ["missing-lang", "3.1.1"], ["no-focus-style", "2.4.7"], ["empty-link", "2.4.4"],
  ["table-headers", "1.3.1"],
];
const WCAG = Object.fromEntries(CHECKS);

const THEMES = [
  { page: "newsletter", title: "Harbor Lights newsletter", h2: "This week's sailings", h3: "Harbor notes",
    heroAlt: "Ferry crossing the harbor at dusk", img: "https://example.com/harbor.jpg",
    note: "New routes post every Sunday evening.", span: "Ferries run hourly on holidays.",
    caption: "Crossing times", cta: "Subscribe" },
  { page: "product", title: "Kestrel coffee grinder", h2: "Grind settings", h3: "Care notes",
    heroAlt: "Steel burr coffee grinder on a counter", img: "https://example.com/grinder.jpg",
    note: "Burrs carry a five year warranty.", span: "Free returns within thirty days.",
    caption: "Grind guide", cta: "Add to basket" },
  { page: "article", title: "Night trains of the north", h2: "Booking a berth", h3: "Reading list",
    heroAlt: "Sleeper train under northern lights", img: "https://example.com/train.jpg",
    note: "Berths sell out around holidays.", span: "Bring a lock for the cabin door.",
    caption: "Departure board", cta: "Save article" },
  { page: "event", title: "River cleanup day", h2: "What to bring", h3: "Meeting point",
    heroAlt: "Volunteers clearing a riverbank", img: "https://example.com/river.jpg",
    note: "Gloves and bags are provided.", span: "All ages welcome with an adult.",
    caption: "Cleanup shifts", cta: "Join us" },
  { page: "docs", title: "Garden sensor API", h2: "Authentication", h3: "Rate limits",
    heroAlt: "Soil sensor beside tomato plants", img: "https://example.com/sensor.jpg",
    note: "Keys rotate every ninety days.", span: "Sandbox data refreshes hourly.",
    caption: "Endpoint limits", cta: "Get a key" },
  { page: "report", title: "Branch library survey", h2: "Key findings", h3: "Next steps",
    heroAlt: "Reading room with tall shelves", img: "https://example.com/library.jpg",
    note: "Two hundred members answered.", span: "Evening hours were the top ask.",
    caption: "Survey results", cta: "Download PDF" },
];

function styleBlock(focusFixed) {
  const focus = focusFixed ? "\na:focus-visible,.cta:focus-visible{outline:3px solid #005fcc;outline-offset:2px}" : "";
  return `<style>\nbody{color:${GOOD.body};background-color:${GOOD.white};font-family:system-ui,sans-serif;line-height:1.5}\n.note{color:${GOOD.note};background-color:${GOOD.white}}\n.cta{color:${GOOD.white};background-color:${GOOD.ctaBg};padding:.6rem 1rem;border:0;border-radius:.4rem}${focus}\n</style>`;
}

// The fixed page: every check passes. Defects are applied by string breakers.
function buildFixed(t, focusFixed, headingMode) {
  void headingMode;
  return `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>${t.title}</title>\n${styleBlock(focusFixed)}\n</head>\n<body>\n<header>\n<nav><a href="#main">Skip to content</a> <a href="/about">About</a></nav>\n<h1>${t.title}</h1>\n</header>\n<main id="main">\n<h2>${t.h2}</h2>\n<img src="${t.img}" alt="${t.heroAlt}">\n<p class="note">${t.note}</p>\n<p><span style="color:${GOOD.span}">${t.span}</span></p>\n<h3>${t.h3}</h3>\n<form action="/signup" method="post">\n<label for="name">Full name</label>\n<input id="name" name="name" type="text" autocomplete="name">\n<label for="email">Email address</label>\n<input id="email" name="email" type="email" autocomplete="email">\n<button type="submit">Sign up</button>\n</form>\n<p><button class="cta" type="button">${t.cta}</button></p>\n<table>\n<caption>${t.caption}</caption>\n<tr><th scope="col">Option</th><th scope="col">Detail</th><th scope="col">Status</th></tr>\n<tr><td>Standard</td><td>Weekly</td><td>Open</td></tr>\n<tr><td>Plus</td><td>Daily</td><td>Open</td></tr>\n</table>\n</main>\n<footer>\n<p><a href="/archive">Archive</a> <a href="/contact">Contact</a></p>\n</footer>\n</body>\n</html>`;
}

const BREAKERS = {
  "missing-alt": (t) => [(p) => p.replace(` alt="${t.heroAlt}"`, ""), "alt removed"],
  "unlabeled-input": () => [(p) => p.replace('<label for="email">Email address</label>\n', ""), "label removed"],
  "low-contrast": () => [(p) => p
    .replace(`.note{color:${GOOD.note};`, `.note{color:${BAD.note};`)
    .replace(`<span style="color:${GOOD.span}">`, `<span style="color:${BAD.span}">`), "colors dimmed"],
  "heading-order": () => [(p, rng) => (rng() < 0.5
    ? p.replace("<h2>", "<h4>").replace("</h2>", "</h4>")
    : p.replace("<h1>", "<h2>").replace("</h1>", "</h2>")), "headings shuffled"],
  "tabindex-positive": () => [(p) => p.replace('<a href="#main">', '<a tabindex="3" href="#main">'), "tabindex added"],
  "div-button": (t) => [(p) => p
    .replace(`<button class="cta" type="button">${t.cta}</button>`, `<div class="cta" onclick="signup()">${t.cta}</div>`), "button divved"],
  "missing-lang": () => [(p) => p.replace('<html lang="en">', "<html>"), "lang removed"],
  "no-focus-style": () => [(p) => p.replace("\na:focus-visible,.cta:focus-visible{outline:3px solid #005fcc;outline-offset:2px}", ""), "focus rule removed"],
  "empty-link": () => [(p) => p.replace('<a href="/archive">Archive</a>', '<a href="/archive"></a>'), "link emptied"],
  "table-headers": () => [(p) => p.replaceAll("<th scope=\"col\">", "<td>").replaceAll("</th>", "</td>"), "headers demoted"],
};

function pickDefects(rng, taskIndex) {
  // Round-robin guarantees every check appears; extras come from the rng.
  const ids = CHECKS.map(([id]) => id);
  const defects = new Set([ids[taskIndex % ids.length]]);
  const extra = 1 + Math.floor(rng() * 2);
  while (defects.size < 1 + extra) defects.add(ids[Math.floor(rng() * ids.length)]);
  return [...defects];
}

const PROMPT_HEAD = `Fix the broken HTML page below so keyboard, screen-reader, and contrast checks pass.

Repair every defect you find: image text alternatives, input labels, text contrast (4.5:1 or better, hex colors), heading order, tab order, native buttons, page language, visible focus styles, link names, and table headers. Keep all visible text and elements; do not delete or hide content to silence a check.

Return the complete fixed HTML document.`;

const rng = mulberry32(seed);
const tasks = [];
for (let i = 0; i < count; i++) {
  const theme = THEMES[i % THEMES.length];
  const defects = pickDefects(rng, i).sort();
  let fixed = buildFixed(theme, true);
  let broken = fixed;
  for (const id of defects) {
    const [breakPage] = BREAKERS[id](theme);
    const next = breakPage(broken, rng);
    if (next === broken) throw new Error(`breaker ${id} changed nothing on task ${i + 1}`);
    broken = next;
  }
  if (broken === fixed) throw new Error(`task ${i + 1} has no visible break`);
  tasks.push({
    id: `a11y-${String(i + 1).padStart(2, "0")}`,
    kind: "single",
    prompt: `${PROMPT_HEAD}\n\n\`\`\`html\n${broken}\n\`\`\``,
    expected: fixed,
    metadata: {
      defects, wcag: defects.map((d) => WCAG[d]), page: theme.page,
      seed, split, taskSeed: seed + i,
    },
  });
}
const coverage = new Map(CHECKS.map(([id]) => [id, 0]));
for (const task of tasks) for (const id of task.metadata.defects) coverage.set(id, coverage.get(id) + 1);
for (const [id, n] of coverage) {
  if (n < Math.floor(count / CHECKS.length)) throw new Error(`check ${id} appears in only ${n} tasks`);
}
await mkdir(dirname(out), { recursive: true });
await writeFile(out, `${tasks.map((task) => JSON.stringify(task)).join("\n")}\n`);
console.log(`generated ${tasks.length} ${split} tasks (seed ${seed}) -> ${out}`);
console.log(`coverage: ${[...coverage].map(([id, n]) => `${id}=${n}`).join(" ")}`);