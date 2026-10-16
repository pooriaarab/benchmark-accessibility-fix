// Dependency-free static accessibility analyzer for single-document fixes.
// No browser, no axe-core, no network. Regular expressions only. The
// supported color formats are #rgb, #rrggbb, and a small named-color list;
// anything else cannot be verified and fails the contrast check.

export const CHECK_IDS = [
  "missing-alt", "unlabeled-input", "low-contrast", "heading-order",
  "tabindex-positive", "div-button", "missing-lang", "no-focus-style",
  "empty-link", "table-headers",
] as const;
export type CheckId = (typeof CHECK_IDS)[number];

// Checks that need at least one examined element to count as fixed, so a
// fix that deletes every image, input, link, table, heading, or color rule
// cannot pass by vacuity. The other four checks pass on absence by design:
// removing a positive tabindex or a div-button is a genuine repair.
export const NEEDS_TARGETS: ReadonlySet<CheckId> = new Set([
  "missing-alt", "unlabeled-input", "low-contrast", "heading-order",
  "empty-link", "table-headers",
]);

export interface CheckResult {
  id: CheckId;
  pass: boolean;
  targets: number;
  detail: string;
}

export interface ElementCounts {
  img: number;
  input: number;
  select: number;
  textarea: number;
  link: number;
  table: number;
  button: number;
}

export interface Analysis {
  checks: CheckResult[];
  words: string[];
  counts: ElementCounts;
  hideCount: number;
}

const NAMED: Record<string, string> = {
  white: "#ffffff", black: "#000000", red: "#ff0000", lime: "#00ff00",
  blue: "#0000ff", yellow: "#ffff00", cyan: "#00ffff", aqua: "#00ffff",
  magenta: "#ff00ff", fuchsia: "#ff00ff", gray: "#808080", grey: "#808080",
  green: "#008000", maroon: "#800000", navy: "#000080", olive: "#808000",
  purple: "#800080", silver: "#c0c0c0", teal: "#008080",
};

function parseColor(token: string): string | null {
  const t = token.trim().toLowerCase();
  if (NAMED[t]) return NAMED[t];
  const m = t.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (!m) return null;
  let h = m[1] ?? "";
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return `#${h}`;
}

