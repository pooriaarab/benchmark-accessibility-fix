// Dependency-free render engine for the accessibility analyzer: a light
// HTML parser feeding a small CSS cascade (specificity, source order,
// inheritance for color and font-size). Colors resolve from hex 3/4/6/8,
// rgb()/hsl(), named colors, var() properties, transparent, none,
// currentColor and inherit. Comments are stripped before parsing.
// Full CSS named-color list, packed name=r,g,b to keep the table small.
const NAMED_SRC =
  "black=0,0,0 silver=192,192,192 gray=128,128,128 grey=128,128,128 white=255,255,255 maroon=128,0,0 red=255,0,0 purple=128,0,128" +
  "fuchsia=255,0,255 magenta=255,0,255 green=0,128,0 lime=0,255,0 olive=128,128,0 yellow=255,255,0 navy=0,0,128 blue=0,0,255" +
  "teal=0,128,128 aqua=0,255,255 cyan=0,255,255 orange=255,165,0 aliceblue=240,248,255 antiquewhite=250,235,215 aquamarine=127,255,212 azure=240,255,255" +
  "beige=245,245,220 bisque=255,228,196 blanchedalmond=255,235,205 blueviolet=138,43,226 brown=165,42,42 burlywood=222,184,135 cadetblue=95,158,160 chartreuse=127,255,0" +
  "chocolate=210,105,30 coral=255,127,80 cornflowerblue=100,149,237 cornsilk=255,248,220 crimson=220,20,60 darkblue=0,0,139 darkcyan=0,139,139 darkgoldenrod=184,134,11" +
  "darkgray=169,169,169 darkgrey=169,169,169 darkgreen=0,100,0 darkkhaki=189,183,107 darkmagenta=139,0,139 darkolivegreen=85,107,47 darkorange=255,140,0 darkorchid=153,50,204" +
  "darkred=139,0,0 darksalmon=233,150,122 darkseagreen=143,188,143 darkslateblue=72,61,139 darkslategray=47,79,79 darkslategrey=47,79,79 darkturquoise=0,206,209 darkviolet=148,0,211" +
  "deeppink=255,20,147 deepskyblue=0,191,255 dimgray=105,105,105 dimgrey=105,105,105 dodgerblue=30,144,255 firebrick=178,34,34 floralwhite=255,250,240 forestgreen=34,139,34" +
  "gainsboro=220,220,220 ghostwhite=248,248,255 gold=255,215,0 goldenrod=218,165,32 greenyellow=173,255,47 honeydew=240,255,240 hotpink=255,105,180 indianred=205,92,92" +
  "indigo=75,0,130 ivory=255,255,240 khaki=240,230,140 lavender=230,230,250 lavenderblush=255,240,245 lawngreen=124,252,0 lemonchiffon=255,250,205 lightblue=173,216,230" +
  "lightcoral=240,128,128 lightcyan=224,255,255 lightgoldenrodyellow=250,250,210 lightgray=211,211,211 lightgrey=211,211,211 lightgreen=144,238,144 lightpink=255,182,193 lightsalmon=255,160,122" +
  "lightseagreen=32,178,170 lightskyblue=135,206,250 lightslategray=119,136,153 lightslategrey=119,136,153 lightsteelblue=176,196,222 lightyellow=255,255,224 limegreen=50,205,50 linen=250,240,230" +
  "mediumaquamarine=102,205,170 mediumblue=0,0,205 mediumorchid=186,85,211 mediumpurple=147,112,219 mediumseagreen=60,179,113 mediumslateblue=123,104,238 mediumspringgreen=0,250,154 mediumturquoise=72,209,204" +
  "mediumvioletred=199,21,133 midnightblue=25,25,112 mintcream=245,255,250 mistyrose=255,228,225 moccasin=255,228,181 navajowhite=255,222,173 oldlace=253,245,230 olivedrab=107,142,35" +
  "orangered=255,69,0 orchid=218,112,214 palegoldenrod=238,232,170 palegreen=152,251,152 paleturquoise=175,238,238 palevioletred=219,112,147 papayawhip=255,239,213 peachpuff=255,218,185" +
  "peru=205,133,63 pink=255,192,203 plum=221,160,221 powderblue=176,224,230 rebeccapurple=102,51,153 rosybrown=188,143,143 royalblue=65,105,225 saddlebrown=139,69,19" +
  "salmon=250,128,114 sandybrown=244,164,96 seagreen=46,139,87 seashell=255,245,238 sienna=160,82,45 skyblue=135,206,235 slateblue=106,90,205 slategray=112,128,144" +
  "slategrey=112,128,144 snow=255,250,250 springgreen=0,255,127 steelblue=70,130,180 tan=210,180,140 thistle=216,191,216 tomato=255,99,71 turquoise=64,224,208" +
  "violet=238,130,238 wheat=245,222,179 whitesmoke=245,245,245 yellowgreen=154,205,50";

