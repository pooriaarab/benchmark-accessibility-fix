# Accessibility Fix paper

This packet studies static HTML repair and preservation of content.
It includes scripted controls and a clearly labeled simulated population experiment.
No learned model or human study is included. No venue submission is authorized.

Install Node 22 with npm 10, Python 3, Tectonic, and Poppler (`pdfinfo`, `pdftotext`).
Run from the repository root:

```sh
npm ci
sh paper/template/reproduce.sh
```

The command builds `paper/accessibility-fix-paper.pdf` and verifies the results.
The shared pilot template is copied unchanged. The build verifies the official style archive hash.
The first build needs internet access for the style and TeX packages. Experiments use no network or credentials.
PDFs and downloaded styles remain untracked. The paper and figures use CC-BY-4.0; code and tasks remain MIT.

`config.json` records the frozen source revision and the study-plan commit.
`data/runs.generated.json` stores full answers and actual public runner reports.
`data/repeat.generated.json` stores repeated reports and semantic hashes without timings.
`data/simulation.generated.json` stores every simulated choice and its paired scores.
`data/summary.generated.json` supplies confidence intervals and corpus coverage.
`data/verification.generated.json` records public re-scoring, hash checks, and PDF checks.
Generated files are reproducible outputs. Do not edit them by hand.

Task-level intervals describe hypothetical sampling within the fixed template families.
Simulated intervals resample agents, retaining each agent's task vector.
Boundary bootstrap intervals collapse; the control table also reports Wilson intervals.
The plan is committed before results but is not externally registered.
The template fixer comes from the benchmark's existing public E2E probe.
The study does not run free hosted models or establish their availability.
The clipped-reference result exposes a known static-analysis limit. It does not test browser behavior.
