# Grading notes for benchmark-accessibility-fix

This file is written BEFORE the grader code. It lists how the
deterministic grader can fail or be gamed, and what it does about each
case. The analyzer itself lives in `src/a11y.ts` and stays
dependency-free: a light HTML parser plus a small CSS cascade
(specificity, source order, inheritance), no browser and no runtime
layout engine.

## Checks

Ten checks run on the submitted HTML document. Each cites one WCAG 2.2
criterion by number only:

| Check | WCAG 2.2 | Rule |
| --- | --- | --- |
| `missing-alt` | 1.1.1 | Every rendered `img` has a non-empty `alt` attribute. |
| `unlabeled-input` | 3.3.2 | Every `input`, `select`, `textarea` has a `label`, `aria-label`, or `aria-labelledby` with real text. |
| `low-contrast` | 1.4.3 | Every rendered text element reaches 4.5:1, or 3:1 for large text (>= 24px, or >= 18.66px bold), after cascade and inheritance. |
| `heading-order` | 1.3.1 | First heading is `h1`, exactly one `h1`, no skipped levels going up. `role="heading"` with `aria-level` counts. |
| `tabindex-positive` | 2.4.3 | No `tabindex` greater than zero; no negative `tabindex` on a natively focusable element (it drops the control from the tab order). |
| `div-button` | 4.1.2 | No `div` or `span` that acts like a control: mouse/keyboard handlers, an interactive role without keyboard support, or a button-styled dead element. A `role="button"` with a keyboard handler passes only with a `tabindex` of 0 or more, so the element can take keyboard focus. |
| `missing-lang` | 3.1.1 | The `html` element carries a non-empty `lang`. |
| `no-focus-style` | 2.4.7 | A `:focus`/`:focus-visible`/`:focus-within` rule draws a visible indicator: outline, border, shadow, background, or text decoration that is not `none`/`0`/`transparent` and not the same color as the backdrop. The rule's selector (state pseudos stripped) must match a rendered focusable element; a rule that matches nothing, or only paints invisible colors, does not count. |
| `empty-link` | 2.4.4 | Every `a` has text, a non-empty `aria-label`, or an image with `alt`. |
| `table-headers` | 1.3.1 | Every `table` contains at least one `th` or a cell with `role="columnheader"`/`"rowheader"`. |

Comments (`<!-- -->` in HTML, `/* */` in CSS) are stripped before any
check runs, so commented-out markup cannot fail a check and commented-out
rules cannot pass one.

## Ways the grader can fail, and the answer to each

1. **Unchanged page.** The broken page scores 0 because none of its
   injected defects move to passing.
2. **Empty or random answers.** No parseable document means every check
   fails and the text-preservation ratio is 0, so the score is 0.
3. **Confident non-fix ("always yes").** Prose such as "this page is
   accessible" carries no fixed elements and scores 0.
4. **Deleting the offender.** Removing an image, input, link, table,
   heading, or interactive control instead of repairing it drops the
   element count and the score is 0.
5. **Hiding the offender.** New `display: none`, `visibility: hidden`,
   `aria-hidden="true"`, `hidden`, `opacity: 0`, zero font-size,
   off-screen `text-indent`, or `color: transparent` compared with the
   original page scores 0.
6. **Fixing one defect while adding another.** Checks that passed on the
   original page and fail on the fixed page count as regressions and
   subtract half a defect each.
7. **Markdown fences.** The grader strips code fences before it parses,
   so fenced answers are graded on their HTML, not punished.
8. **Color formats.** Contrast resolves `#rgb`, `#rgba`, `#rrggbb`,
   `#rrggbbaa`, `rgb()`, `hsl()`, the named-color list, `var()` custom
   properties, `transparent`, `none`, `currentColor`, `inherit`, and the
   cascade (specificity then source order; pseudo-state rules like
   `:hover` do not apply to the base render). A value that still cannot
   be resolved fails the check.
9. **Duplicate or shifted headings.** Adding a second `h1` or skipping
   a level fails the heading check even when every other fix is right.
10. **Partial fixes.** Fixing one of three injected defects earns about
    one third of the points. Partial credit is intentional.
11. **Checker-silencing gestures.** A defect that still fails counts as
    silenced - and the whole task scores 0 - when the answer quieted the
    checker instead of repairing it: `alt=""` on a content image,
    `role="presentation"` or `aria-hidden` on the image, an empty
    `aria-label`/`aria-labelledby` or empty `label`, `lang=""`,
    `tabindex="-1"` on a link or control, focus rules that only remove
    indicators (`outline: none`), an empty link label, or removing the
    `onclick` from a `div` while leaving the dead control-looking
    element in place. Deleting every `style` block and `style` attribute
    counts too: default browser colors passing contrast is not a fix.

## Score shape

`score = (fixed - 0.5 * regressions) / injected`, clamped to 0..1. The
score is 0 outright when the answer loses text (`contentRatio < 0.9`),
removes elements, hides content that was visible, deletes the page's
styles, or silences an injected defect. The details object reports
`defectsFixed`, `regressions`, `contentLost`, `hideAbuse`,
`elementRemoved`, `stylesDeleted`, `silenced`, and `autoZero`
separately, plus `tier` when the task metadata carries one.

## Limits

The analyzer is static: it cannot run layout, zoom, or assistive
technology, and pseudo-state styling (`:hover`, `:active`, focus styles
beyond the dedicated check) is not exercised. Real user testing still
matters.