const NAMED = new Map<string, [number, number, number]>((NAMED_SRC.match(/[a-z]+=\d+,\d+,\d+/g) ?? []).map((e) => {
  const [k, v] = e.split("=");
  const [r, g, b] = (v ?? "").split(",").map(Number);
  return [k ?? "", [r ?? 0, g ?? 0, b ?? 0]];
}));

export interface Rgba { r: number; g: number; b: number; a: number }

// hex 3/4/6/8, rgb()/rgba(), hsl()/hsla(), named colors. Returns null when
// the token is not a color; keywords like inherit and var() are resolved
// by the cascade, not here.
export function parseNumericColor(v: string): Rgba | null {
  const t = v.trim().toLowerCase();
  const hex = t.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    let h = hex[1] ?? "";
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    if (h.length === 6) h += "ff";
    if (h.length !== 8) return null;
    return {
      r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16), a: parseInt(h.slice(6, 8), 16) / 255,
    };
  }
  const named = NAMED.get(t);
  if (named) { const [r, g, b] = named; return { r, g, b, a: 1 }; }
  const fn = t.match(/^(rgba?|hsla?)\((.*)\)$/);
  if (fn) {
    const name = fn[1] ?? "";
    const body = (fn[2] ?? "").replace(/[/,]/g, " ");
    const parts = body.trim().split(/\s+/).filter(Boolean);
    if (parts.length < 3) return null;
    const num = (s: string, scale: number) => s.endsWith("%") ? parseFloat(s) * scale / 100 : parseFloat(s);
    const alpha = parts[3] === undefined ? 1 : Math.min(1, Math.max(0, num(parts[3], 1)));
    if (name.startsWith("rgb")) {
      const [r, g, b] = parts.map((p) => num(p, 255));
      if ([r, g, b].some(Number.isNaN)) return null;
      return { r: r ?? 0, g: g ?? 0, b: b ?? 0, a: alpha };
    }
    const h = (((parseFloat(parts[0] ?? "") % 360) + 360) % 360) / 360;
    const s = num(parts[1] ?? "", 100);
    const l = num(parts[2] ?? "", 100);
    if ([h, s, l].some(Number.isNaN) || s < 0 || s > 100 || l < 0 || l > 100) return null;
    const sn = s / 100; const ln = l / 100;
    const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
    const p = 2 * ln - q;
    const hue = (t2: number) => {
      let x = t2;
      if (x < 0) x += 1; if (x > 1) x -= 1;
      if (x < 1 / 6) return p + (q - p) * 6 * x;
      if (x < 1 / 2) return q;
      if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
      return p;
    };
    return { r: hue(h + 1 / 3) * 255, g: hue(h) * 255, b: hue(h - 1 / 3) * 255, a: alpha };
  }
  return null;
}

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(c: Rgba): number {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

export function ratioOf(a: Rgba, b: Rgba): number {
  return (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
}

// Composite a possibly translucent layer over the backdrop beneath it.
export function over(fg: Rgba, bg: Rgba): Rgba {
  const a = fg.a + bg.a * (1 - fg.a);
  if (a === 0) return { r: 255, g: 255, b: 255, a: 1 };
  return {
    r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
    g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
    b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
    a,
  };
}

// ---------- light DOM ----------

export interface El {
  tag: string;
  attrs: Record<string, string>;
  parent: El | null;
  children: (El | string)[];
  order: number;
  styleText: string | null;
}

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
export const RAW_TEXT = new Set(["style", "script", "title", "textarea"]);

function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of src.matchAll(/([\w-]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>"']+)))?/g)) {
    const name = (m[1] ?? "").toLowerCase();
    if (name && attrs[name] === undefined) attrs[name] = m[3] ?? m[4] ?? m[5] ?? "";
  }
  return attrs;
}

export interface Doc { root: El; els: El[] }

export function parseDoc(html: string): Doc {
  const clean = html.replace(/<!--[\s\S]*?-->/g, "");
  const root: El = { tag: "#root", attrs: {}, parent: null, children: [], order: -1, styleText: null };
  const els: El[] = [];
  let cur = root;
  let i = 0;
  while (i < clean.length) {
    const lt = clean.indexOf("<", i);
    const text = lt === -1 ? clean.slice(i) : clean.slice(i, lt);
    if (text) cur.children.push(text);
    if (lt === -1) break;
    const m = /^<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^'"<>])*)(\/?)>/.exec(clean.slice(lt));
    if (!m) { i = lt + 1; continue; }
    const tag = (m[2] ?? "").toLowerCase();
    i = lt + m[0].length;
    if (m[1] === "/") {
      let p: El = cur;
      while (p.parent !== null && p.tag !== tag) p = p.parent;
      if (p.tag === tag && p.parent) cur = p.parent;
      continue;
    }
    const el: El = { tag, attrs: parseAttrs(m[3] ?? ""), parent: cur, children: [], order: els.length, styleText: null };
    cur.children.push(el);
    els.push(el);
    if (RAW_TEXT.has(tag)) {
      const end = clean.toLowerCase().indexOf(`</${tag}`, i);
      const raw = end === -1 ? clean.slice(i) : clean.slice(i, end);
      el.children.push(raw);
      if (tag === "style") el.styleText = raw;
      i = end === -1 ? clean.length : end;
      continue;
    }
    if (!VOID.has(tag) && m[4] !== "/") cur = el;
  }
  return { root, els };
}

export function ancestors(el: El): El[] {
  const out: El[] = [];
  let p = el.parent;
  while (p && p.tag !== "#root") { out.push(p); p = p.parent; }
  return out;
}

export function elText(el: El): string {
  let out = "";
  for (const c of el.children) out += typeof c === "string" ? `${c} ` : `${elText(c)} `;
  return out;
}

export function decode(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ");
}

// ---------- tiny CSS cascade ----------

export interface Decl { prop: string; value: string; important: boolean; order: number }
export interface Compound { tag: string | null; id: string | null; classes: string[]; attrs: [string, string | null][]; rootPseudo: boolean }
export interface Selector { spec: number; parts: { comb: " " | ">"; c: Compound }[] }
export interface Rule { sels: Selector[]; decls: Decl[] }

export function parseDecls(body: string, orderBase: number): Decl[] {
  const decls: Decl[] = [];
  body.replace(/\/\*[\s\S]*?\*\//g, "").split(";").forEach((piece, idx) => {
    const m = piece.match(/^\s*(--[\w-]+|[a-zA-Z-]+)\s*:\s*(.+?)\s*$/);
    if (!m) return;
    let value = (m[2] ?? "").trim();
    let important = false;
    if (/!important\s*$/i.test(value)) { important = true; value = value.replace(/!important\s*$/i, "").trim(); }
    decls.push({ prop: (m[1] ?? "").toLowerCase(), value, important, order: orderBase + idx });
  });
  return decls;
}

// Parses one complex selector. Returns null for anything the cascade does
// not support: pseudo-classes other than :root (state rules like :hover
// never apply to the base render), combinators + and ~, and functional
// pseudos like :not().
export function parseSelector(src: string): Selector | null {
  const s = src.trim();
  if (!s || /[+~]/.test(s) || /:(?!root\b)[\w-]+/.test(s)) return null;
  const tokens = s.split(/\s*(>)\s*|\s+/).filter((x): x is string => !!x);
  const parts: Selector["parts"] = [];
  let comb: " " | ">" = " ";
  let spec = 0;
  for (const tok of tokens) {
    if (tok === ">") { comb = ">"; continue; }
    const c: Compound = { tag: null, id: null, classes: [], attrs: [], rootPseudo: false };
    for (const m of tok.matchAll(/\[([^\]]*)\]|([#.:*]?[\w-]+)/g)) {
      const t = m[0];
      if (t === "*") continue;
      if (t.startsWith(".")) { c.classes.push(t.slice(1)); spec += 10; }
      else if (t.startsWith("#")) { c.id = t.slice(1); spec += 100; }
      else if (t.startsWith("[")) {
        const am = (m[1] ?? "").match(/^([\w-]+)(?:\s*=\s*["']?([^"']*)["']?)?$/);
        if (!am) return null;
        c.attrs.push([(am[1] ?? "").toLowerCase(), am[2] ?? null]); spec += 10;
      } else if (t.startsWith(":")) {
        if (t === ":root") c.rootPseudo = true; else return null;
      } else { c.tag = t.toLowerCase(); spec += 1; }
    }
    parts.push({ comb, c });
    comb = " ";
  }
  return parts.length ? { spec, parts } : null;
}

export function matchCompound(el: El, c: Compound): boolean {
  if (c.rootPseudo && el.tag !== "html") return false;
  if (c.tag !== null && c.tag !== el.tag) return false;
  if (c.id !== null && el.attrs["id"] !== c.id) return false;
  const cls = (el.attrs["class"] ?? "").split(/\s+/).filter(Boolean);
  if (c.classes.some((k) => !cls.includes(k))) return false;
  return c.attrs.every(([name, val]) =>
    el.attrs[name] !== undefined && (val === null || el.attrs[name] === val));
}

export function matchSelector(el: El, sel: Selector): boolean {
  let cur: El = el;
  for (let i = sel.parts.length - 1; i >= 0; i--) {
    const part = sel.parts[i]!;
    if (i === sel.parts.length - 1) {
      if (!matchCompound(cur, part.c)) return false;
    } else if (part.comb === ">") {
      const p = cur.parent;
      if (!p || p.tag === "#root" || !matchCompound(p, part.c)) return false;
      cur = p;
    } else {
      let p: El | null = cur.parent;
      while (p && p.tag !== "#root" && !matchCompound(p, part.c)) p = p.parent;
      if (!p || p.tag === "#root") return false;
      cur = p;
    }
  }
  return true;
}

function rankOf(decl: Decl, spec: number, inline: boolean): [number, number, number] {
  if (decl.important) return [2, inline ? 1_000_000 : spec, decl.order];
  return [1, inline ? 1_000_000 : spec, decl.order];
}

function better(a: [number, number, number], b: [number, number, number]): boolean {
  return a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] >= b[2])));
}

