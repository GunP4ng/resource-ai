# PR18 regression-only evidence

Base: `fe787b3fa5361793711ef5b2371350917425b03e` (HEAD verified; initial working tree clean). Production, shared fixtures, schemas and contracts remain unchanged. Two failing tests are intentional pending the next implementation task. No commit, push, install, cloud, smoke, browser or agent work was performed.

## Instructions and test scope

Read current comparison/carbon/report tests, `src/o-synthetic.ts`, `src/o-calculation.ts`, `src/cost.ts`, `src/carbon.ts`, `src/report.ts`, validation helpers, and repository verification/handoff/task guidance. Read `/home/yeonbug/node_modules/omo-ai/plugin/skills/programming/SKILL.md` and its TypeScript README, testing README and junk-classes reference. Local `.agents` and `.codex` are empty; no applicable ancestor AGENTS.md was found.

Authoring gate: P1 owns rejection/unavailability of contradictory reviewed masses at the public comparison boundary; existing applicability tests only alter one review relative to its own bounds. P2 owns delivery of excluded-boundary meaning through public estimates and the rendered compact report; the existing exclusion test checks arithmetic only. Both use real calculators and valid `bindSynthetic` snapshots, without new production seams. The supported-zero control distinguishes actual evidenced zero activities from removed/excluded activities. All existing assertions remain. No source mutation was performed: unchanged production itself supplies the required red proof.

## P1 — contradictory reviewed treatment mass

`tests/comparison.test.ts`: start with `carbonFixture()`. Control uses the original eligible assessment and produces available **240000 KRW / 45 kgCO2e**. Change only the treatment quote to per-tonne rate 100000 KRW/t × amount **1 t**, and its QuoteReview `caseMassKg`, `minMassKg`, `maxMassKg` to **1000**. Other quote reviews remain **2000**; functional unit remains `synthetic-2000kg`; treatment carbon activity remains **2 t**. Rebind with `bindSynthetic`, then invoke `createComparisonCalculator` with the eligible assessment.

Expected: a mass-related ValidationError or unavailable net cost. Observed: no rejection; `netCost.state` is `available`, low/central/high **140000**, unit KRW; net emissions available low/central/high **45**, unit kgCO2e. Assertion reports actual `available`, expected `unavailable`. Arithmetic: 100000 treatment + 60000 transport − 20000 sales = 140000, incorrectly offered alongside the unchanged 2t carbon result. The failure diagnostic includes actual reviews, treatment activity and both returned estimates.

## P2 — excluded boundary presented as ordinary zero

`tests/report.test.ts`: remove material/energy credit activities and their activity reviews, factors and factor reviews. Set reviewed route `materialCreditExcluded` and `energyCreditExcluded` true, then rebind. Calculate real scenarios with the eligible assessment and render them through `renderReport` (the normal synthetic decision supplies the existing valid report envelope).

Observed available point estimates: gross **100**, material credit **0**, energy credit **0**, net **100 kgCO2e**. Both credits and net have only this assumption:

```json
["입력값 고정 계산 · 불확실성 범위 미제공"]
```

Expected: each public credit assumption conveys that credit's boundary exclusion; net assumptions retain both exclusions; always-visible comparison content conveys both exclusions. Semantic checks accept Korean/English concepts, without pinning an entire sentence. The single regression collects all six omissions before asserting, so a missing public assumption does not hide the report failure. It scopes the compact comparison area before route conditions, excluding screen disclosure and print audit; credit names in unrelated cells cannot satisfy an exclusion note.

Actual visible summary excerpt (HTML tags removed):

```text
순비용 (사업자 관점) 240,000 KRW
총배출 100 kgCO2e
원료 크레딧 0 kgCO2e
에너지 크레딧 0 kgCO2e
순배출 100 kgCO2e
대안 1 · 기능단위 synthetic-2000kg 계산 경계: synthetic-full-boundary
대안 1 · 탄소 입력값 고정 계산 · 불확실성 범위 미제공
```

Observed failure list: materialCredit missing exclusion assumption; energyCredit missing exclusion assumption; netEmissions missing material and energy exclusion assumptions; visible summary missing material and energy boundary exclusions. Expected list: empty.

