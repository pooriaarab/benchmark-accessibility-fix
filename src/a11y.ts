// Dependency-free static accessibility analyzer for single-document fixes.
// The render engine (light DOM + small CSS cascade) lives in a11y-dom.ts;
// this file holds the ten WCAG checks and the analysis rollup. Comments are
// stripped by the parser, so commented-out markup cannot fail a check and
// commented-out rules cannot pass one.

import {
  ancestors, bgColorToken, cascadeNumber, decode, elText, matchSelector, over,
  parseDecls, parseDoc, parseNumericColor, parseSelector, ratioOf, RAW_TEXT,
  rendered, resolveColor, resolveColorString, styleRules,
  type Ctx, type Decl, type El, type Rgba,
} from "./a11y-dom.js";

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
  // True when a failing element carries a checker-silencing gesture
  // (empty alt, empty aria-label, negating focus rule, lang="") rather
  // than an honest miss. The grader scores a silenced defect 0.
  silenced: boolean;
}

export interface ElementCounts {
  img: number;
  input: number;
  select: number;
  textarea: number;
  link: number;
  table: number;
  button: number;
  heading: number;
  control: number;
}

export interface Analysis {
  checks: CheckResult[];
  words: string[];
  counts: ElementCounts;
  hideCount: number;
}


export function contrastRatio(fg: string, bg: string): number | null {
  const a = parseNumericColor(fg);
  const b = parseNumericColor(bg);
  if (!a || !b) return null;
  return ratioOf(a, b);
}

// One context per analyzed document: parse once, collect stylesheet rules,
// share memo tables across every check.
export function buildCtx(html: string): Ctx {
  const doc = parseDoc(html);
  return { doc, rules: styleRules(doc), colorMemo: new Map(), customMemo: new Map(), numMemo: new Map(), renderMemo: new Map() };
}

export function textEls(ctx: Ctx): El[] {
  const hasBody = ctx.doc.els.some((e) => e.tag === "body");
  return ctx.doc.els.filter((e) => {
    if (!e.children.some((c) => typeof c === "string" && c.trim() !== "")) return false;
    if (RAW_TEXT.has(e.tag)) return false;
    const up = ancestors(e);
    if (hasBody && !up.some((a) => a.tag === "body") && e.tag !== "body") return false;
    if (up.some((a) => ["head", "template", "textarea"].includes(a.tag))) return false;
    return rendered(e, ctx);
  });
}

// Take the largest fenced block when the model wraps its answer, else the
// whole answer. Fences are stripped, never punished.
export function extractHtml(answer: string): string {
  const blocks = [...answer.matchAll(/```(?:html)?\s*([\s\S]*?)```/gi)].map((m) => (m[1] ?? "").trim());
  if (blocks.length === 0) return answer;
  return blocks.sort((a, b) => b.length - a.length)[0] ?? answer;
}

// ---------- checks ----------

function hasHandler(e: El, keys: string[]): boolean {
  return Object.keys(e.attrs).some((k) => keys.includes(k));
}

const MOUSE_HANDLERS = ["onclick", "onmousedown", "onmouseup", "ontouchstart", "onpointerdown"];
const KEY_HANDLERS = ["onkeydown", "onkeyup", "onkeypress"];

const FOCUSABLE = new Set(["a", "area", "button", "input", "select", "textarea", "summary", "iframe", "audio", "video"]);
const INTERACTIVE_ROLES = new Set(["button", "link", "switch", "checkbox", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "radio", "slider", "option", "combobox", "textbox", "searchbox", "spinbutton", "treeitem"]);
const BUTTONISH = /^(cta|btn|button|submit|action)$/i;

function isControl(e: El): boolean {
  if (["button", "select", "textarea", "summary"].includes(e.tag)) return true;
  if (e.tag === "a" || e.tag === "area") return e.attrs["href"] !== undefined;
  if (e.tag === "input") return (e.attrs["type"] ?? "text").toLowerCase() !== "hidden";
  if (INTERACTIVE_ROLES.has((e.attrs["role"] ?? "").toLowerCase())) return true;
  if (hasHandler(e, [...MOUSE_HANDLERS, ...KEY_HANDLERS])) return true;
  const ti = e.attrs["tabindex"];
  return ti !== undefined && Number.isFinite(Number(ti.trim())) && Number(ti.trim()) >= 0;
}