// Winning declared value for one property on one element. The `background`
// shorthand also supplies `background-color` so a later shorthand can
// override an earlier longhand in source order.
export function cascaded(el: El, prop: string, rules: Rule[]): string | undefined {
  let best: string | undefined;
  let rank: [number, number, number] = [-1, -1, -1];
  const supplies = (d: Decl) => d.prop === prop || (prop === "background-color" && d.prop === "background");
  for (const rule of rules) {
    let spec = -1;
    for (const sel of rule.sels) if (matchSelector(el, sel)) spec = Math.max(spec, sel.spec);
    if (spec < 0) continue;
    for (const d of rule.decls) {
      if (!supplies(d)) continue;
      const r = rankOf(d, spec, false);
      if (better(r, rank)) { rank = r; best = d.value; }
    }
  }
  for (const d of parseDecls(el.attrs["style"] ?? "", 0)) {
    if (!supplies(d)) continue;
    const r = rankOf(d, 0, true);
    if (better(r, rank)) { rank = r; best = d.value; }
  }
  return best;
}

export function cascadedCustom(el: El, name: string, rules: Rule[], memo: Map<string, string | null>, depth: number): string | null {
  const key = `${el.order}:${name}`;
  if (memo.has(key)) return memo.get(key) ?? null;
  let best: string | null = null;
  let rank: [number, number, number] = [-1, -1, -1];
  for (const rule of rules) {
    let spec = -1;
    for (const sel of rule.sels) if (matchSelector(el, sel)) spec = Math.max(spec, sel.spec);
    if (spec < 0) continue;
    for (const d of rule.decls) {
      if (d.prop !== name) continue;
      const r = rankOf(d, spec, false);
      if (better(r, rank)) { rank = r; best = d.value; }
    }
  }
  for (const d of parseDecls(el.attrs["style"] ?? "", 0)) {
    if (d.prop !== name) continue;
    const r = rankOf(d, 0, true);
    if (better(r, rank)) { rank = r; best = d.value; }
  }
  if (best === null && depth < 8 && el.parent && el.parent.tag !== "#root") {
    best = cascadedCustom(el.parent, name, rules, memo, depth + 1);
  }
  memo.set(key, best);
  return best;
}