`tests/carbon.test.ts` adds a passing supported-zero control: retain credit activities/factors/reviews and false exclusion flags, set credit amounts and reviewed outputQuantity to 0, rebind. Gross100, material0, energy0, net100 stay available with exact point bounds and no exclusion claim. Existing missing-credit/unavailable and supported-exclusion arithmetic tests also pass.

## Actual execution

| Command | Exit | Relevant output |
| --- | --- | --- |
| `git rev-parse HEAD` | 0 | `fe787b3fa5361793711ef5b2371350917425b03e` |
| `git status --short` (initial) | 0 | Empty |
| `bun run typecheck:o-tests` | 0 | `tsc --noEmit -p tsconfig.o-tests.json`; no diagnostics |
| `bun test tests/comparison.test.ts tests/carbon.test.ts tests/report.test.ts > /tmp/o-regression-tests.log 2>&1; result=$?; cat /tmp/o-regression-tests.log; exit "$result"` | 1 | Bun 1.4.2; **62 pass, 2 fail**, 64 tests / 3 files; 7.06s |
| `bun run /home/yeonbug/node_modules/omo-ai/plugin/skills/programming/scripts/typescript/check-test-junk.ts tests/comparison.test.ts tests/carbon.test.ts tests/report.test.ts` | 0 | `check-test-junk: no findings` |
| `git diff --check` | 0 | No output |

Only failing declarations:

```text
P1: a rebound 1t treatment quote cannot price a 2t comparison as available
P2: excluded credits retain boundary meaning in public estimates and the visible compact summary
```

Raw execution diagnostics are at `/tmp/o-regression-tests.log` for this session; the bounded inputs/results above preserve the material evidence in the repository. No broader suite/build/runtime verification is claimed. Each edited test file retains its existing responsibility; no untrusted-data seam, unsafe cast, non-null assertion, test-only source export or dependency was introduced. Required failures remain intentionally red; runtime repair and explicit mass-anchor design are deferred.

## P2 correction — red → green; P1 deliberately remains red (2026-11-06)

The original **62 pass / 2 fail** execution above remains the pre-correction red evidence. This section supersedes its pending-runtime-repair statement **only for P2**. P1 `caseMass` contract still awaits user approval. This correction did not edit `tests/comparison.test.ts`, context/shared schemas, fixtures, sources or other owners' files; its existing working-tree P1 regression remains untouched. Production changes are limited to `src/carbon.ts`, avoided-emissions composition in `src/cost.ts`, and `src/report.ts`.

Explicitly excluded material and energy credits now each retain their own boundary evidence and assumption:

- `원료 대체효과 제외 경계 · 계산상 0 반영 · 실측·근거 기반 0 아님`
- `에너지 대체효과 제외 경계 · 계산상 0 반영 · 실측·근거 기반 0 아님`

Available net retains the applicable notes plus `대체효과 제외 경계의 순배출 · 완전한 순탄소 비교 아님`. Only these policy notes propagate into avoided emissions, with `대체효과 제외 경계의 회피배출 비교 · 완전한 순탄소 비교 아님`. No global union of arithmetic assumptions was introduced. Gross emissions carry no credit-exclusion note.

The compact summary shows policy beside each affected credit/net/avoided value outside details. Detailed and print audit copies retain full notes. Since the unchanged unavailable DTO has only missingInputs, unavailable net disclosure derives the applicable notes from that scenario's available excluded credits, beside net in both summary and audit. Fixed-input/VAT grouping remains unchanged. Included evidenced zero receives no exclusion note; absent evidence remains unavailable; exclusion plus activity still throws `credit-exclusion-overlap`.

`compatibleBaseline` now also requires equality of both exclusion flags. Individual and combined policy mismatch yield `baseline-missing-or-incompatible`; valid independent route results remain useful. Matching excluded policies permit a qualified comparison, including self-baseline zero. The old net120/avoided75 test had excluded baseline versus included alternative: it now uses **included policies on both routes and retained, explicitly supported zero baseline credit activities**, with reviewed outputQuantity=0 and rebound snapshots. It still asserts 75; separate mismatch tests assert unavailability rather than weakening comparability.

