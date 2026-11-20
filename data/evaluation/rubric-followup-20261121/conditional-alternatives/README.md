# Conditional alternatives implementation evidence

Execution date: 2026-11-20. The directory name follows the requested artifact path.
This is local implementation evidence for official OTp5's characteristic-and-public-source route criterion, not a submission document or a legal assessment.

## Observed coverage

| Metric | Count |
| --- | ---: |
| Original cited recommendations, unchanged | 8/18 |
| Held cases with at least one registered informational alternative | 10/10 |
| Held cases with a route-supported conditional alternative | 5/10 |
| All cases with a registered alternative, independent of state | 10/18 |
| Cited recommendation OR registered informational alternative | 18/18 |
| Cited recommendation OR route-supported conditional alternative | 13/18 |
| Changed decision states | 0/18 |

The 18/18 informational union includes unavailable route-verification questions.
It must not be called 18/18 plausible supported routes. The stronger union is
13/18. All ten held cases stay held; none becomes eligible or executable.
The eight compared decisions retain their complete canonical SHA-256, including
recommendations, ranks, evidence, calculations and approval state.

Route-supported additions are HYEOB-20261112-003, -004, -005 and
OYS-20261110-009, -010. They concern a hypothetical clean, separated, explicitly
reported PP/PE/HDPE/PET component. They do not assert the condition is currently true.

Uncovered by the stronger route metric:

- HYEOB-20261112-008: the reported process `사출 퍼지 배출` is ambiguous under
  the existing registry matcher. Even a clean PP hypothesis cannot obtain the
  full source chain. The matcher is deliberately unchanged.
- HYEOB-20261112-009 and -010: material and generating process are missing.
  No polymer is guessed from descriptions or photographs.
- OYS-20261110-006: the structured polymer is unknown and the description
  reports a label conflict. No material is chosen from that conflict.
- OYS-20261110-008: hazardous solvent contact is reported. The registered
  general classification clause supports a classification question, not a
  hazardous-waste classification, disposal authorization or incineration license.

## Contract for the parent UI

`src/contracts.ts:185` defines `ConditionalAlternative`.
Only held variants gain `conditionalAlternatives?: readonly ConditionalAlternative[]`
at `src/contracts.ts:216` and `src/contracts.ts:224`. Historical records may omit
the field. Treat absence or an empty array as no registered alternative.

```ts
interface ConditionalAlternative {
  readonly routeId: "reuse" | "mechanical-recycling" | "other-recovery" | "disposal";
  readonly title: string;
  readonly state: "informational";
  readonly executable: false;
  readonly condition: {
    readonly code: "clean-separated" | "contaminated-or-inseparable"
      | "hazard-classification" | "reuse-purpose";
    readonly description: string;
  };
  readonly rationale: string;
  readonly nextChecks: readonly string[];
  readonly support: {
    readonly state: "route-supported" | "unavailable";
    readonly missingEvidence: readonly string[];
  };
  readonly citations: readonly {
    readonly sourceId: string;
    readonly locator: string;
    readonly claim: string;
    readonly quote: string;
    readonly scope: "general-requirement" | "route-specific";
  }[];
}
```

Show `condition.description`, rationale and concrete checks. Bind citation links
through the decision's evidence records. `support.state = route-supported` means
the counterfactual recycling branch has the registered source chain. It never
means legal eligibility. `unavailable` means only a verification question has
general support; show `missingEvidence` explicitly. There is no rank, processor,
approval, calculated metric or eligibility on an alternative.

The route enum retains the existing four route kinds. This implementation does
not manufacture reuse candidates: registered evidence does not establish a
case-specific reuse purpose and criteria. No energy recovery or incineration
path is inferred from a recycling-type list.

## Source mapping and limitations

`source-audit.json` contains all ten distinct citations used in the 18 results,
with exact registered claim, quote, locator, snapshot path/hash, original
path/hash and source family. `results.json` retains every actual host decision
and strict route assessment. All exact source claims remain separate from the
host's conditional rationale.

| Source family | Registered locator | Permitted role |
| --- | --- | --- |
| waste-rule-article4-2 | 제4조의2 제1항 | General classification question only |
| waste-rule-annex4-code | 별표 4 제2호 51-03-01, PDF 6쪽 | Conditional non-PVC general-business plastic classification |
| waste-rule-annex4-2-r3-3 | 별표 4의2 제2호가목3), PDF 1쪽 | Raw-material manufacturing type, not an inferred actual process |
| waste-rule-annex4-3-types | 별표 4의3 제2호 51-03-01, R-3-3 포함 행, PDF 9쪽 | Conditional classification-to-type linkage |
| waste-rule-annex5-3-common | 별표 5의3 제1호다목, PDF 1쪽 | General requirement to check type-specific criteria |