function checkAlt(ctx: Ctx): CheckResult {
  const imgs = ctx.doc.els.filter((e) => e.tag === "img" && rendered(e, ctx));
  const bad = imgs.filter((e) => (e.attrs["alt"] ?? "").trim() === "");
  const silenced = bad.some((e) =>
    e.attrs["alt"] !== undefined
    || ["presentation", "none"].includes((e.attrs["role"] ?? "").toLowerCase())
    || (e.attrs["aria-hidden"] ?? "").toLowerCase() === "true");
  return { id: "missing-alt", pass: bad.length === 0, targets: imgs.length, silenced, detail: bad.length ? `${bad.length}/${imgs.length} images lack text` : `${imgs.length} images labelled` };
}

const SKIPPABLE_INPUT = new Set(["hidden", "submit", "button", "reset", "image"]);

const ID_LOOKUP = new WeakMap<Ctx, Map<string, El>>();
function byId(ctx: Ctx): Map<string, El> {
  let map = ID_LOOKUP.get(ctx);
  if (map === undefined) {
    map = new Map();
    for (const el of ctx.doc.els) {
      const id = el.attrs["id"];
      if (id !== undefined && !map.has(id)) map.set(id, el);
    }
    ID_LOOKUP.set(ctx, map);
  }
  return map;
}

// Resolve an aria-labelledby chain to its name. Every id must point at a
// rendered element and the concatenated text must be non-empty; a dangling
// or empty reference yields no name even when the element also carries an
// aria-label or a real label (labelledby wins in the accName order).
function labelledByName(e: El, ctx: Ctx): { ok: boolean; quieting: boolean } | null {
  const raw = e.attrs["aria-labelledby"];
  if (raw === undefined) return null;
  const ids = raw.trim().split(/\s+/).filter(Boolean);
  if (ids.length === 0) return { ok: false, quieting: true };
  let text = "";
  let quieting = false;
  for (const id of ids) {
    const target = byId(ctx).get(id);
    if (target === undefined || !rendered(target, ctx) || elText(target).trim() === "") quieting = true;
    else text += elText(target);
  }
  return { ok: !quieting && text.trim() !== "", quieting };
}

function checkLabels(ctx: Ctx): CheckResult {
  const fields = ctx.doc.els.filter((e) => ["input", "select", "textarea"].includes(e.tag) && rendered(e, ctx));
  const needing = fields.filter((e) => !SKIPPABLE_INPUT.has((e.attrs["type"] ?? "text").toLowerCase()));
  const labelFor = new Map<string, El>();
  for (const e of ctx.doc.els) if (e.tag === "label" && e.attrs["for"]) labelFor.set(e.attrs["for"] ?? "", e);
  let silenced = false;
  const bad = needing.filter((e) => {
    const al = e.attrs["aria-label"];
    if (al !== undefined && al.trim() === "") silenced = true;
    const named = labelledByName(e, ctx);
    if (named !== null) {
      if (named.ok) return false;
      if (named.quieting) silenced = true;
      return true;
    }
    if ((al ?? "").trim() !== "") return false;
    const lab = e.attrs["id"] !== undefined ? labelFor.get(e.attrs["id"] ?? "") : undefined;
    if (lab !== undefined) {
      if (elText(lab).trim() !== "") return false;
      silenced = true;
    }
    const wrap = ancestors(e).find((a) => a.tag === "label");
    if (wrap !== undefined && elText(wrap).trim() !== "") return false;
    if (wrap !== undefined) silenced = true;
    return true;
  });
  return { id: "unlabeled-input", pass: bad.length === 0, targets: needing.length, silenced, detail: bad.length ? `${bad.length}/${needing.length} fields unlabeled` : `${needing.length} fields labelled` };
}

// Effective backdrop under an element: ancestor background layers
// composited until opaque, white at the root.
function effectiveBackground(el: El, ctx: Ctx): Rgba | "unresolvable" {
  const layers: Rgba[] = [];
  let cur: El | null = el;
  while (cur && cur.tag !== "#root") {
    const b = resolveColor(cur, "background-color", ctx, 0);
    if (b === "unresolvable") return "unresolvable";
    if (b !== "transparent") layers.push(b);
    if (layers.length > 0 && (layers[layers.length - 1]?.a ?? 1) >= 1) break;
    cur = cur.parent;
  }
  let bg: Rgba = { r: 255, g: 255, b: 255, a: 1 };
  for (const l of [...layers].reverse()) bg = over(l, bg);
  return bg;
}