### Actual function input/output capture

Executed `bun /tmp/resource-ai-p2-io.ts > /tmp/o-p2-actual-io.jsonl` (exit 0). The script calls real `calculateRouteCarbon` and `createComparisonCalculator` on rebound `carbonFixture` variants. Raw capture includes reviewed route policies, actual activities, full carbon outputs and comparisons. All rows use synthetic case/route evidence, gross100 and a self baseline; excluded activities are removed, while included-zero controls retain activities/factors/reviews and set credit amount/outputQuantity=0.

| Input material excluded | Input energy excluded | Output gross | Material | Energy | Net | Self avoided |
| --- | --- | --- | --- | --- | --- | --- |
| true | false | 100 | 0 | 5 | 95 | 0, qualified |
| false | true | 100 | 50 | 0 | 50 | 0, qualified |
| true | true | 100 | 0 | 0 | 100 | 0, qualified |
| false | false (supported zero) | 100 | 0 | 0 | 100 | 0, no exclusion |

Every number above is an available point estimate, low=central=high, in kgCO2e. Actual both-excluded net output:

```json
{"state":"available","low":100,"central":100,"high":100,"unit":"kgCO2e","evidenceIds":["synthetic-evidence"],"assumptions":["입력값 고정 계산 · 불확실성 범위 미제공","원료 대체효과 제외 경계 · 계산상 0 반영 · 실측·근거 기반 0 아님","에너지 대체효과 제외 경계 · 계산상 0 반영 · 실측·근거 기반 0 아님","대체효과 제외 경계의 순배출 · 완전한 순탄소 비교 아님"]}
```

Additional executed calculator assertions: genuinely compatible included baseline120 − alternative45 = **75**; matching both-excluded baseline120 − alternative100 = **20**, carrying both policy notes and restricted comparison wording; mismatched policies return unavailable. Rendered HTML tests inspect specific metric rows in the always-visible summary and print audit, including unavailable net and absence of exclusion wording on gross and included-zero credits. These are HTML/function checks, not browser/PDF acceptance.

### Actual final verification

| Command | Exit | Observed result |
| --- | --- | --- |
| `bun test tests/carbon.test.ts tests/report.test.ts` | 0 | **39 pass, 0 fail**, 2 files, 7.18s; `/tmp/o-p2-tests.log` |
| `bun test tests/comparison.test.ts tests/carbon.test.ts tests/report.test.ts` | 1 | **72 pass, 1 fail**, 73 tests, 8.01s; `/tmp/o-p2-with-p1.log` |
| `bun run typecheck:o-tests` | 0 | No diagnostics |
| `bun run typecheck` | 0 | No diagnostics |
| `git diff --check` | 0 | No output |

The sole remaining failure is intentionally `P1: a rebound 1t treatment quote cannot price a 2t comparison as available`; actual net cost is still available140000 alongside net carbon45. No P1 approval, implementation or resolution is claimed. No commit/push, install, cloud, browser, smoke or other-agent work occurred. Stop at P2 correction ready for review.

## P1 approved O-only correction — original red → green (2026-11-06)

The user approved the independent `CalculationContext.caseMass` supplement. This section supersedes earlier pending-implementation/stop statements; the original production red proof above and the original P1 regression body remain unchanged. Immediately before implementation, the existing comparison/carbon/report suite was rerun against the current P2 changes: **72 pass / 1 fail**, 73 tests / 3 files, 4.45s, exit1 (`/tmp/o-p1-before.log`). The sole failure remained the original rebound treatment quote, returning available140000 KRW with unchanged available45 kgCO2e. P2 stayed green.

New production edits are limited to `src/o-calculation.ts`, `src/cost.ts`, `src/carbon.ts`, `src/o-synthetic.ts`. New assertions are in `tests/comparison.test.ts`; the existing applicability expectation now distinguishes anchor mismatch from anchor-outside-quote-bounds. Documentation changes are this file and `docs/o-handoff.md`. Existing P2 `src/report.ts`, `tests/carbon.test.ts`, `tests/report.test.ts` changes are retained without further edits. Shared contracts, O1/source/H, dependencies and scripts are unchanged.