function channel(hex: string, at: number): number {
  const c = parseInt(hex.slice(at, at + 2), 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

export function contrastRatio(fg: string, bg: string): number | null {
  const a = parseColor(fg);
  const b = parseColor(bg);
  if (!a || !b) return null;
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Take the largest fenced block when the model wraps its answer, else the
// whole answer. Fences are stripped, never punished.
export function extractHtml(answer: string): string {
  const blocks = [...answer.matchAll(/```(?:html)?\s*([\s\S]*?)```/gi)].map((m) => (m[1] ?? "").trim());
  if (blocks.length === 0) return answer;
  return blocks.sort((a, b) => b.length - a.length)[0] ?? answer;
}

function styleTexts(html: string): string[] {
  return [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1] ?? "");
}

interface Pair {
  fg: string;
  bg: string;
  where: string;
}

function declPairs(decls: string, where: string, out: Pair[]): void {
  let fg: string | null = null;
  let bg: string | null = null;
  let seen = false;
  for (const part of decls.split(";")) {
    const m = part.match(/^\s*(color|background-color|background)\s*:\s*(.+?)\s*$/i);
    if (!m) continue;
    seen = true;
    const value = m[2] ?? "";
    if ((m[1] ?? "").toLowerCase() === "color") {
      fg = value.split(/\s+/)[0] ?? null;
    } else {
      bg = value.match(/#[0-9a-f]{3,6}\b/i)?.[0] ?? value.split(/\s+/).pop() ?? null;
    }
  }
  if (seen) out.push({ fg: fg ?? "#000000", bg: bg ?? "#ffffff", where });
}

function contrastPairs(html: string): Pair[] {
  const pairs: Pair[] = [];
  for (const css of styleTexts(html)) {
    const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const rule of noComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      declPairs(rule[2] ?? "", (rule[1] ?? "").trim().slice(0, 40), pairs);
    }
  }
  for (const attr of html.matchAll(/\bstyle\s*=\s*(["'])(.*?)\1/gis)) {
    declPairs(attr[2] ?? "", "inline", pairs);
  }
  return pairs;
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  if (!m) return null;
  return m[1] ?? m[2] ?? m[3] ?? null;
}

function innerText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function visibleWords(html: string): string[] {
  const text = innerText(html).toLowerCase();
  return text ? text.split(" ") : [];
}

function tagCount(html: string, name: string): number {
  return [...html.matchAll(new RegExp(`<${name}(?=[\\s/>])`, "gi"))].length;
}

function checkAlt(html: string): CheckResult {
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const bad = imgs.filter((tag) => {
    const alt = attr(tag, "alt");
    return alt === null || alt.trim() === "";
  });
  return { id: "missing-alt", pass: bad.length === 0, targets: imgs.length, detail: bad.length ? `${bad.length}/${imgs.length} images lack text` : `${imgs.length} images labelled` };
}

const SKIPPABLE_INPUT = new Set(["hidden", "submit", "button", "reset", "image"]);

function checkLabels(html: string): CheckResult {
  const fields = [...html.matchAll(/<(input|select|textarea)\b[^>]*>/gi)].map((m) => m[0]);
  const labelled = fields.filter((tag) => SKIPPABLE_INPUT.has((attr(tag, "type") ?? "").toLowerCase()));
  const needing = fields.filter((tag) => !SKIPPABLE_INPUT.has((attr(tag, "type") ?? "").toLowerCase()));
  void labelled;
  const forIds = new Set(
    [...html.matchAll(/<label\b[^>]*\bfor\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)].map((m) => m[1] ?? m[2] ?? m[3]),
  );
  const wrapped = [...html.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/gi)].map((m) => m[0]);
  const bad = needing.filter((tag) => {
    if ((attr(tag, "aria-label") ?? "").trim() !== "") return false;
    if ((attr(tag, "aria-labelledby") ?? "").trim() !== "") return false;
    const id = attr(tag, "id");
    if (id && forIds.has(id)) return false;
    const index = html.indexOf(tag);
    if (wrapped.some((region) => {
      const at = html.indexOf(region);
      return index >= at && index < at + region.length;
    })) return false;
    return true;
  });
  return { id: "unlabeled-input", pass: bad.length === 0, targets: needing.length, detail: bad.length ? `${bad.length}/${needing.length} fields unlabeled` : `${needing.length} fields labelled` };
}

function checkContrast(html: string): CheckResult {
  const pairs = contrastPairs(html);
  const bad = pairs.filter((p) => {
    const r = contrastRatio(p.fg, p.bg);
    return r === null || r < 4.5;
  });
  const worst = pairs.map((p) => contrastRatio(p.fg, p.bg)).filter((r): r is number => r !== null);
  const min = worst.length ? Math.min(...worst).toFixed(2) : "n/a";
  return { id: "low-contrast", pass: bad.length === 0, targets: pairs.length, detail: bad.length ? `${bad.length}/${pairs.length} pairs below 4.5:1` : `${pairs.length} pairs reach 4.5:1 (min ${min}:1)` };
}

function checkHeadings(html: string): CheckResult {
  const levels = [...html.matchAll(/<h([1-6])\b[^>]*>/gi)].map((m) => Number(m[1] ?? "0"));
  if (levels.length === 0) return { id: "heading-order", pass: false, targets: 0, detail: "no headings" };
  if (levels[0] !== 1) return { id: "heading-order", pass: false, targets: levels.length, detail: "first heading is not h1" };
  if (levels.filter((l) => l === 1).length !== 1) return { id: "heading-order", pass: false, targets: levels.length, detail: "more than one h1" };
  for (let i = 1; i < levels.length; i++) {
    const prev = levels[i - 1] ?? 1;
    const cur = levels[i] ?? 1;
    if (cur > prev + 1) {
      return { id: "heading-order", pass: false, targets: levels.length, detail: `h${prev} jumps to h${cur}` };
    }
  }
  return { id: "heading-order", pass: true, targets: levels.length, detail: `order ${levels.join(">")} ok` };
}

function checkTabindex(html: string): CheckResult {
  const values = [...html.matchAll(/\btabindex\s*=\s*["']?\s*(-?\d+)/gi)].map((m) => Number(m[1]));
  const bad = values.filter((v) => v > 0);
  return { id: "tabindex-positive", pass: bad.length === 0, targets: values.length, detail: bad.length ? `positive order ${bad.join(",")}` : "natural tab order" };
}

function checkDivButton(html: string): CheckResult {
  const tags = [...html.matchAll(/<(div|span)\b[^>]*>/gi)].map((m) => m[0]);
  const bad = tags.filter((tag) => /\bonclick\b/i.test(tag) || /\brole\s*=\s*["']?\s*button/i.test(tag));
  return { id: "div-button", pass: bad.length === 0, targets: tags.length, detail: bad.length ? `${bad.length} fake buttons` : "native controls" };
}

function checkLang(html: string): CheckResult {
  const tag = html.match(/<html\b[^>]*>/i)?.[0] ?? "";
  const lang = attr(tag, "lang");
  const pass = lang !== null && lang.trim() !== "";
  return { id: "missing-lang", pass, targets: tag ? 1 : 0, detail: pass ? `lang="${lang?.trim()}"` : "html has no lang" };
}

function checkFocus(html: string): CheckResult {
  const css = styleTexts(html).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [...css.matchAll(/([^{}]*:focus[^{}]*){([^}]*)}/gi)].map((m) => m[2] ?? "");
  const visible = rules.some((body) =>
    /outline\s*:\s*(?!none\b|0\b)/i.test(body) ||
    /box-shadow\s*:\s*(?!none\b)/i.test(body) ||
    /border\s*:\s*(?!none\b|0\b)/i.test(body),
  );
  return { id: "no-focus-style", pass: visible, targets: rules.length, detail: visible ? "visible focus indicator" : "no visible focus style" };
}

function checkLinks(html: string): CheckResult {
  const links = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
  const bad = links.filter((m) => {
    const opening = m[1] ?? "";
    if ((attr(opening, "aria-label") ?? "").trim() !== "") return false;
    if ((attr(opening, "aria-labelledby") ?? "").trim() !== "") return false;
    const inner = m[2] ?? "";
    if (innerText(inner).trim() !== "") return false;
    const imgAlt = [...inner.matchAll(/<img\b[^>]*>/gi)]
      .map((im) => attr(im[0], "alt") ?? "").some((a) => a.trim() !== "");
    return !imgAlt;
  });
  return { id: "empty-link", pass: bad.length === 0, targets: links.length, detail: bad.length ? `${bad.length}/${links.length} links unnamed` : `${links.length} links named` };
}

function checkTables(html: string): CheckResult {
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].map((m) => m[0]);
  const bad = tables.filter((t) => !/<th\b/i.test(t));
  return { id: "table-headers", pass: bad.length === 0, targets: tables.length, detail: bad.length ? `${bad.length}/${tables.length} tables lack headers` : `${tables.length} tables headed` };
}

export function analyze(html: string): Analysis {
  return {
    checks: [
      checkAlt(html), checkLabels(html), checkContrast(html), checkHeadings(html),
      checkTabindex(html), checkDivButton(html), checkLang(html), checkFocus(html),
      checkLinks(html), checkTables(html),
    ],
    words: visibleWords(html),
    counts: {
      img: tagCount(html, "img"), input: tagCount(html, "input"), select: tagCount(html, "select"),
      textarea: tagCount(html, "textarea"), link: tagCount(html, "a"),
      table: tagCount(html, "table"), button: tagCount(html, "button"),
    },
    hideCount: (html.match(/display\s*:\s*none|visibility\s*:\s*hidden|aria-hidden\s*=\s*["']?true/gi) ?? []).length,
  };
}
