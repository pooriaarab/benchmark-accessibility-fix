# Grading notes for benchmark-accessibility-fix

This file is written BEFORE the grader code. It lists how the
deterministic grader can fail or be gamed, and what it does about each
case. The analyzer itself lives in `src/a11y.ts` and stays
dependency-free (regular expressions only, no browser, no axe-core).

## Checks

Ten checks run on the submitted HTML document. Each cites one WCAG 2.2
criterion by number only:

| Check | WCAG 2.2 | Rule |
| --- | --- | --- |
| `missing-alt` | 1.1.1 | Every `img` has a non-empty `alt` attribute. |
| `unlabeled-input` | 3.3.2 | Every `input`, `select`, `textarea` has a `label`, `aria-label`, or `aria-labelledby`. |
| `low-contrast` | 1.4.3 | Every declared text/background color pair reaches 4.5:1. |
| `heading-order` | 1.3.1 | First heading is `h1`, exactly one `h1`, no skipped levels going up. |
| `tabindex-positive` | 2.4.3 | No `tabindex` greater than zero. |
| `div-button` | 4.1.2 | No `div` or `span` with `onclick` or `role="button"`. |
| `missing-lang` | 3.1.1 | The `html` element carries a non-empty `lang`. |
| `no-focus-style` | 2.4.7 | A `:focus` rule draws a visible outline, shadow, or border. |
| `empty-link` | 2.4.4 | Every `a` has text, an `aria-label`, or an image with `alt`. |
| `table-headers` | 1.3.1 | Every `table` contains at least one `th`. |

## Ways the grader can fail, and the answer to each

1. **Unchanged page.** The broken page scores 0 because none of its
   injected defects move to passing.
2. **Empty or random answers.** No parseable document means every check
   fails and the text-preservation ratio is 0, so the score is 0.
3. **Confident non-fix ("always yes").** Prose such as "this page is
   accessible" carries no fixed elements and scores 0.
4. **Deleting the offender.** Removing an image, input, link, or table
   instead of repairing it trips the element-removal penalty and usually
   the text-preservation penalty too.
5. **Hiding the offender.** New `display: none`, `visibility: hidden`,
   or `aria-hidden="true"` compared with the original page trips the
   hiding penalty.
6. **Fixing one defect while adding another.** Checks that passed on the
   original page and fail on the fixed page count as regressions and
   subtract half a defect each.
7. **Markdown fences.** The grader strips code fences before it parses,
   so fenced answers are graded on their HTML, not punished.
8. **Unknown color formats.** Contrast understands `#rgb`, `#rrggbb`,
   and a small named-color list. Anything else cannot be verified and
   fails the contrast check, so fixes should use hex colors.
9. **Duplicate or shifted headings.** Adding a second `h1` or skipping
   a level fails the heading check even when every other fix is right.
10. **Partial fixes.** Fixing one of three injected defects earns about
    one third of the points. Partial credit is intentional.
11. **Browser-only issues.** The static analyzer cannot run layout,
    zoom, or assistive technology. Real user testing still matters, and
    the README says so. The optional axe-core and Playwright pass stays
    off by default and never changes the score.

## Score shape

`score = (fixed - 0.5 * regressions - contentLost - hideAbuse -
elementRemoved) / injected`, clamped to 0..1. The details object
reports `defectsFixed`, `regressions`, and `contentLost` separately.