### Exact independently authored anchor and behavior

The fixture explicitly supplies this complete bound review, independently of quote quantities:

```json
{"caseId":"synthetic-case","assessmentDate":"2026-11-05","functionalUnit":"synthetic-2000kg","boundary":"synthetic-full-boundary","material":"synthetic-polymer","condition":"synthetic-dry","moistureBasis":"dry","massKg":2000,"evidenceIds":["synthetic-evidence"]}
```

The fact key is `case-mass:synthetic-case`; the consumed pointer is `/facts/case-mass:synthetic-case`. Schema rejects additional properties and requires positive finite mass. Case/date/FU/boundary and route material/condition/moisture basis must align, and its own evidence must pass current binding/rights/period/freshness checks. Null or absent anchor never falls back to numeric text or quote consensus. `bindSynthetic` binds only an explicitly supplied anchor.

Every quote basis and commercial role checks the anchor, including total/per-trip/included/processor-owned/netted lines. Quote bounds use the anchor; non-sales kg/t bills remain whole-case only. Sales output, residue/stage activity and substituted output remain distinct masses. This is not general mass-balance validation. Available quote lines and whole-case net cost, gross/credits/net carbon and avoided totals carry anchor evidence and the mass disclosure. Baseline composition checks both routes against the context anchor and numeric mass while retaining both P2 policy checks.

### Actual function input/output capture

Executed `bun /tmp/resource-ai-p1-io.ts > /tmp/o-p1-actual-io.jsonl`, exit0. It invokes real `createComparisonCalculator(context)(input, [assessment])` on eight authored variants of `carbonFixture`, rebinding explicitly edited facts with `bindSynthetic`. The JSONL records full actual `ComparisonInput`, full case-mass review, quote reviews and resulting scenario (including lines and estimates), or the typed error. Every case uses a self baseline; carbon treatment remains2t, residue100kg and substituted material50kg; the sales bill remains100kg.

| Actual input variant | Quote review masses, kg (treatment/transport/sales) | Billed treatment | Actual net cost | Actual net carbon | Actual self avoided |
| --- | --- | --- | --- | --- | --- |
| Control, bound anchor2000 | 2000/2000/2000 | 2t × 100000 | available240000 KRW | available45 kgCO2e | available0 |
| Exact reported mutation, anchor2000 | 1000/2000/2000 | 1t × 100000 | unavailable: `quote-case-mass-mismatch` | available45 | available0 |
| All quote reviews stale together, anchor2000 | 1000/1000/1000 | 1t × 100000 | unavailable: `quote-case-mass-mismatch` | available45 | available0 |
| Null anchor, otherwise control | 2000/2000/2000 | 2t × 100000 | unavailable: `case-mass-review-missing` | unavailable, same reason | unavailable |
| Bound anchor for `other-case` | 2000/2000/2000 | 2t × 100000 | unavailable: `case-mass-review-inapplicable` | unavailable, same reason | unavailable |
| Change anchor2000→1000 without rebinding | 2000/2000/2000 | 2t × 100000 | unavailable: `fact-unbound:/facts/case-mass:synthetic-case` | unavailable, same reason | unavailable |
| Independent anchor source observed2026-09-01, maxAgeDays30 | 2000/2000/2000 | 2t × 100000 | unavailable: `source-stale` | unavailable, same reason | unavailable |
| Anchor mass0 | 2000/2000/2000 | 2t × 100000 | typed `ValidationError`, reason `invalid-case-mass-review` | No scenario returned | No scenario returned |

Available values are exact points (low=central=high). For invalid anchor cases, actual avoided missingInputs also includes `baseline-missing-or-incompatible`; the precise anchor issue remains attached. For quote-only contradictions, independently evidenced carbon and its valid self comparison remain useful. The original reported cost changed from **available140000** in the retained red execution to this exact green output:

```json
{"state":"unavailable","missingInputs":["quote-case-mass-mismatch"]}
```

Actual control net cost:

```json
{"state":"available","low":240000,"central":240000,"high":240000,"unit":"KRW","evidenceIds":["synthetic-evidence"],"assumptions":["입력값 고정 계산 · 불확실성 범위 미제공","사업자 관점","VAT 포함","검토된 사례 전체 유입 폐기물 질량: 2000 kg"]}
```