// Extract the solid-color token from a background shorthand, if any.
export function bgColorToken(value: string): string {
  const t0 = value.trim().toLowerCase();
  // The whole declaration can itself be a color, including functional
  // forms like rgb()/hsl() which contain no standalone color token.
  if (parseNumericColor(t0)) return t0;
  if (/^(var\(|currentcolor$|transparent$|none$|inherit$|initial$|unset$|auto$)/.test(t0) && !/[\s,]/.test(t0)) return t0;
  const fn = t0.match(/(?:rgba?|hsla?)\([^)]*\)/);
  if (fn && parseNumericColor(fn[0] ?? "")) return fn[0] ?? t0;
  const tokens = t0.replace(/\([^)]*\)/g, " ").split(/[\s,]+/).filter(Boolean);
  for (const t of tokens) {
    if (parseNumericColor(t)) return t;
  }
  return /[(]/.test(value) ? "__unresolvable__" : "none";
}

export type Resolved = Rgba | "transparent" | "unresolvable";

export interface Ctx {
  doc: Doc;
  rules: Rule[];
  colorMemo: Map<string, Resolved>;
  customMemo: Map<string, string | null>;
  numMemo: Map<string, number>;
  renderMemo: Map<number, boolean>;
}

export function resolveColor(el: El, prop: "color" | "background-color", ctx: Ctx, depth: number): Resolved {
  const key = `${prop}@${el.order}`;
  const hit = ctx.colorMemo.get(key);
  if (hit !== undefined) return hit;
  if (depth > 8) return "unresolvable";
  const parent = el.parent && el.parent.tag !== "#root" ? el.parent : null;
  const declared = cascaded(el, prop, ctx.rules);
  const v = prop === "background-color" && declared !== undefined ? bgColorToken(declared) : declared;
  let out: Resolved;
  const fallback: Resolved = prop === "color" ? { r: 0, g: 0, b: 0, a: 1 } : "transparent";
  const inherit = () => parent ? resolveColor(parent, prop, ctx, depth + 1) : fallback;
  if (v === undefined || v === null) {
    out = prop === "color" ? inherit() : "transparent";
  } else {
    const t = v.trim().toLowerCase();
    const varm = t.match(/^var\(\s*(--[\w-]+)\s*(?:,([\s\S]*))?\)$/);
    if (varm) {
      const custom = cascadedCustom(el, varm[1] ?? "", ctx.rules, ctx.customMemo, 0);
      out = custom !== null ? resolveColorString(el, prop, custom, ctx, depth + 1)
        : varm[2] !== undefined ? resolveColorString(el, prop, varm[2], ctx, depth + 1) : "unresolvable";
    } else if (t === "inherit" || t === "unset") {
      out = inherit();
    } else if (t === "currentcolor") {
      out = prop === "color" ? inherit() : resolveColor(el, "color", ctx, depth + 1);
    } else if (t === "initial" || t === "transparent" || t === "none" || t === "auto") {
      out = t === "initial" && prop === "color" ? { r: 0, g: 0, b: 0, a: 1 } : "transparent";
    } else {
      out = parseNumericColor(t) ?? "unresolvable";
    }
  }
  ctx.colorMemo.set(key, out);
  return out;
}