function sameColor(a: Rgba, b: Rgba): boolean {
  return Math.abs(a.r - b.r) < 2 && Math.abs(a.g - b.g) < 2 && Math.abs(a.b - b.b) < 2 && Math.abs(a.a - b.a) < 0.02;
}

function checkContrast(ctx: Ctx): CheckResult {
  const targets = textEls(ctx);
  let bad = 0;
  let min = Infinity;
  for (const el of targets) {
    const fg = resolveColor(el, "color", ctx, 0);
    if (fg === "unresolvable" || fg === "transparent") { bad += 1; continue; }
    const backdrop = effectiveBackground(el, ctx);
    if (backdrop === "unresolvable") { bad += 1; continue; }
    const bg = backdrop;
    const ink = over(fg, bg);
    const size = cascadeNumber(el, "font-size", ctx, 0);
    const weight = cascadeNumber(el, "font-weight", ctx, 0);
    // WCAG 1.4.3: 4.5:1 for normal text, 3:1 for large text
    // (>= 24px, or >= 18.66px when bold).
    const need = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
    const r = ratioOf(ink, bg);
    if (r < min) min = r;
    if (r < need) bad += 1;
  }
  const pass = bad === 0;
  const minText = Number.isFinite(min) ? ` (min ${min.toFixed(2)}:1)` : "";
  return {
    id: "low-contrast", pass, targets: targets.length, silenced: false,
    detail: bad ? `${bad}/${targets.length} text elements below threshold` : `${targets.length} text elements pass${minText}`,
  };
}

function headingLevels(ctx: Ctx): number[] {
  const out: number[] = [];
  for (const e of ctx.doc.els) {
    if (!rendered(e, ctx)) continue;
    const hm = e.tag.match(/^h([1-6])$/);
    if (hm) { out.push(Number(hm[1])); continue; }
    if ((e.attrs["role"] ?? "").toLowerCase() === "heading") {
      const lv = Number(e.attrs["aria-level"] ?? "2");
      out.push(lv >= 1 && lv <= 6 ? Math.floor(lv) : 2);
    }
  }
  return out;
}

function checkHeadings(ctx: Ctx): CheckResult {
  const levels = headingLevels(ctx);
  const fail = (detail: string): CheckResult => ({ id: "heading-order", pass: false, targets: levels.length, silenced: false, detail });
  if (levels.length === 0) return fail("no headings");
  if (levels[0] !== 1) return fail("first heading is not h1");
  if (levels.filter((l) => l === 1).length !== 1) return fail("more than one h1");
  for (let i = 1; i < levels.length; i++) {
    const prev = levels[i - 1] ?? 1;
    const cur = levels[i] ?? 1;
    if (cur > prev + 1) return fail(`h${prev} jumps to h${cur}`);
  }
  return { id: "heading-order", pass: true, targets: levels.length, silenced: false, detail: `order ${levels.join(">")} ok` };
}

