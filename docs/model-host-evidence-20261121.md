# Model proposal and host validation evidence

This increment follows Fable6's 89/100 development review and LEAD10:12.
It does not claim a new score, field accuracy, actual supplier facts or independent
model contribution.

## Saved evaluation record

New evaluations that return a proposal include `AssessmentEnvelope.modelAudit`.
The host creates this bounded record after its existing decision checks. It binds
the case ID, input revision and final presented decision revision, including any
added input-answer instruction. Existing records without the optional field remain
valid. SQLite retains the record under the existing ownership and retention rules.

Six stages show the proposed categorical fields beside the host's final fields.
They distinguish absent fields, invalid syntax, failed validation, passed
validation and checks skipped by an earlier safety hold. A passed check does not
prove that the model authored, caused or independently improved the host result.
Stage 1 has no classification field in the existing proposal contract and remains
explicitly absent. A returned host decision reference is labelled as such.

The record retains no raw model prose, hidden reasoning, quoted price or carbon
estimate. It stores categorical states, ranks, known identifiers and evidence
hashes, at most 16 entries per selection. Unknown identifiers are represented by
hashes. Invalid JSON or an invalid decision reference still fails the runner;
there is then no completed assessment record to display.

Only current authenticated research views display the record. Commercial output
omits it. Local runs without a proposal do not receive invented model records.

## Calculation coverage and price boundaries

The same `publicScenarioEligibility` check drives projection and missing-value
explanations. OYS-003 lacks both PP calculation coverage and input mass. OYS-004
has LDPE mass but lacks a matching calculation bundle. Neither receives substitute
PET/HDPE factors.

For each model allocation 0.6/0.8/1, the existing engine supplies the recycling
cost at sale price 0, competing costs at assumed incineration fee 0 and allocated
recycling mass. The maximum pairwise cost crossover is shown beside the nine-point
grid only when recycling carbon is no greater than all comparators. Below that
price, recycling loses weak dominance under those fixed assumptions. This is not
an actual route switch, measured yield or a guarantee for a different fee/distance.
The actual incineration fee and cost stay null.

## Unsaved replies

Two reported companies can each supply any of the permitted fee/price assumptions.
Both variants derive independently from the same baseline. Blank stays missing;
explicit zero is a hypothesis. Acceptance and permit-date text do not authorize
anything or change eligibility. The route does not persist replies or reevaluate
the actual case. Legacy single-amount request bodies remain supported.

## Verification and subsequent live evidence

Canonical full checks passed 1190 tests, with types, both builds and local smoke.
The final reply layout has a separate focused 14-test/type/app-build receipt.
Original 18 decisions remain identical (8 compared / 6 information / 4 review);
54 sensitivity samples retain their bounded conclusion and 18 price crossovers
are computed. Two recommended cases have explicit comparison-omission reasons.
These are exposed development inputs, not unseen accuracy.

The parent exercised actual forms, persisted/reloaded synthetic audit records,
accepted/rejected/skipped checks, private/commercial projection, dual replies,
zero/blank and hostile text. Screens were inspected at 390 and 1440 pixels.
Synthetic QA invokes no provider. After lead merge, a separate plan permits at
most 10 sanghyeob subscription requests on merged main; that evidence is pending
at this commit and must not be inferred from the synthetic captures.
