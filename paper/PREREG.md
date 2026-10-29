# Accessibility repair study plan

Written before collecting this study's results. The accepted honesty pilot informs layout only.
No independent registration or publication is authorized. This Git commit records ordering, not external registration.

## Questions and design
H1: Reference HTML scores above unchanged HTML on the complete public task set.
H2: A template fixer separates easy and hard task means. This is a descriptive tier comparison, not randomized difficulty.
H3: Adding display:none to a reference main element causes the preservation gate to reject the answer.
H4: A simulated population with more hiding attempts earns less guarded credit despite fixed repair ability.
The primary metric is the package's mean bounded repair score. Secondary metrics are full-score frequency and automatic-zero frequency.
Use all public tasks at the frozen source commit. No new hidden split is published.
Run reference, empty, constant, echo, refusal, existing easy-template regex fixer, reference-plus-display:none, and reference-plus-clip-path policies.
Use the public run adapter with zero retries, seed 1, concurrency 1, and zero budget. Repeat each condition and compare semantic output hashes.
No learned model is configured for this study. No hosted availability or provider terms are inferred. No paid requests are allowed.

## Simulated population sweep
For each hiding probability in {0, .25, .5, .75, 1}, simulate 100 agents over all public tasks.
Use fixed repair probability .75. Select reference output when repaired, unchanged output otherwise.
Independently replace repaired output by reference-plus-display:none with the specified probability.
Use SHA-256 of agent index, task id, and draw type for deterministic uniform draws, shared across conditions.
Read scores from the measured output conditions. Compare the full grader with a simulated gate-disabled score reconstructed from defect and regression counts.
This is a simulated policy mixture, not a learned agent experiment or a live control intervention.

## Analysis and stopping
Report 95% Wilson intervals for task-level binary outcomes and stratified percentile bootstrap intervals for mean scores.
Use 2000 bootstrap draws. Preserve easy/hard strata in task means; bootstrap agents for simulated population means and paired contrasts.
Coverage counts are descriptive counts, not estimates. Repeated runs do not increase n.
Stop after the frozen conditions and sweep. Keep null results and all zero scores.
Do not exclude any task by score. Abort on infrastructure errors; record and fix the cause before retrying the full run.
Anticipated failures: stale task/source data, missing answer, report order mismatch, hidden timestamps in semantic hashes, unsupported HTML mutation, and differing summary arithmetic.
Verify public-score agreement, non-empty input, mutations actually applied, repeated outcomes, and zero reported cost.
No hypothesis test or claim about a population of websites is planned. Log changes here before affected runs.