The 2026-11-10 originals use the registered 290881 references and
`waste-rule-2026-10-02`; the 2026-11-12 originals use the registered 291947
references and `waste-rule-2026-11-12`. Original assessment dates were not
replaced with a presentation date. Current law, actual permits, site acceptance,
measured contamination, separation yield and specific disposal pathways were
not independently established here.

## Why the implementation is safe

The former domain returned only questions or blocking reasons on held decisions.
The root fix is a separate informational contract built by the host, shared by
`decideCase` and `createResourceDomain.decide`; it is not an eligibility fallback.
`src/conditional-alternatives.ts` is the one shared module needed by those two
gates and the persistence parser.

The generator first uses actual matched general sources. Its optional clean
branch supplies an explicitly counterfactual material, contamination and contact
context to the existing lookup. It retains the actual process, assessment date
and all original domain facts. Only explicitly reported supported polymer
components can seed the hypothesis. All four registered source families must
match before `route-supported` is emitted. Missing/ambiguous process or unknown
material is not replaced with an invented matching fact. General clauses alone
produce `unavailable` questions. Both options leave the actual assessment intact.

The invariants are structural:

1. Alternative objects only live on held decisions, have literal
   `state: informational` and `executable: false`, and cannot carry rank,
   eligibility or approval fields. Compared results reject the new field.
2. The parser checks nonempty citations/checks, condition-to-route association,
   registered source/claim/quote/locator and full evidence-record equality,
   source scope, source family and the complete route-support chain. General
   classification cannot be relabelled route-specific.
3. The authoritative host recomputes alternatives. Proposed alternatives must
   equal the host array, so even genuine citations cannot launder an invented
   rationale or condition. Rejection returns host case ID, hold and alternatives.
4. Returned records are cloned. Mutating a result cannot mutate the registered
   trust store. A dedicated regression failed before this clone was added.
5. `assessRoutes`, eligibility, execution checks and recommendation priority are
   unchanged. All 18 original strict assessments still contain only unknown
   routes; the original recommendation-grade distinction is retained.

Rejected approach: promoting speculative routes into `RouteAssessment` or
`RouteRecommendation` would let downstream comparison/processor code mistake a
question for an authorized route. Relaxing the existing evidence matcher would
also turn ambiguity into unsupported relevance. Neither change is made.

## Reproduction and evaluation integrity

Run from the repository root with an owned temporary/cache directory:

```sh
TMPDIR=/path/to/owned-temp XDG_CACHE_HOME=/path/to/owned-temp/cache \
  bun test --timeout 30000 ./tests/assessment.test.ts ./tests/recommendation.test.ts \
  ./tests/evidence.test.ts ./tests/legal-registry.test.ts
TMPDIR=/path/to/owned-temp XDG_CACHE_HOME=/path/to/owned-temp/cache bun run typecheck
TMPDIR=/path/to/owned-temp XDG_CACHE_HOME=/path/to/owned-temp/cache \
  bun data/evaluation/rubric-followup-20261121/conditional-alternatives/coverage.ts
```

Actual runtime was Bun 1.4.4; the package manifest requests Bun 1.4.2. No runtime
installation or upgrade was performed. `validation.json` records observed
command outcomes. The ownership regression suite exercises missing information,
missing contamination, hazardous contact, mixed resin, forged source/quote/
locator/claim/scope/state/route, modified host rationale, case-ID forgery,
historical rendering, unsupported periods and trust-store alias mutation.
The initial six new behavior tests failed on the old implementation.

`baseline.json` records the pre-change local run, original input hashes and
canonical decision hashes. `coverage.ts` rereads exactly the 18 original
development inputRefs, checks their manifest hashes and dates, calls the actual
domain without AI, independently audits citation bytes/locators, and verifies
unchanged input/registry files after execution. `summary.json` records per-case
coverage, missing reasons and implementation hashes. Original photoRefs were
already empty; no photograph was opened or transmitted.

These are exposed development cases with synthetic scenario facts. The same
implementer designed and measured these branches. This measurement establishes
deterministic local coverage and regression behavior; it is not an independent
holdout, human-label accuracy, an actual waste-processing outcome or model
success. No evaluation12 labels, credentials, provider/API calls, browser, Azure,
git commit or push were used. UI work belongs to the parent.