Additional executed assertions use a separate `synthetic-independent-mass` document. Its evidence ID appears in all available totals, including self avoided; removing it from input, empty IDs, unbound content, stale observation, expired applicability or unverified rights blocks totals while independently valid activity lines remain available. Wrong case/date/FU/boundary/material/condition/moisture basis all block totals, even when rebound. Zero, negative, NaN, ±Infinity, string/null/undefined mass, missing fields, extra fields and malformed dates throw typed validation errors. Opaque FU text and FU text containing contradictory1000kg digits still use the explicit2000kg anchor. Per-kg/per-tonne non-sales billed quantity checks remain enforced after quote-review compatibility.

### Actual verification after implementation

| Exact command | Exit | Observed output |
| --- | --- | --- |
| `bun test tests/comparison.test.ts tests/carbon.test.ts tests/report.test.ts > /tmp/o-p1-before.log 2>&1` (before production edit) | 1 | `72 pass`, `1 fail`; 73 tests / 3 files, 4.45s; original P1 only |
| `bun test tests/comparison.test.ts tests/carbon.test.ts tests/report.test.ts > /tmp/o-p1-targeted.log 2>&1` | 0 | `101 pass`, `0 fail`; 101 tests / 3 files, 6.85s |
| `bun test tests > /tmp/o-p1-full-tests.log 2>&1` (final source/tests) | 0 | `151 pass`, `0 fail`, `55 expect() calls`; 151 tests / 7 files, 7.75s |
| `bun run typecheck > /tmp/o-p1-source-types.log 2>&1` | 0 | `$ tsc --noEmit`; no diagnostics |
| `bun run typecheck:o-tests > /tmp/o-p1-test-types.log 2>&1` | 0 | `$ tsc --noEmit -p tsconfig.o-tests.json`; no diagnostics |
| `bun run build` | 0 | `Bundled 1 module in 92ms`; `extension.js 0.78 KB (entry point)` |
| `bun run build:app` | 0 | `Bundled 15 modules in 238ms`; `app.js 124.57 KB (entry point)` |
| `bun run demo:o` | 0 | Actual output below |
| `bun /tmp/resource-ai-p1-io.ts > /tmp/o-p1-actual-io.jsonl` | 0 | Eight actual calculator input/output records described above |
| `git diff --check` | 0 | No output |

Final full-suite execution includes all original P1/P2 assertions, the new anchor/quote regressions, and O1/app/J source/evidence tests. O-test typecheck uses the existing configured O test scope; source tests are run by the full suite, without claiming a new J test typecheck configuration. Targeted101 run preceded the final quote-line evidence assertion and impossible-date assertion; full151 ran after both, with no subsequent source/test edits.

Exact demo stdout (handler execution, no browser/server/model request):

```text
APP_DEMO_PASS normal status=200 bytes=23441 mode=synthetic modelCalls=none file=/tmp/resource-ai-o-demo/normal.html
APP_DEMO_PASS held status=200 bytes=4182 mode=synthetic modelCalls=none file=/tmp/resource-ai-o-demo/held.html
APP_DEMO_PASS review status=200 bytes=4203 mode=synthetic modelCalls=none file=/tmp/resource-ai-o-demo/review.html
REAL_REFERENCE_PASS status=200 file=/tmp/resource-ai-o-demo/reference.html
LIVE_READINESS_PASS status=503 adapter=absent modelCalls=none
```

No smoke rerun: the existing `OMO_CODING_AGENT_DIR` resolves to `/home/yeonbug/.omo/agent`, and read-only inspection reports EROFS for write accessibility. No cache write was attempted and no override/workaround was introduced. The earlier default-cache failure and separately recorded scoped-cache success in [o-handoff.md](o-handoff.md) remain historical only. No live H/Azure, browser/PDF acceptance, commit/push, install, cloud or other-agent work occurred. The separate J raw CSV/PDF versus O derived `/facts` document identity/hash/locator and transformation/reviewer lineage limitation is recorded in the handoff; multi-source fact support remains unresolved, with no provenance overhaul here.