export function resolveColorString(el: El, prop: "color" | "background-color", raw: string, ctx: Ctx, depth: number): Resolved {
  if (depth > 8) return "unresolvable";
  const t = raw.trim().toLowerCase();
  const varm = t.match(/^var\(\s*(--[\w-]+)\s*(?:,([\s\S]*))?\)$/);
  if (varm) {
    const custom = cascadedCustom(el, varm[1] ?? "", ctx.rules, ctx.customMemo, 0);
    return custom !== null ? resolveColorString(el, prop, custom, ctx, depth + 1)
      : varm[2] !== undefined ? resolveColorString(el, prop, varm[2], ctx, depth + 1) : "unresolvable";
  }
  if (t === "transparent" || t === "none") return "transparent";
  if (t === "currentcolor") return resolveColor(el, "color", ctx, depth + 1);
  if (t === "inherit" || t === "unset" || t === "initial") {
    const parent = el.parent && el.parent.tag !== "#root" ? el.parent : null;
    if (t === "initial") return prop === "color" ? { r: 0, g: 0, b: 0, a: 1 } : "transparent";
    return parent ? resolveColor(parent, prop, ctx, depth + 1)
      : prop === "color" ? { r: 0, g: 0, b: 0, a: 1 } : "transparent";
  }
  return parseNumericColor(t) ?? "unresolvable";
}