// A keyboard trap swallows keys without acting on them: an unconditional
// preventDefault/return false, or one guarded only by a Tab test. A
// handler that cancels a named non-Tab key (Space scroll, Enter) is a
// normal repair and does not count.
const TRAP_CANCEL = /preventdefault|return\s+false/i;
const TRAP_KEY = /key|which|keycode|charcode|\bcode\b/i;
const TRAP_TAB = /["']tab["']|keycode\s*={0,3}\s*9\b|which\s*={0,3}\s*9\b/i;
function trapsKeys(e: El): boolean {
  for (const k of KEY_HANDLERS) {
    const v = e.attrs[k];
    if (v !== undefined && TRAP_CANCEL.test(v) && (!TRAP_KEY.test(v) || TRAP_TAB.test(v))) return true;
  }
  return false;
}

function checkTabindex(ctx: Ctx): CheckResult {
  const bad: string[] = [];
  let silenced = false;
  let seen = 0;
  for (const e of ctx.doc.els) {
    const raw = e.attrs["tabindex"];
    if (raw !== undefined) {
      seen += 1;
      const v = Number(raw.trim());
      const focusable = FOCUSABLE.has(e.tag)
        && !(e.tag === "a" && e.attrs["href"] === undefined)
        && !(e.tag === "input" && (e.attrs["type"] ?? "").toLowerCase() === "hidden");
      if (!Number.isFinite(v) || v > 0 || v < -1 || (v === -1 && focusable)) {
        bad.push(raw.trim());
        if (focusable && Number.isFinite(v) && v < 0) silenced = true;
      }
    }
    if (rendered(e, ctx) && isControl(e) && trapsKeys(e)) {
      bad.push("key trap");
      silenced = true;
    }
  }
  return { id: "tabindex-positive", pass: bad.length === 0, targets: seen, silenced, detail: bad.length ? `bad tab order ${bad.join(",")}` : "natural tab order" };
}

function checkDivButton(ctx: Ctx): CheckResult {
  let bad = 0;
  let silenced = false;
  for (const e of ctx.doc.els) {
    if (!rendered(e, ctx)) continue;
    // A control nested inside a link or button, or placed inside an
    // aria-hidden subtree, is unreachable by keyboard or AT even when
    // the element itself looks repaired.
    if (isControl(e)) {
      const up = ancestors(e);
      if (up.some((a) => (a.tag === "a" && a.attrs["href"] !== undefined) || a.tag === "button")) {
        bad += 1;
        continue;
      }
      if (up.some((a) => (a.attrs["aria-hidden"] ?? "").trim().toLowerCase() === "true")
        || (e.attrs["aria-hidden"] ?? "").trim().toLowerCase() === "true") {
        bad += 1;
        silenced = true;
        continue;
      }
    }
    if (e.tag !== "div" && e.tag !== "span") continue;
    const role = (e.attrs["role"] ?? "").toLowerCase();
    const kb = hasHandler(e, KEY_HANDLERS);
    const handler = hasHandler(e, [...MOUSE_HANDLERS, ...KEY_HANDLERS]);
    const buttonish = (e.attrs["class"] ?? "").split(/\s+/).some((c) => BUTTONISH.test(c))
      && e.children.some((c) => typeof c === "string" && c.trim() !== "");
    const interactiveRole = INTERACTIVE_ROLES.has(role);
    // Role plus keyboard support is a repair only when the element can
    // actually take focus: a non-negative tabindex, like a native control.
    const ti = e.attrs["tabindex"];
    const tabOk = ti !== undefined && Number.isFinite(Number(ti.trim())) && Number(ti.trim()) >= 0;
    if (interactiveRole && kb && tabOk) continue;
    if (handler || interactiveRole || buttonish) {
      bad += 1;
      if (!handler && !interactiveRole) silenced = true;
    }
  }
  return { id: "div-button", pass: bad === 0, targets: bad, silenced, detail: bad ? `${bad} fake buttons` : "native controls" };
}

function checkLang(ctx: Ctx): CheckResult {
  const html = ctx.doc.els.find((e) => e.tag === "html");
  const lang = html?.attrs["lang"];
  const pass = lang !== undefined && lang.trim() !== "";
  const silenced = lang !== undefined && lang.trim() === "";
  return { id: "missing-lang", pass, targets: html ? 1 : 0, silenced, detail: pass ? `lang="${lang?.trim()}"` : "html has no lang" };
}

const NEGATING = /^(none|0|0px|0em|0rem|auto|medium|inherit|initial|unset)$/i;
const INDICATOR_PROPS = /^(outline|outline-width|outline-style|outline-color|box-shadow|border|border-width|border-style|border-color|text-decoration|background|background-color|color)$/;
// Props whose value is a single color the rule paints with.
const COLOR_PROPS = new Set(["color", "background-color", "outline-color", "border-color"]);
// Shorthands that paint with an explicit color: when every color token in
// the value is invisible (transparent or the backdrop itself), the
// indicator is invisible too.
const PAINT_PROPS = new Set(["outline", "border", "box-shadow", "text-decoration"]);
const FOCUS_STATE = /:focus(?:-visible|-within)?\b/;

// Drop every pseudo-class/element so the selector can be matched against
// the base render; a bare ":focus" becomes the universal selector.
// Bracket-aware so attribute values containing colons survive.
function focusBase(sel: string): string {
  let out = "";
  let depth = 0;
  for (let i = 0; i < sel.length; i += 1) {
    const ch = sel[i] ?? "";
    if (ch === "[") depth += 1;
    else if (ch === "]") depth -= 1;
    else if (ch === ":" && depth === 0) {
      let j = i + 1;
      if (sel[j] === ":") j += 1;
      while (j < sel.length && /[\w-]/.test(sel[j] ?? "")) j += 1;
      if (sel[j] === "(") {
        let inner = 0;
        while (j < sel.length) {
          if (sel[j] === "(") inner += 1;
          if (sel[j] === ")") inner -= 1;
          j += 1;
          if (inner <= 0) break;
        }
      }
      i = j - 1;
      continue;
    }
    out += ch;
  }
  const base = out.trim();
  return base === "" || base === "*" ? "*" : base;
}

function hasControlInside(el: El, ctx: Ctx, depth: number): boolean {
  if (depth > 24) return false;
  for (const c of el.children) {
    if (typeof c === "string") continue;
    if (rendered(c, ctx) && (isControl(c) || hasControlInside(c, ctx, depth + 1))) return true;
  }
  return false;
}

// Whether a focus-rule declaration draws something a user can see on this
// element: non-negating values only, never transparent, and never the
// exact color of the backdrop the element already sits on.
function declShowsOn(el: El, d: Decl, ctx: Ctx): boolean {
  const prop = d.prop;
  if (COLOR_PROPS.has(prop) || prop === "background") {
    const token = prop === "background" ? bgColorToken(d.value) : d.value;
    if (prop === "background" && (token === "none" || token === "__unresolvable__")) {
      return /url\(|gradient\(/i.test(d.value);
    }
    const which = prop === "background-color" || prop === "background" ? "background-color" : "color";
    const r = resolveColorString(el, which, token, ctx, 0);
    if (r === "transparent" || r === "unresolvable") return false;
    const bg = effectiveBackground(el, ctx);
    if (bg !== "unresolvable" && sameColor(r, bg)) return false;
    if (prop === "color") {
      const cur = resolveColor(el, "color", ctx, 0);
      if (cur !== "transparent" && cur !== "unresolvable" && sameColor(r, cur)) return false;
    }
    return true;
  }
  const bg = effectiveBackground(el, ctx);
  let meaningful = 0;
  let paintedBg = 0;
  let nonzeroLen = false;
  for (const t of d.value.split(/\s+/)) {
    if (t === "" || NEGATING.test(t)) continue;
    if (/^transparent$/i.test(t)) { paintedBg += 1; continue; }
    const c = parseNumericColor(t);
    if (c !== null) {
      if (bg !== "unresolvable" && sameColor(c, bg)) paintedBg += 1;
      else meaningful += 1;
      continue;
    }
    const len = t.match(/^-?([\d.]+)\s*(?:px|pt|em|rem|%)?$/i);
    if (len !== null && parseFloat(len[1] ?? "0") !== 0) nonzeroLen = true;
    meaningful += 1;
  }
  if (PAINT_PROPS.has(prop) && paintedBg > 0) return false;
  if (prop === "box-shadow") return meaningful > 0 && nonzeroLen;
  return meaningful > 0;
}

function checkFocus(ctx: Ctx): CheckResult {
  let ruleCount = 0;
  let visible = 0;
  for (const el of ctx.doc.els) {
    if (el.styleText === null) continue;
    const css = el.styleText.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of css.matchAll(/([^{}]*:focus[^{}]*){([^}]*)}/gi)) {
      ruleCount += 1;
      // The rule must reach at least one element a keyboard user can
      // focus: its base selector (state pseudos stripped) has to match a
      // rendered control, or - for :focus-within - wrap one.
      const targets = new Set<El>();
      for (const rawSel of (m[1] ?? "").split(",")) {
        if (!FOCUS_STATE.test(rawSel)) continue;
        const sel = parseSelector(focusBase(rawSel));
        if (sel === null) continue;
        const within = /:focus-within\b/.test(rawSel);
        for (const e of ctx.doc.els) {
          if (!matchSelector(e, sel) || !rendered(e, ctx)) continue;
          if (isControl(e) || (within && hasControlInside(e, ctx, 0))) targets.add(e);
        }
      }
      if (targets.size === 0) continue;
      const shows = parseDecls(m[2] ?? "", 0).some((d) =>
        INDICATOR_PROPS.test(d.prop) && [...targets].some((t) => declShowsOn(t, d, ctx)));
      if (shows) visible += 1;
    }
  }
  return {
    id: "no-focus-style", pass: visible > 0, targets: ruleCount, silenced: ruleCount > 0 && visible === 0,
    detail: visible ? "visible focus indicator" : ruleCount ? "focus rules draw no visible indicator" : "no visible focus style",
  };
}

function checkLinks(ctx: Ctx): CheckResult {
  const links = ctx.doc.els.filter((e) => e.tag === "a" && rendered(e, ctx));
  let silenced = false;
  const bad = links.filter((e) => {
    const al = e.attrs["aria-label"];
    const named = labelledByName(e, ctx);
    if (named !== null) {
      if (named.ok) return false;
      if (named.quieting) silenced = true;
      return true;
    }
    if ((al ?? "").trim() !== "") return false;
    if (al !== undefined && al.trim() === "") silenced = true;
    if (decode(elText(e)).trim() !== "") return false;
    const namedImg = e.children.some(function hasAlt(c): boolean {
      if (typeof c === "string") return false;
      if ((c.attrs["alt"] ?? "").trim() !== "") return true;
      return c.children.some(hasAlt);
    });
    return !namedImg;
  });
  return { id: "empty-link", pass: bad.length === 0, targets: links.length, silenced: silenced && bad.length > 0, detail: bad.length ? `${bad.length}/${links.length} links unnamed` : `${links.length} links named` };
}

function checkTables(ctx: Ctx): CheckResult {
  const tables = ctx.doc.els.filter((e) => e.tag === "table" && rendered(e, ctx));
  const bad = tables.filter((t) => !t.children.some(function hasTh(c): boolean {
    if (typeof c === "string") return false;
    if (c.tag === "th" || ["columnheader", "rowheader"].includes((c.attrs["role"] ?? "").toLowerCase())) return true;
    return c.children.some(hasTh);
  }));
  return { id: "table-headers", pass: bad.length === 0, targets: tables.length, silenced: false, detail: bad.length ? `${bad.length}/${tables.length} tables lack headers` : `${tables.length} tables headed` };
}

// Hiding signals are counted on parsed attributes and declarations only,
// so prose containing the word "hidden" or "display" cannot inflate the
// count. Sheet rules come from ctx.rules; inline styles are reparsed.
const HIDE_VALUE: Record<string, RegExp> = {
  display: /^none$/i,
  visibility: /^(?:hidden|collapse)$/i,
  opacity: /^0(?:\.0+)?$/,
  "font-size": /^0(?:[a-z%]*)$/i,
  "text-indent": /^-/,
  color: /^transparent$/i,
};

function hideSignals(ctx: Ctx): number {
  const isHide = (d: Decl) => HIDE_VALUE[d.prop]?.test(d.value.trim()) === true;
  let n = 0;
  for (const e of ctx.doc.els) {
    if (e.attrs["hidden"] !== undefined) n += 1;
    if ((e.attrs["aria-hidden"] ?? "").trim().toLowerCase() === "true") n += 1;
    n += parseDecls(e.attrs["style"] ?? "", 0).filter(isHide).length;
  }
  for (const r of ctx.rules) n += r.decls.filter(isHide).length;
  return n;
}

// ---------- public surface ----------

export function visibleWords(html: string): string[] {
  const ctx = buildCtx(html);
  const doc = ctx.doc;
  const parts: string[] = [];
  const walk = (el: El) => {
    if (!rendered(el, ctx)) return;
    for (const c of el.children) {
      if (typeof c === "string") {
        if (el.tag === "#root" || (!RAW_TEXT.has(el.tag) && !ancestors(el).some((a) => a.tag === "head"))) parts.push(c);
      } else walk(c);
    }
  };
  walk(doc.root);
  const text = decode(parts.join(" ").toLowerCase().replace(/\s+/g, " ").trim());
  return text ? text.split(" ").filter(Boolean) : [];
}

export function analyze(html: string): Analysis {
  const ctx = buildCtx(html);
  const doc = ctx.doc;
  const counts: ElementCounts = { img: 0, input: 0, select: 0, textarea: 0, link: 0, table: 0, button: 0, heading: 0, control: 0 };
  for (const e of doc.els) {
    if (!rendered(e, ctx)) continue;
    if (e.tag === "img") counts.img += 1;
    else if (e.tag === "input") counts.input += 1;
    else if (e.tag === "select") counts.select += 1;
    else if (e.tag === "textarea") counts.textarea += 1;
    else if (e.tag === "a" && e.attrs["href"] !== undefined) counts.link += 1;
    else if (e.tag === "table") counts.table += 1;
    else if (e.tag === "button") counts.button += 1;
    if (/^h[1-6]$/.test(e.tag) || (e.attrs["role"] ?? "").toLowerCase() === "heading") counts.heading += 1;
    if (isControl(e)) counts.control += 1;
  }
  const hideCount = hideSignals(ctx);
  return {
    checks: [
      checkAlt(ctx), checkLabels(ctx), checkContrast(ctx), checkHeadings(ctx),
      checkTabindex(ctx), checkDivButton(ctx), checkLang(ctx), checkFocus(ctx),
      checkLinks(ctx), checkTables(ctx),
    ],
    words: visibleWords(html),
    counts,
    hideCount,
  };
}
