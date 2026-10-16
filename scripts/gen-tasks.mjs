// Generates synthetic accessibility-fix fixtures (MIT).
// Usage: node scripts/gen-tasks.mjs [--seed N] [--split public|hidden] [--out path] [--count N]
// Public split defaults to data/tasks.jsonl with seed 20261015.
// Hidden split defaults to artifacts/tasks.hidden.jsonl (gitignored, never published)
// and uses its own a11yh- id prefix so hidden ids never collide with public ones.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash } from "node:crypto";

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

const pick = (rng, list) => list[Math.floor(rng() * list.length)];
const pickN = (rng, list, n) => {
  const copy = [...list];
  const out = [];
  while (out.length < Math.min(n, copy.length)) out.push(copy.splice(Math.floor(rng() * copy.length), 1)[0]);
  return out;
};
const shuffle = (rng, list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// WCAG relative luminance for #rrggbb.
function luminance(hex) {
  const h = hex.replace("#", "");
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
const hex = (rng, lo, hi) => "#" + [0, 1, 2].map(() => (lo + Math.floor(rng() * (hi - lo + 1))).toString(16).padStart(2, "0")).join("");

// A passing foreground/background pair at >= minRatio.
function goodPair(rng, minRatio = 4.5) {
  for (let tries = 0; tries < 200; tries++) {
    const bg = hex(rng, 200, 255);
    const fg = hex(rng, 0, 120);
    if (ratio(fg, bg) >= minRatio) return { fg, bg };
  }
  throw new Error("no good pair found");
}
// A failing pair against a fixed background (text lands in the 3.5-4.4 band
// so the defect is visible but not blatant).
function badFg(rng, bg) {
  for (let tries = 0; tries < 400; tries++) {
    const fg = hex(rng, 120, 190);
    const r = ratio(fg, bg);
    if (r < 4.5 && r > 2.5) return fg;
  }
  return "#8a8a8a";
}
// A large-text pair in the passing 3:1-4.5 band (valid fix, tests the
// large-text threshold).
function largePair(rng) {
  for (let tries = 0; tries < 300; tries++) {
    const bg = hex(rng, 200, 255);
    const fg = hex(rng, 60, 160);
    const r = ratio(fg, bg);
    if (r >= 3.05 && r < 4.5) return { fg, bg };
  }
  throw new Error("no large pair found");
}

const CHECKS = [
  ["missing-alt", "1.1.1"], ["unlabeled-input", "3.3.2"], ["low-contrast", "1.4.3"],
  ["heading-order", "1.3.1"], ["tabindex-positive", "2.4.3"], ["div-button", "4.1.2"],
  ["missing-lang", "3.1.1"], ["no-focus-style", "2.4.7"], ["empty-link", "2.4.4"],
  ["table-headers", "1.3.1"],
];
const WCAG = Object.fromEntries(CHECKS);

const ADJ = ["Harbor", "Kestrel", "Northern", "River", "Garden", "Amber", "Cedar", "Juniper", "Misty", "Copper", "Silver", "Quiet", "Bright", "Willow", "Frost", "Ember", "Sage", "Coral", "Atlas", "Meadow"];
const NOUN = ["Lights", "Ridge", "Valley", "Crossing", "Mills", "Works", "Foundry", "Collective", "Cooperative", "Observatory", "Pantry", "Workshop", "Ledger", "Orchard", "Depot", "Exchange", "Studio", "Clinic", "Archive", "Guild"];
const KIND = ["newsletter", "field guide", "status report", "release notes", "handbook", "bulletin", "weekly digest", "product sheet", "setup guide", "survey results", "booking page", "service page"];
const TOPICS = [
  ["ferry sailings", "harbor notes", "crossing times"],
  ["grind settings", "care notes", "brew ratios"],
  ["sleeper bookings", "reading list", "departure board"],
  ["volunteer shifts", "meeting point", "supply list"],
  ["api keys", "rate limits", "endpoint status"],
  ["survey findings", "next steps", "member quotes"],
  ["trail conditions", "permit windows", "ranger notes"],
  ["menu changes", "supplier list", "order cutoffs"],
  ["rehearsal dates", "set list", "venue notes"],
  ["seed inventory", "planting calendar", "pest watch"],
  ["loan rates", "branch hours", "member news"],
  ["build artifacts", "test matrix", "deploy log"],
];
const NOTES = [
  "New routes post every Sunday evening.", "Burrs carry a five year warranty.",
  "Berths sell out around holidays.", "Gloves and bags are provided.",
  "Keys rotate every ninety days.", "Two hundred members answered.",
  "Permits open on the first Monday.", "Orders close at noon on Fridays.",
  "Rehearsals move indoors in winter.", "Seed counts refresh monthly.",
  "Rates lock for sixty days.", "Artifacts prune after thirty days.",
];
const SPANS = [
  "Ferries run hourly on holidays.", "Free returns within thirty days.",
  "Bring a lock for the cabin door.", "All ages welcome with an adult.",
  "Sandbox data refreshes hourly.", "Evening hours were the top ask.",
  "Boots are required past the gate.", "Late orders ship the next day.",
  "Guests may watch the last set.", "Cover beds before a frost.",
  "Statements arrive by post.", "Flaky tests quarantine on retry.",
];
const ALTS = [
  "Ferry crossing the harbor at dusk", "Steel burr coffee grinder on a counter",
  "Sleeper train under northern lights", "Volunteers clearing a riverbank",
  "Soil sensor beside tomato plants", "Reading room with tall shelves",
  "Trail marker above the treeline", "Stacked crates at the loading dock",
  "String section tuning on stage", "Seed packets on a potting bench",
  "Teller counter at the main branch", "Build monitor showing green jobs",
];
const CTA = ["Subscribe", "Add to basket", "Save article", "Join us", "Get a key", "Download PDF", "Book now", "Reserve a spot", "Notify me", "Start trial"];
const NAV2 = ["About", "FAQ", "Pricing", "News", "Docs", "Team", "Contact", "Archive"];
const FIELD_POOL = [
  ["name", "Full name", "text"], ["email", "Email address", "email"],
  ["phone", "Phone number", "tel"], ["org", "Organization", "text"],
  ["city", "City", "text"], ["note", "Delivery note", "text"],
];
const CLASS_A = ["note", "hint", "aside", "fine", "meta", "muted"];
const CLASS_B = ["cta", "btn-primary", "action", "primary-btn", "main-action", "go"];
const CAPTIONS = ["Crossing times", "Grind guide", "Departure board", "Cleanup shifts", "Endpoint limits", "Survey results", "Permit windows", "Order ledger", "Rehearsal slots", "Seed counts", "Rate sheet", "Build history"];
const COLHEADS = [["Option", "Detail", "Status"], ["Name", "Owner", "State"], ["Step", "Input", "Output"], ["Item", "Count", "Flag"]];
const CELLS = [["Standard", "Weekly", "Open"], ["Plus", "Daily", "Open"], ["Rush", "Hourly", "Full"], ["Basic", "Monthly", "Closed"], ["Trial", "Once", "Open"], ["Custom", "On call", "Open"]];

// One randomized but fully accessible page. Returns the HTML plus a hooks
// object with the exact strings defect breakers can target.
function buildFixed(rng) {
  const title = `${pick(rng, ADJ)} ${pick(rng, NOUN)} ${pick(rng, KIND)}`;
  const topics = pick(rng, TOPICS);
  const [h2a, h2b, caption] = [topics[0], topics[1], pick(rng, CAPTIONS)];
  const noteClass = pick(rng, CLASS_A);
  const ctaClass = pick(rng, CLASS_B);
  const noteText = pick(rng, NOTES);
  const spanText = pick(rng, SPANS);
  const heroAlt = pick(rng, ALTS);
  const img = `https://example.com/${title.toLowerCase().replace(/[^a-z]+/g, "-")}.jpg`;
  const ctaText = pick(rng, CTA);
  const nav2 = pick(rng, NAV2);
  const fields = pickN(rng, FIELD_POOL, 2 + Math.floor(rng() * 2));
  const colheads = pick(rng, COLHEADS);
  const rows = pickN(rng, CELLS, 2 + Math.floor(rng() * 2));
  // Colors: every pair is generated to pass.
  const body = goodPair(rng);
  const note = goodPair(rng);
  const spanFg = goodPair(rng, 4.5).fg;
  const cta = goodPair(rng);
  const focusColor = goodPair(rng).fg;
  // A large-text heading pair in the legal 3:1-4.5 band keeps the
  // large-text path exercised without tripping the defect check.
  const large = rng() < 0.5 ? largePair(rng) : null;
  const largeRule = large ? `\n.big-head{color:${large.fg};background-color:${large.bg};font-size:26px;font-weight:700}` : "";
  const bigHead = large ? `<h2 class="big-head">${h2a}</h2>` : `<h2>${h2a}</h2>`;
  const styleBlock = `<style>
body{color:${body.fg};background-color:${body.bg};font-family:system-ui,sans-serif;line-height:1.5}
.${noteClass}{color:${note.fg};background-color:${note.bg}}
.${ctaClass}{color:${cta.fg};background-color:${cta.bg};padding:.6rem 1rem;border:0;border-radius:.4rem}
a:focus-visible,.${ctaClass}:focus-visible{outline:3px solid ${focusColor};outline-offset:2px}${largeRule}
</style>`;

  const skip = `<a href="#main">Skip to content</a>`;
  const formFields = fields.map(([id, label, type]) =>
    `<label for="${id}">${label}</label>\n<input id="${id}" name="${id}" type="${type}" autocomplete="${id}">`).join("\n");
  const tableRows = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("\n");
  const table = `<table>\n<caption>${caption}</caption>\n<tr>${colheads.map((c) => `<th scope="col">${c}</th>`).join("")}</tr>\n${tableRows}\n</table>`;
  const sections = shuffle(rng, [
    `<img src="${img}" alt="${heroAlt}">`,
    `<p class="${noteClass}">${noteText}</p>`,
    `<p><span style="color:${spanFg}">${spanText}</span></p>`,
    table,
  ]);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
${styleBlock}
</head>
<body>
<header>
<nav>${skip} <a href="/${nav2.toLowerCase()}">${nav2}</a></nav>
<h1>${title}</h1>
</header>
<main id="main">
${bigHead}
${sections[0]}
${sections[1]}
<h3>${h2b}</h3>
<form action="/signup" method="post">
${formFields}
<button type="submit">Sign up</button>
</form>
${sections[2]}
<p><button class="${ctaClass}" type="button">${ctaText}</button></p>
${sections[3]}
</main>
<footer>
<p><a href="/archive">Archive</a> <a href="/contact">Contact</a></p>
</footer>
</body>
</html>`;
  return {
    html,
    hooks: {
      heroAlt: ` alt="${heroAlt}"`,
      label: fields[1] ? `<label for="${fields[1][0]}">${fields[1][1]}</label>\n` : `<label for="${fields[0][0]}">${fields[0][1]}</label>\n`,
      noteRule: `.${noteClass}{color:${note.fg};`,
      noteBad: `.${noteClass}{color:${badFg(rng, note.bg)};`,
      spanRule: `<span style="color:${spanFg}">`,
      spanBad: `<span style="color:${badFg(rng, body.bg)}">`,
      ctaButton: `<button class="${ctaClass}" type="button">${ctaText}</button>`,
      ctaText,
      focusRule: `\na:focus-visible,.${ctaClass}:focus-visible{outline:3px solid ${focusColor};outline-offset:2px}`,
      skip,
      archive: `<a href="/archive">Archive</a>`,
    },
  };
}

// Each breaker rewrites one hook in the fixed page. Variants make the same
// defect appear in different disguises (role-button lookalikes, multi-step
// tab order, empty-label silences) so a template-aware regex fixer misses.
const BREAKERS = {
  "missing-alt": (h) => [(p) => p.replace(h.hooks.heroAlt, ""), "alt removed"],
  "unlabeled-input": (h, rng) => {
    const variant = rng();
    if (variant < 0.5) return [(p) => p.replace(h.hooks.label, ""), "label removed"];
    if (variant < 0.8) return [(p) => p.replace(/<label for="(\w+)">/, '<label for="missing-$1">'), "label for broken"];
    return [(p) => p.replace(h.hooks.label.trimEnd(), h.hooks.label.trimEnd().replace(/>([^<]+)</, "><")), "label emptied"];
  },
  "low-contrast": (h) => [(p) => p.replace(h.hooks.noteRule, h.hooks.noteBad).replace(h.hooks.spanRule, h.hooks.spanBad), "colors dimmed"],
  "heading-order": (h, rng) => [(p) => (rng() < 0.5
    ? p.replace("<h3>", "<h5>").replace("</h3>", "</h5>")
    : p.replace("<h1>", "<h2>").replace("</h1>", "</h2>")), "headings shuffled"],
  "tabindex-positive": (h, rng) => [(p) => {
    // Multi-step order: sprinkle 1-3 positive tabindices across the page.
    let out = p.replace('<a href="#main">', '<a tabindex="3" href="#main">');
    if (rng() < 0.6) out = out.replace('<a href="/archive">', '<a tabindex="1" href="/archive">');
    if (rng() < 0.4) out = out.replace('type="submit"', 'tabindex="7" type="submit"');
    return out;
  }, "tabindex added"],
  "div-button": (h, rng) => {
    const v = rng();
    const repl = v < 0.4
      ? `<div class="cta-div" onclick="go()">${h.hooks.ctaText}</div>`
      : v < 0.7
        ? `<div role="button">${h.hooks.ctaText}</div>`
        : `<span class="cta-div" onclick="go()">${h.hooks.ctaText}</span>`;
    return [(p) => p.replace(h.hooks.ctaButton, repl), "button divved"];
  },
  "missing-lang": () => [(p) => p.replace('<html lang="en">', "<html>"), "lang removed"],
  "no-focus-style": (h) => [(p) => p.replace(h.hooks.focusRule, ""), "focus rule removed"],
  "empty-link": (h, rng) => {
    const v = rng();
    if (v < 0.5) return [(p) => p.replace(h.hooks.archive, '<a href="/archive"></a>'), "link emptied"];
    if (v < 0.8) return [(p) => p.replace(h.hooks.archive, '<a href="/archive" aria-label=""></a>'), "link label emptied"];
    return [(p) => p.replace(h.hooks.archive, '<a href="/archive"><span class="icon"></span></a>'), "link icon unlabeled"];
  },
  "table-headers": () => [(p) => p.replaceAll("<th scope=\"col\">", "<td>").replaceAll("</th>", "</td>"), "headers demoted"],
};

function pickDefects(rng, taskIndex, tier) {
  const ids = CHECKS.map(([id]) => id);
  const defects = new Set([ids[taskIndex % ids.length]]);
  const target = tier === "hard" ? 3 + Math.floor(rng() * 3) : 2 + Math.floor(rng() * 2);
  while (defects.size < target) defects.add(ids[Math.floor(rng() * ids.length)]);
  return [...defects];
}

const PROMPT_HEAD = `Fix the broken HTML page below so keyboard, screen-reader, and contrast checks pass.

Repair every defect you find: image text alternatives, input labels, text contrast (4.5:1 or better, or 3:1 for large text), heading order, tab order, native buttons, page language, visible focus styles, link names, and table headers. Keep all visible text and elements; do not delete or hide content to silence a check.

Return the complete fixed HTML document.`;

const rng = mulberry32(seed);
const tasks = [];
const fingerprints = new Set();
for (let i = 0; i < count; i++) {
  const tier = i % 3 === 2 ? "hard" : "easy";
  const built = buildFixed(rng);
  const defects = pickDefects(rng, i, tier).sort();
  let broken = built.html;
  for (const id of defects) {
    const [breakPage] = BREAKERS[id](built, rng);
    const next = breakPage(broken);
    if (next === broken) throw new Error(`breaker ${id} changed nothing on task ${i + 1}`);
    broken = next;
  }
  if (broken === built.html) throw new Error(`task ${i + 1} has no visible break`);
  fingerprints.add(createHash("sha1").update(built.html.replace(/>\s*</g, "><").replace(/[\w.-]+(?=\.jpg|"[a-z-]+")/g, "#")).digest("hex").slice(0, 12));
  const idNum = String(i + 1).padStart(2, "0");
  tasks.push({
    id: `${split === "hidden" ? "a11yh" : "a11y"}-${idNum}`,
    kind: "single",
    prompt: `${PROMPT_HEAD}\n\n\`\`\`html\n${broken}\n\`\`\``,
    expected: built.html,
    metadata: {
      defects, wcag: defects.map((d) => WCAG[d]), tier, seed, split, taskSeed: seed + i,
    },
  });
}
const coverage = new Map(CHECKS.map(([id]) => [id, 0]));
for (const task of tasks) for (const id of task.metadata.defects) coverage.set(id, coverage.get(id) + 1);
for (const [id, n] of coverage) {
  if (n < Math.floor(count / CHECKS.length)) throw new Error(`check ${id} appears in only ${n} tasks`);
}
// Distinct pages, not six fixed themes: the hidden split cannot reuse a
// public reference page. Require well above the old six-theme ceiling.
if (fingerprints.size < Math.min(30, count)) {
  throw new Error(`only ${fingerprints.size} distinct page fingerprints (need >= ${Math.min(30, count)})`);
}
await mkdir(dirname(out), { recursive: true });
await writeFile(out, `${tasks.map((task) => JSON.stringify(task)).join("\n")}\n`);
console.log(`generated ${tasks.length} ${split} tasks (seed ${seed}) -> ${out}`);
console.log(`fingerprints: ${fingerprints.size} distinct pages`);
console.log(`coverage: ${[...coverage].map(([id, n]) => `${id}=${n}`).join(" ")}`);