// Unwrap @media/@supports blocks so their inner rules still grade. An
// approximation: media conditions are ignored and inner rules apply.
export function unwrapAtRules(css: string): string {
  let out = css;
  const re = /@[\w-]+[^{}]*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(out)) !== null) {
    let depth = 1;
    let j = m.index + m[0].length;
    while (j < out.length && depth > 0) {
      if (out[j] === "{") depth += 1;
      else if (out[j] === "}") depth -= 1;
      j += 1;
    }
    out = out.slice(0, m.index) + out.slice(m.index + m[0].length, j - 1) + out.slice(j);
    re.lastIndex = m.index;
  }
  return out;
}

export function styleRules(doc: Doc): Rule[] {
  const rules: Rule[] = [];
  let order = 0;
  for (const el of doc.els) {
    if (el.styleText === null) continue;
    const css = unwrapAtRules(el.styleText.replace(/\/\*[\s\S]*?\*\//g, ""));
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sels = (m[1] ?? "").split(",").map(parseSelector).filter((s): s is Selector => s !== null);
      const decls = parseDecls(m[2] ?? "", order);
      order += decls.length;
      if (sels.length && decls.length) rules.push({ sels, decls });
    }
  }
  return rules;
}

export function cascadeNumber(el: El, prop: "font-size" | "font-weight", ctx: Ctx, depth: number): number {
  const key = `${prop}@${el.order}`;
  const hit = ctx.numMemo.get(key);
  if (hit !== undefined) return hit;
  const parent = el.parent && el.parent.tag !== "#root" ? el.parent : null;
  const parentVal = parent && depth < 16 ? cascadeNumber(parent, prop, ctx, depth + 1) : prop === "font-size" ? 16 : 400;
  let out = parentVal;
  const v = cascaded(el, prop, ctx.rules);
  if (v !== undefined) {
    const t = v.trim().toLowerCase();
    if (prop === "font-size") {
      const kw: Record<string, number> = { "xx-small": 9, "x-small": 10, small: 13, medium: 16, large: 18, "x-large": 24, "xx-large": 32, smaller: parentVal / 1.2, larger: parentVal * 1.2, inherit: parentVal };
      const m = t.match(/^([\d.]+)\s*(px|pt|em|rem|%)?$/);
      if (m) {
        const n = parseFloat(m[1] ?? "");
        const u = m[2] ?? "px";
        if (!Number.isNaN(n)) {
          out = u === "pt" ? n * 4 / 3
            : u === "%" ? parentVal * n / 100
              : u === "em" ? parentVal * n
                : u === "rem" ? 16 * n : n;
        }
      } else if (kw[t] !== undefined) out = kw[t] ?? parentVal;
    } else {
      const m = t.match(/^(\d{1,3})$/);
      if (m) out = Math.min(900, Math.max(100, parseInt(m[1] ?? "400", 10)));
      else if (t === "bold" || t === "bolder") out = 700;
      else if (t === "lighter") out = Math.max(100, parentVal - 300);
      else if (t === "normal" || t === "inherit") out = t === "inherit" ? parentVal : 400;
    }
  }
  ctx.numMemo.set(key, out);
  return out;
}

export function rendered(el: El, ctx: Ctx): boolean {
  const hit = ctx.renderMemo.get(el.order);
  if (hit !== undefined) return hit;
  let out = true;
  if (el.tag === "template" || el.attrs["hidden"] !== undefined) out = false;
  else {
    const disp = cascaded(el, "display", ctx.rules)?.trim().toLowerCase();
    const vis = cascaded(el, "visibility", ctx.rules)?.trim().toLowerCase();
    if (disp === "none" || vis === "hidden" || vis === "collapse") out = false;
  }
  if (out && el.parent && el.parent.tag !== "#root") out = rendered(el.parent, ctx);
  ctx.renderMemo.set(el.order, out);
  return out;
}


