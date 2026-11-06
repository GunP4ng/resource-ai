# O1–O4 implementation handoff

## O4 application transaction and photo boundary (2026-11-06)

This section supersedes older O4 integration-pending statements below. The browser composition now uses H's stateless `prepareSubmit` / `prepareAnswer` / `evaluate` methods and one O case store. Direct `createAssessmentAdapter().submit/answer` compatibility callers retain their existing private H storage. The integrated browser never invokes those committing wrappers.

`createOperationalApp({ origin, actorForRequest, caseStore, photoStore, photoPolicy })` accepts a **trusted server verification function**, independently of runner selection. Return `{ actorId, validUntil }` (Unix milliseconds); a trusted string result remains compatible and means the resolver owns session validity. Missing identity is 403, resolver failure 503, another actor's case/report/photo/mutations 404, cancellation 408 and original deadline 504. Never implement this resolver by accepting an actor form/header/unsigned cookie. The same verified actor can use another browser session. Anonymous text mode remains cookie isolated.

Construct the store before the application, using its authorizer:

```ts
const cases = createCaseStore(); // src/o-case-store.ts
const photos = await createPhotoStore({
  root: absolutePrivatePath, retentionMs: 1_800_000, maxPhotos: 100,
  authorize: cases.authorize,
});
const app = createOperationalApp({
  origin, caseStore: cases, photoStore: photos,
  actorForRequest: trustedServerIdentityResolver,
  photoPolicy: { retentionMs: 1_800_000 },
});
```

`qa-o4.ts` is a task-local harness with explicitly synthetic fixed identity, real local sanitized storage, and no runner/provider calls. The desktop/mobile owner may run `bun qa-o4.ts` at port 3001. It was not started by this implementation track. Its fixed identity must never be deployed as production authentication.

Create a text case first; its native page then exposes `POST /cases/:id/photos` (one PNG/JPEG, 5 MiB source plus 16 KiB multipart overhead), `GET /cases/:id/photos/:ref` (private no-store PNG), and `POST .../withdraw-model` / `.../withdraw-storage`. Storage consent, model consent and visible-content confirmation are separate unchecked labeled controls. Consent record IDs/expiry and provider/purpose scope are server generated. Preview uses storage permission only. Upload never evaluates a case. Duplicate/unknown fields, forged consent metadata, extra files, MIME/pixel errors and oversize streams fail before association. Failed association revokes the newly stored file; expiry cleanup remains necessary if cleanup itself fails.

The current native creation form has eight named fields and no editable photo URL. H's form-only normalization supplies `photoRefs: []` when that field is absent. JSON creation still requires an explicit array; supplying an unauthorized photo reference still fails before assessment. The regression checks the rendered form's field names, HTTP 303, the owned committed normalized input, and cross-actor isolation.

Native correction/upload forms carry `baseVersion`. Authenticated JSON corrections use `{ baseVersion, patch }`. The preexisting anonymous unversioned correction API remains compatible; generated browser forms always carry a version. One ordinary mutation per case is allowed; occupied or stale revisions return 409 before resources/model work, including identical-input ABA revisions. Different cases remain concurrent. GET reads only committed snapshots; live ALS leases supply candidate revisions to photo authorization. Closed leases cannot revive through inherited async context. Complete output is cloned, size/shape/metadata/identity validated, and the deadline/lease/version/photo eligibility checked before synchronous publication. `needs-information` and `needs-review` commit successfully. Reports retain one-hour in-memory lifetime; edits expire after 30 minutes. Restart recovery of case records is not implemented.

Withdrawal immediately preempts active work and removes selected refs; model-only withdrawal preserves private preview. The photo store writes an irreversible `.model-denied` marker, fsyncs marker/directory and checks it at resolution/transmission. Preserve denial and revocation markers with backups. Regrant requires a new upload. Historical reports show a permission-change notice; bytes already sent to a provider cannot be recalled.

PR27 P2: storage withdrawal removes the active association/selection immediately and retains an independent `pendingCleanup` ref. Failed deletion returns a storage failure; case GET shows deletion pending, explicitly leaves physical deletion unconfirmed, and provides `POST /cases/:id/photos/:ref/withdraw-storage` retry. Preview is 404. Successful cleanup clears pending state while retaining denial history; retries and late cancelled-upload compensation do not release or invalidate a newer evaluation lease. Case ownership, Origin and request deadline checks still apply.

`photoStore.revoke(actor, ref, signal)` checks ownership without normal `load`, using confined JSON reads even for expired/revoked records. Receipt initialization writes a minimal owner receipt (version, ref, owner hash) to a unique private `.json.cleanup-owner.<uuid>.tmp` file, fsyncs/closes it, atomically renames it to `.json.cleanup-owner`, then fsyncs the directory before deletion. Explicit revoke, expired reads and `purgeExpired()` now share per-ref serialization across reopened stores within this single process. Automatic cleanup re-reads and rechecks the validated original record after acquiring the lock, preserves its owner receipt, and writes/fsyncs a revocation marker before unlinking JSON and fsyncing the directory. Locks are never nested. A concurrent already-completed deletion is not counted twice and requires a valid durable receipt; a missing unknown ref cannot authorize revoke. Expiry retains receipt/marker metadata, with markers subject to the existing tombstone capacity bound; the purge result still counts actual JSON removals and unreadable records. Existing malformed, linked or foreign-owner receipts remain rejected. Rename creates no second hard link. Interrupted staging cleanup may leave an ignored private temporary file, which cannot authorize deletion or block a fresh retry. Directory-sync failure after publication leaves a complete receipt and the original JSON for retry. Existing `.json.revoked` denial markers remain continuously present. Preserve the owner receipt with the markers/backups. Retries authenticate against that receipt after JSON deletion and succeed idempotently; another owner cannot clean up the ref. Legacy empty revocation markers retain denial and can acquire a receipt from remaining owned JSON; an empty legacy marker alone cannot establish ownership. Receipt reads retain root identity, no-follow, regular-file, single-link and bounded-read checks.

P2 failure-first verification injects filesystem unlink failure after durable revocation but before JSON removal at both store and HTTP boundaries. It checks denied reads/model resolution/transmission, retained bytes, pending UI/retry, recovery through the same APIs, repeated owner success, foreign-owner rejection, legacy markers, receipt confinement and newer-lease survival. The atomic receipt correction adds a counted partial-write fault plus interrupted staging cleanup, and counted file-sync/publication/directory-sync faults, followed by restart and concurrent owner retries (`/tmp/o4-pr27-p2-receipt-red.log`, original 0 pass/1 fail). The final expiry correction adds store and HTTP expiry-before-withdrawal and partial-staging-failure→expiry-sweep→same-API retry regressions, plus a gated concurrent expired read/sweep/revoke scenario. All five failed before production changes: 62 pass/5 fail (`/tmp/o4-pr27-p2-expiry-red.log`). After correction, `bun test tests/photos.test.ts tests/o-transaction.test.ts tests/operations.test.ts` passes 67 tests/0 failures (`/tmp/o4-pr27-p2-expiry-green.log`); strict `typecheck` and `typecheck:o-tests` pass. One run alongside parallel typechecks returned `provider` rather than `timeout` in the unchanged in-flight transport timeout test (66 pass/1 fail, `/tmp/o4-pr27-p2-expiry-parallel-check-failure.log`); the standalone rerun passes all 67. The expiry directory assertion now requires the exact retained receipts/markers, retaining its original JSON removal and purge-count checks. Existing marker, atomic staging, malformed/linked receipt, current-scope and newer-lease tests remain strong; P1 authority/scope logic and the current caption are unchanged. Parent full checks and the same Astra review remain pending.

Default subscription and local launchers remain **text only**. Supplying a private store or `photoPolicy.guardedModel` labels does not enable model consent/selection. PR27 P1 uses one H-owned `operations.photoExecution` authority with an exact checked Azure target-to-provider/purpose mapping. Supply that same instance to `createCaseStore(Date.now, authority)` and `createPhotoStore({ ..., photoExecution: authority })`. The issued ticket governs the rendered offer, upload consent, staged access, direct store resolution, each guarded SDK dispatch and final publication. Uploads echo only `modelBindingId`; stale/missing offers cannot grant consent. Stored legacy consent remains previewable but requires fresh upload/consent for model use. Full API and owner mapping responsibilities: [photo execution scope](photo-execution-scope.md). No production policy values or human H agreement are asserted; H #8 stays closed and this work tracks #12. Readiness reports identity, private storage and guarded-model-photo capabilities separately. The native Node bridge forwards the body stream before consumption and returns response `arrayBuffer` bytes without text conversion.

External dependencies remain: production identity verification/session expiry, reviewed retention/provider purpose policy, guarded subscription photo support, real approved photos and operational evidence, live inference acceptance, durable audit/billing settlement and durable case persistence. No credentials, live inference, network provider call, commit, push, PR or merge was used. The parent ran task-owned local servers and browsers for the checks below.

Focused follow-up verification: `bun test tests/o-transaction.test.ts tests/session.test.ts tests/operations.test.ts tests/photos.test.ts tests/deadline.test.ts` passed **91 tests, 0 failures**; `bun run typecheck`, `bun run typecheck:o-tests`, and `git diff --check` passed. The new native-form regression first reproduced HTTP 400 before the normalization fix, then passed with HTTP 303. No provider calls were used.

Parent verification on this follow-up: all strict checks, both builds, **378 tests / 0 failures across 17 files**, official source/built-extension smoke and `git diff --check` passed after the final race fixes. Real Chrome native forms verified creation without photo references, invalid-mass rejection with byte-identical previous report preservation, successful correction and stale-tab conflict, storage-only PNG upload/preview through the actual Node HTTP bridge, model-only withdrawal retaining preview, and storage withdrawal returning preview 404 while preserving a form-free historical report. Identity and image pixels were synthetic; no inference ran.

Astra xhigh initially found two request races: a delayed body could combine an old snapshot with a newer submitted version, and cancelled uploads held their lease until storage/cleanup completed. Both have deterministic failure-first regressions. The app now checks snapshot/version equality before preparation and releases upload leases immediately on abort, independently of late receipt cleanup. The same Astra session re-reviewed the fixes and returned **APPROVE**, with no remaining actionable finding. Review: `/tmp/o4-operations-astra-rereview.txt`. The final source was restarted with `bun qa-o4.ts`; native creation/upload and four fresh desktop/mobile light/dark captures are retained under `/tmp/o4-approved-photo-*.png`.

The photo section was inspected at 390px and 1440px in both themes. Live Chrome snapshots passed the frontend detector with zero errors/warnings in 22 views: stored-photo cases at 320/390/768/1024/1440px in both themes, plus input, post-withdrawal case and print routes at 390/1440px in both themes. The only advisory was the absent pre-navigation script-error probe; the app has no client scripts. The detector's standalone renderer failed with a syntax error, so its supported `collectPageSnapshot`/`lintSnapshot` path was used on the actual browser instead. Captures and machine results are retained under `/tmp/o4-final-photo-*.png`, `/tmp/o4-detect-live.json` and `/tmp/o4-browser-qa-evidence.json`. No Lighthouse or comprehensive accessibility certification is claimed. Browser history below predates this follow-up.

The `qa-o4.ts` entry is included in the regular strict typecheck. Its private `.qa-o4-photos/` directory is ignored by Git; the constant synthetic identity is for loopback QA only.

## Remaining print pagination — lead check pending

Lead reported that regenerated `/tmp/resource-ai-final-qa-KOYmJk/normal-print-final.pdf` still has 9 pages, with only the footer on page 9. This follow-up changes only print CSS in `src/report.ts`: readable 10.5pt body text at 1.45 line height, smaller print headings, and tighter section, heading, table, list and definition-list spacing. Screen styles and report content are unchanged; the complete audit and disclaimer remain present. No clipping, scaling or fixed heights were added.

Observed checks: `bun test tests/report.test.ts` exited 0 (**5 pass, 0 fail**); `bun run typecheck` exited 0; `bun run build:app` exited 0 (15 modules, app.js 119.41 KB). **Final pagination still needs the lead to regenerate and inspect the PDF; no pagination PASS or new page count is claimed.** No browser, smoke, dependencies, other agents, commit or push was used.

## Astra re-review — two minor cleanups completed

`/tmp/resource-ai-astra-rereview.txt` approves the prior P1/P2 fixes with minor cleanup. This follow-up changes only `src/app.ts`, `src/report.ts`, and this handoff. The appended demo navigation paragraph is now `screen-only`. Print paragraphs use `margin-block: .5rem`; the footer uses `margin-top: .5rem` and `padding-top: .25rem`. The disclaimer and full print audit remain visible.

`parseAssessment` now uses two local installed TypeBox object schemas with `additionalProperties: false` and `Value.Check` narrowing instead of the two `as Record` assertions. Decision data remains unknown until `parseDecision`. Envelope validation still precedes decision validation, followed by execution validation; existing nonblank/length checks, validation reasons, omitted execution, and missing/null usage normalization remain intact. No shared/H/J files or tests were changed or deleted; no broader refactor was applied.

Actual follow-up checks:

| Command | Observed outcome |
| --- | --- |
| `bun test tests/app.test.ts tests/report.test.ts` | Exit 0; **18 pass, 0 fail**, 2 files, 7.56 seconds |
| `bun run typecheck` | Exit 0 |
| `bun run typecheck:o-tests` | Exit 0 |
| `bun run build:app` | Exit 0; 15 modules, app.js 119.1 KB |

Lead browser evidence, supplied to this follow-up and acknowledged in Astra's re-review: native form submission sends the correct `Origin=http://localhost:4317`, returns HTTP 503 and the expected readiness explanation; all 20 viewport/theme checks show no overflow. Native PDF inspection confirmed the full audit, including both synthetic identifiers and `/facts/quote` locators. The prior PDF had a final page containing only footer/navigation. **Final pagination after these spacing/navigation changes remains for the lead to recheck.** These results supersede the earlier pending statements below only for those completed browser checks; this follow-up ran no browser or smoke. Stub-adapter browser integration and genuine H/Azure execution remain unverified. No commit, push, cloud request, install, or delegation was performed.

## Astra correction pass — ready for re-review

Read `/tmp/resource-ai-astra-review.txt` fully. This pass changes only `src/app.ts`, `src/cost.ts`, `src/processors.ts`, `src/report.ts`, `src/o-synthetic.ts`, the five existing O test files, and this handoff. `tests/carbon.test.ts` receives readability formatting only. Existing package changes and the other O files remain as reviewed; shared contracts and H/J files are untouched. All 85 baseline tests are retained; six regression tests are added. No commit, push, install, cloud/provider/model call, smoke retry, cache workaround, server/browser launch or delegation was performed in this correction pass.

| Finding | Correction and boundary coverage |
| --- | --- |
| P1 browser submission | HTML responses now send `Referrer-Policy: same-origin`. Exact Origin equality, session ownership, and cross-site rejection remain. Literal `null`, absent Origin, foreign Origin and cross-site POSTs all return 403 before the adapter. The input response policy and same-origin 503 readiness path are covered at the handler boundary; actual browser-generated Origin still requires lead QA. External evidence links retain `rel="noreferrer"`. |
| P2 sales audit | Available processor-owned sales carry `처리업체 귀속 · 사업자 수입 합산 제외`; already-netted sales carry `견적 <quoteId>에 이미 반영 · 추가 차감 제외`. Ownership and netting metadata still pass the existing validations before any result can be returned. Amounts and arithmetic are unchanged: excluded sales remain 20,000 KRW, processor-owned total 260,000 KRW, and the existing netted fixture total 240,000 KRW. Calculator and rendered disclosure coverage assert the explanations. Included-child coverage now asserts its exclusion annotation as well. |
| P2 compact comparison | The numerical A/B table immediately follows approval, with net cost, gross emissions, both credits, net emissions and baseline/avoided status. Shared functional unit/boundary and applicable cost/carbon VAT/fixed-input notes appear before route conditions and outside closed disclosures. Exact shared notes are grouped by applicability; unique assumptions stay with their metrics/lines. Detailed cost/carbon audit uses native `details`. Short numbered evidence links lead to complete existing source metadata once below. Unavailable reasons remain beside affected summary metrics; limitations, conditions, synthetic provenance and approval remain visible. |
| P2 print audit | The identical detailed audit HTML is also emitted in a dedicated `print-only` block, outside `details`; print CSS hides the screen disclosure and shows that block. Thus full print content does not depend on closed-details printing behavior. Regression coverage checks screen/print audit content and preserves assumptions, factor IDs/versions and locators. Native print rendering/PDF output is still unverified. |
| P2 execution seam | Optional application-owned `AssessmentEnvelope` is validated, stored and rendered with the owning case. Legacy decision-only adapters remain usable. Distinct traces/usages across two cases survive retrieval; answer execution replaces that case's metadata, absent usage stays `미제공`, malformed metadata returns sanitized 502 and stores no case. No change to `DecisionResult`. |

### Proposed H1/H4 handoff, not agreed or integrated

The application adapter may return the existing `DecisionResult` or this application-level envelope from either `submit(raw, signal)` or `answer(caseId, raw, signal)`:

```ts
{
  decision: DecisionResult, // unchanged shared DTO; structurally/reference validated
  execution?: {
    traceId: string,        // nonblank, maximum 200 characters
    usage?: string | null  // nonblank display text, maximum 2000 characters
  }
}
```

Only `decision` and optional `execution` are accepted at the envelope level; execution accepts only `traceId` and optional `usage`. A supplied execution value must be an object with a valid trace. Omitted/null usage normalizes to unavailable, never zero or estimated tokens. The entire adapter output remains subject to the existing 512 KiB limit. Metadata follows case ownership, TTL, output validation and cloning into memory; it cannot set presentation mode or approval. A legacy decision-only answer replaces prior metadata with unavailable rather than retaining a stale execution. `mode: live` means adapter result, not proof of Azure execution. H must supply truthful execution data, host-validated decisions, cancellation and unique case identities. This is a proposed handoff for H review; no H agreement or Azure integration is claimed. `parseDecision` remains structural/reference validation, not H3's substantive host gates.

### Bounded cleanup and test retention

Applied the read `remove-ai-slops/SKILL.md` at `/home/yeonbug/node_modules/omo-ai/plugin/skills/remove-ai-slops/SKILL.md`, with its testing references. The deletion ladder found no justified module/helper/import/test removal; retained the adapter seam and context/provenance helpers. Expanded compressed body parsing/cancellation/session statements, report templates/CSS rules, synthetic records and calculation/app/report assertions. Tests retain independent expected constants. Renamed the quote-validity/empty-quote test and externally supplied interval test to match what they actually assert; the latter does not claim to validate coupled-input ingestion. Isolation coverage now asserts actual submitted fields and additional-answer delivery.

Only proven duplicate validation was removed: processor permit dates/timestamps/periods are validated eagerly once and their parsed values reused. Malformed inactive/out-of-scope records still fail before scope filtering; the new adversarial regression and existing reversed-inactive-period regression cover that ordering. Inclusion traversals still perform structural errors before commercial compatibility. Public calculation entry guards and repeated composition validation remain: deduplication there is deferred because no simpler equivalent change was established. No tests were deleted, skipped or weakened; no mutation/deletion proof is claimed for this pass. Tests ledger: all original declarations retained (`R`), two names corrected (`F` completed), six new regression declarations retained (`R`); no `C`/`D` cuts. Changed source modules remain below 250 nonblank/noncomment physical lines.

### Correction-pass checks (exact commands)

| Command | Actual outcome |
| --- | --- |
| `bun run test:o` before cleanup | Exit 0; **85 pass, 0 fail**, 5 files, 7.46 s |
| `bun run test:o` after corrections and cleanup | Exit 0; **91 pass, 0 fail**, 5 files; final output at `/tmp/resource-ai-sol-o-tests.log` |
| `bun run typecheck` | Exit 0; source typecheck |
| `bun run typecheck:o-tests` | Exit 0; includes all O tests |
| `bun run build` | Exit 0; 1 module, extension 0.78 KB |
| `bun run build:app` | Exit 0; 15 modules, app 118.88 KB |
| `bun run /home/yeonbug/node_modules/omo-ai/plugin/skills/programming/scripts/typescript/check-test-junk.ts tests/processors.test.ts tests/comparison.test.ts tests/carbon.test.ts tests/report.test.ts tests/app.test.ts` | Exit 0; no findings, baseline and final |
| `git diff --check` | Exit 0 |

An intermediate O-test typecheck caught a possibly undefined new disclosure assertion; an explicit assertion fixes the narrowing. An intermediate report test incorrectly counted a preserved synthetic limitation as a repeated summary VAT note; its assertion now scopes the comparison summary and still retains the limitation. Both were corrected before the final checks. No baseline failure occurred.

Existing `tests/sources.test.ts` and `tests/evidence.test.ts` were not rerun: their source/evidence ownership modules, data and contracts are unaffected. Their previous 20-pass result below is historical. Lint/security scan/LSP diagnostics: N/A, no configured project lint/security command or LSP tool; project and O-test typechecks were run. The earlier default SDK smoke cache-permission failure and separately reported isolated-cache success below remain historical evidence, not repeated or newly verified. No cache permissions were bypassed.

### Lead browser acceptance steps — pending, not run here

Use the lead's running real HTTP wrapper/browser; do not repeat the sandbox's prior listen/Chromium EPERM attempts.

1. At the configured origin, open `/`, fill the required description and assessment date, and click the actual submit button. Do not inject/override request headers. Capture the GET response's `Referrer-Policy: same-origin`, browser POST's exact configured `Origin` (not `null`), same-session cookie, HTTP 503 and the visible H1/H4 readiness explanation.
2. In the lead's wrapper/harness, inject a local stub into `createApp({ origin, adapter })`: `submit` returns a unique `needs-information` decision and trace/usage; `answer` returns a `needs-review` or compared decision with the same case ID and a new trace, omitting usage. Navigate and submit through the actual form, follow the 303, fill/click the additional-answer form, and open the report. Capture forwarded field/answer values, 303 locations, same-case report and `미제공` for absent usage. Repeat a second case with distinct metadata; verify each report shows only its own values. Use a separate browser session to verify direct access/answer submission to the first case is denied. No Azure credentials/calls are needed for this stub QA.
3. On `/demo/normal`, check 1440px and 390px, light/dark and keyboard focus. Confirm approval immediately precedes A/B numerical summary (240,000/230,000 KRW; net 45 kgCO2e), fixed-input/VAT notes remain visible when details are closed, unavailable metrics retain their reasons, and the page has no horizontal viewport overflow. Open details and follow numbered evidence links; inspect exact line assumptions, factor versions/IDs and `/facts/...` locators. Check held/review states and external evidence-link behavior.
4. With details still closed, use native Print Preview/save PDF at A4. Confirm all cost/carbon rows, unique assumptions/exclusion reasons, factor IDs/versions, source metadata/locators, conditions, limitations, approval and provenance appear once in the print document, with no clipped tables. Repeat with details open and compare printed content. Check unavailable and execution-metadata reports as well. Record actual browser/PDF evidence; the HTML regression is not a print-rendering pass.

Remaining limits: real quotations/permits/activities/approved factors and legal eligibility are still unavailable; synthetic fixtures establish only deterministic authored-fixture behavior. H host gates/session/domain composition and genuine Azure authentication/trace/usage remain unintegrated. Native form and print acceptance await the lead, then Astra re-review. Corrections stop at this handoff.


## Original implementation record (historical, before corrections)

Implemented against `/tmp/resource-ai-astra-design.txt`, the unchanged shared contracts, and J's `data/sources/handoff-2026-11-06.md`. Runtime: **Bun 1.4.2 (744846f84)**. Base HEAD: `65bb1fe10772dd5bdf4b7449d5e9d4cb98375af0`; changes are uncommitted. No install, cloud/model request, delegation, commit or push was performed.

## Changed files

| Responsibility | Files |
| --- | --- |
| O1 | `src/processors.ts` |
| O2 and comparison composition | `src/cost.ts` |
| O3 | `src/carbon.ts` |
| O4 | `src/report.ts`, `src/app.ts` |
| O supplemental validation and reviewed metadata | `src/o-validation.ts`, `src/o-calculation.ts`, `src/o-decision.ts` |
| Explicitly synthetic fixtures and function-driven demo | `src/o-synthetic-evidence.ts`, `src/o-synthetic.ts`, `src/o-demo.ts` |
| Existing real snapshot display | `src/o-reference.ts` |
| Launch and reproducible HTML demonstration | `scripts/app.ts`, `scripts/o-demo.ts` |
| Tests | `tests/processors.test.ts`, `tests/comparison.test.ts`, `tests/carbon.test.ts`, `tests/report.test.ts`, `tests/app.test.ts` |
| Existing-toolchain scripts and O test typechecking | `package.json`, `tsconfig.o-tests.json` |
| Handoff | `docs/o-handoff.md` |

No changes to shared contracts, sources/evidence modules, real source data, dependency versions/lockfile, extension, or H-owned modules. Existing source/evidence tests remain unchanged.

## H/J integration seam

The exported functions retain the shared DTOs:

```ts
createProcessorFinder(context): ResourceDomain["findProcessors"]
findProcessorsWithDiagnostics(input, route, context) // candidates plus reasons
calculateRouteCost(input, route, context)
calculateRouteCarbon(input, route, context)
createComparisonCalculator(context): ResourceDomain["compare"]
renderReport(result, presentation): string
createApp({ origin, adapter? }): (request: Request) => Promise<Response>
```

`ProcessorContext` and `CalculationContext` are **server-owned reviewed supplements**, not client fields or replacements for shared contracts. Fact/metadata schemas reuse the installed TypeBox. Malformed input throws `ValidationError` with `reason`; missing or inapplicable valid facts produce an unavailable estimate or exclusion diagnostic. Factories clone contexts to freeze the supplied run versions. H owns input interpretation, route assessment, host gates, and session/model execution.

Each `ReviewedDocument` contains the actual UTF-8 structured snapshot string, its `EvidenceRecord`, observation date, actual review/check timestamp, reviewer and explicit freshness policy. Ingestion hashes the actual snapshot bytes against `record.sha256`, validates calendar/timestamp/order/period fields, and rejects duplicate source IDs. Reading a permission flag or a plausible hash does not establish integrity. These supplements require agreement/review with J/H before real use; the implementation does not automatically turn arbitrary PDF prose or directory records into reviewed facts.

Snapshots use `{ "facts": { "exact-key": reviewedValue } }`. The record locator is `/facts`; consumed fact locators are exact JSON pointers, including escaping `~` and `/`. A valid source ID is insufficient: each consumed claim/value must equal the snapshot fact, with the applicable version/context included. Missing permissions, stale observations, missing quantity evidence and unbound facts block calculations. Every quantity must carry its own evidence IDs; a factor/price reference alone does not establish measured activity/mass. Later retrieval may support a retrospective assessment; this does not claim that information was available on the assessment date.

Required fact keys:

| Key | Reviewed value |
| --- | --- |
| `scope:<caseId>:<routeId>` | Complete processor scope record, including SHA-256 revision of `CaseInput` |
| `route:<caseId>:<routeId>` | `{ caseRevision, route }` for O1's already-assessed route |
| `permit:<processorId>` | Complete facility identity, permit, operations/code/version, service region, periods, conditions, reviewer/check/freshness record |
| `acceptance:<processorId>:<caseId>:<routeId>` | Case revision, material quantity, route, conditions and confirmation/expiry |
| `boundary:<caseId>:<routeId>` | Complete route coverage/applicability review |
| `case-mass:<caseId>` | Complete independent `CaseMassReview`: case/date/functional unit/boundary/material/condition/moisture basis, positive finite whole-case incoming `massKg`, and evidence IDs |
| `quote:<quoteId>` | `{ quote, review }`, including quantities, perspective, material/case/processor, coverage, VAT, output ownership/quantity and netted revenue reference |
| `activity:<activityId>` | `{ activity, review }`, including quantities, distinct coverage/leg IDs, basis and any output × substitution derivation |
| `factor:<factorId>:<version>` | `{ factor, review }`, including registry version, period, geography/process/material, basis/GWP/gases, allocation/substitution and coverage |
| `assessment:<caseId>:<routeId>` | Already-reviewed `RouteAssessment` used by comparison composition |

For facts citing multiple sources, **each referenced snapshot must contain that reviewed fact**. This is deliberately strict; J/H must supply a reviewed structured handoff rather than rely on a generic legal lookup.

## Behavior and conservative limits

- O1 requires exact reviewed case revision/code/version, eligible route support, facility identity, valid active permit, explicit service area, fresh verification and resolved permit conditions. An office listing is insufficient. Null permit expiry is accepted only with reviewed `openEnded=true`. Acceptance defaults to unconfirmed; current case/quantity-specific evidence is required for confirmation. The current real directory yields **zero verified candidates**, with diagnostics rather than a claim that no suitable facility exists.
- O2 supports per-kg, per-tonne, per-trip and total quotes, explicitly checks 1 t = 1,000 kg, minimum charges and reviewed trip billing rules. Only actual applicable quotes support totals. VAT unknown blocks comparison; conversion needs an evidenced rate. Uniform VAT-exclusive quotes work without an invented rate. Inclusion cycles/dangling/incompatible references and overlapping payable roots are rejected. Included child lines remain visible with an exclusion annotation. Operator-owned independent revenue is subtracted; processor sales and already-netted revenue are not subtracted again. Saleable output and ownership are explicit. Required cost and sales coverage/exclusions must be reviewed; empty quotes are unavailable. All audited quote lines must be sound before a total is declared.
- O3 uses exact factor ID/version and frozen registry version. Activities and factors require matching reviewed applicability, units, moisture/mass basis, GWP/gas coverage, allocation and component coverage. Only kg/t dimensional conversion is supported. Disjoint transport legs are allowed; duplicate leg/component accounting and separately added embedded stages are rejected. Multi-stage and embedded-credit factors remain unsupported/unavailable rather than risking double counting. Credits require reviewed output, substitution ratio, displaced output and method. Missing credits preserve useful gross emissions but block net emissions; zero requires supported exclusion. Baselines require compatible functional unit, condition, boundary and GWP. A missing/invalid supplied baseline stays `baseline-provided` with an unavailable reason. Self-baseline zero requires an available validated result.
- Public quantity inputs are point values: **low = central = high**, labelled “입력값 고정 계산 · 불확실성 범위 미제공”. Unapproved quantity bounds/coupling fields are rejected. Low-level estimate arithmetic preserves explicitly supplied independent endpoints (the synthetic `[90,100,110] − [40,50,60] − [5,5,5]` test yields `[25,45,65]`). There is no uncertainty-quantity ingestion or automatic coupled-scenario synthesis. Reports can display valid externally supplied estimate ranges; no invented midpoint, weighted score or automatic ranking is produced.
- O4 renders all three `DecisionResult` states, every metric's unavailable reason, breakdowns, conditions, sources/locators/version/retrieval, limitations and the exact approval enum. Negative net emissions are not called removal. Fixture/offline/live/recording provenance is separate presentation data. Missing usage stays unavailable; actual H4 trace/usage is still an integration dependency.
- HTTP handling uses same-origin mutation checks, unpredictable HttpOnly/SameSite session cookies, case ownership, one-hour expiry, bounded in-memory storage, 16 KiB input and 512 KiB output defaults, bounded execution and cancellation. No source/photo URL is fetched. Case/fixture IDs never become filesystem paths. Reports are private/no-store with restrictive CSP; text and links are escaped and link schemes restricted. Provider/authentication failures and malformed results return a sanitized execution error, never a successful domain decision.

The Node HTTP launch wrapper runs under Bun using the existing Node types, with transport byte/time limits. `src/app.ts` only exports the handler factory; importing it does not start a server. Source snapshots resolve relative to their module. The built app requires sibling `dist/data/` assets, including the reference page's price and processor snapshots; neither launcher depends on the working directory.

## Reproduce

```sh
bun run typecheck
bun run typecheck:o-tests
bun run build
bun run build:app
bun run test:o
bun test tests/sources.test.ts tests/evidence.test.ts
bun run demo:o
# Historical smoke results below; do not rerun during correction review.
```

Original implementation verification results (not correction-pass reruns):

| Command | Observed outcome |
| --- | --- |
| `bun --version` | `1.4.2` |
| `bun run typecheck` | Exit 0 |
| `bun run typecheck:o-tests` | Exit 0; actual O test files included, no suppressions or added test type dependency |
| `bun run build` | Exit 0; existing extension, 1 module, 0.78 KB |
| `bun run build:app` | Exit 0; app, 15 modules, 110.50 KB |
| `bun run test:o` | **85 pass, 0 fail**, 5 files, final run 6.15 seconds; domain functions and app explicitly exercised |
| `bun test tests/sources.test.ts tests/evidence.test.ts` | **20 pass, 0 fail**, 2 files, 55 existing expect calls, 8.99 seconds |
| `bun run demo:o` | Exit 0; normal/held/review and real reference HTTP-handler responses 200; absent-adapter submission 503 |
| `git diff --check` | Exit 0 |
| `bun run smoke` | Initial run emitted no milestones and was interrupted (exit 130). Bounded unchanged retry exited 1: SDK extension loader attempted a global `/home/yeonbug/.omo/agent/cache/extension-modules/` write and received EROFS. Its owned smoke resources were removed. |
| Same `scripts/smoke.ts`, SDK agent cache isolated in an owned `/tmp` directory | **Exit 0**: both `EXTENSION_LOAD_PASS` lines, `SDK_SELECTION_PASS`, `SCAFFOLD_ONLY`, `OWNED_SMOKE_RESOURCES_REMOVED`, `O_SCOPED_SDK_CACHE_REMOVED`. No prompt or cloud request. |

Historical isolated-cache smoke invocation, recorded previously and NOT rerun or recommended as a correction-pass workaround (the original smoke file is unchanged):

```sh
timeout --signal=TERM --kill-after=5s 60s bun -e 'import { mkdtemp, rm } from "node:fs/promises"; import { tmpdir } from "node:os"; import { join } from "node:path"; import { ENV_AGENT_DIR } from "./node_modules/@code-yeongyu/senpi/dist/config.js"; const cacheDir=await mkdtemp(join(tmpdir(),"resource-o-sdk-cache-")); const previous=process.env[ENV_AGENT_DIR]; process.env[ENV_AGENT_DIR]=cacheDir; try { await import("./scripts/smoke.ts"); } finally { if(previous===undefined) delete process.env[ENV_AGENT_DIR]; else process.env[ENV_AGENT_DIR]=previous; await rm(cacheDir,{recursive:true,force:true}); console.log("O_SCOPED_SDK_CACHE_REMOVED"); }'
```

The SDK's own `ENV_AGENT_DIR` setting redirects only its cache/state for this process; no HOME/CODEX_HOME override, dependency installation, SDK edit or external directory write was used. The standard unscoped command's environmental failure is not reported as a pass.

The four test themes were also deliberately broken, then restored byte-for-byte (pre/post SHA checked): O1 code guard, O2 revenue subtraction, O3 net emissions, O4 escaping. The corresponding tests failed (10, 4, 5, 2 failures respectively), then the final unmodified suite passed. No test skips, `.only`, `.skip`, type suppression or weak “nonempty output” substitutions were introduced.

Independent synthetic results: A **240,000 KRW**, B **230,000 KRW**, treatment **200,000 KRW**, processor-owned-sales case **260,000 KRW**, explicit fixture 0.10 VAT conversion **220,000 KRW**; carbon gross **100**, material credit **50**, energy credit **5**, net **45**, compatible independent baseline net **120**, avoided **75 kgCO₂e**. All identifiers/data are synthetic; these values establish no real price, permit, tax rate or emission factor.

## Browser launch and artifacts

```sh
# Repository root; no H adapter is injected by this launch script.
bun run app
# Or after build:app, from the same root:
bun dist/app/app.js
```

Open `http://localhost:3000/`. Optional port: `PORT=3017 bun run app`, then use `http://localhost:3017/`.

| Route | Purpose |
| --- | --- |
| `/` | Korean form and honest adapter readiness; no adapter submission returns 503 |
| `/demo/normal` | Real O1–O3 function execution on synthetic evidence, A/B runs, breakdowns and pending approval |
| `/demo/evidence` | Exact synthetic snapshot JSON bytes; linked source SHA verified in app test |
| `/demo/held` | Explicitly authored needs-information fixture |
| `/demo/review` | Explicitly authored needs-review/risk fixture |
| `/reference` | Real 136 reference prices, 31 unverified listings and generic legal citation, separated from fixtures |
| `/health` | App/backend readiness; Azure unverified |
| `/cases/:caseId`, `/cases/:caseId/report` | Session-owned result/report after an injected adapter succeeds |
| `POST /cases/:caseId/answers` | Same-case answers forwarded to the injected adapter |

`bun run demo:o` saved actual handler HTML (not screenshots):

- `/tmp/resource-ai-o-demo/normal.html`: HTTP 200, 13,644 bytes; SHA-256 `11a23fb157de28fb264c6c2101bb16917adadd367f862828122b2ae9d0b122f6`.
- `/tmp/resource-ai-o-demo/held.html`: HTTP 200, 3,662 bytes; SHA-256 `66cdb7e02b56f9e0414e8eebb080d00e39878cfdf8ff5e996857996b1b481878`.
- `/tmp/resource-ai-o-demo/review.html`: HTTP 200, 3,683 bytes; SHA-256 `746b060f3c2961164f72e2bdbddb76d1cb2779f4cc2ecb01da78ab3d947af648`.
- `/tmp/resource-ai-o-demo/reference.html`: HTTP 200; SHA-256 `376ae59d1d08131f3311bb51b04abed3b02811f3bfa6f76a91079707a787c182`.

Original pre-correction built app SHA-256 (superseded): `5cc93c05822a42757b43fa3f91244efec9b4a0774ca908241904a8e1265b969b`. Extension SHA-256: `d8ee7d1538a6d694a4a5f9cb236907d664358ee38cc2d6d940a4e85055ba37cf`.

Actual server launch was attempted with `PORT=3017 bun dist/app/app.js` and failed with **EPERM, syscall listen** in this sandbox. A local Playwright attempt to render the actual handler HTML also failed before opening a page: Chromium `sandbox_host_linux.cc:41`, `shutdown: Operation not permitted`. No screenshots or browser-pass claims are supplied. Browser QA remains with the lead: verify 390/1440 widths, light/dark themes, keyboard/focus, table wrapping, actual form 503, both held states, source JSON link, and print output. WCAG contrast/focus/target size/keyboard/reflow/state-stability results are **unverified here**, not asserted PASS.

## Lead browser verification and review

The worker sandbox limitations above describe its own run. The lead subsequently
ran the actual app in Chromium and completed these checks on 2026-11-05:

- Native form submission sends the configured Origin and returns HTTP 503 with
  the H1/H4 readiness explanation. No request headers were injected.
- Input, normal comparison, information-needed, review-needed and reference
  screens were captured at 1440px desktop and 390px mobile in light/dark themes.
  All 20 combinations had no horizontal document overflow.
- The comparison summary precedes its audit details. The closed normal report
  measures 2654px on desktop and 3148px on mobile.
- The final actual print PDF has five pages. Every page was rendered and
  inspected; the footer-only page is gone. Both quote alternatives, activity and
  factor identifiers, exact fact locators, limitations and disclaimer remain.
- Astra approved the corrections with minor print/type cleanup. Sol applied
  that cleanup; affected tests, typechecks and app build passed. The final
  print-only spacing change passed all five report tests and source typecheck.

Local evidence is in `/tmp/resource-ai-final-qa-KOYmJk/`, including
`metrics.json` and `normal-print-approved.pdf`. Native form evidence is
`/tmp/resource-ai-qa-pOXVip/form-fixed.json`. These temporary artifacts are not
part of the repository. This is scoped browser verification, not a complete
accessibility certification or live Azure/H integration acceptance.

## Open integration/data work

Real processor matches need case waste code and reviewed facility permits/current verification/acceptance. Real cost totals need applicable actual quotations, quantities, ownership, VAT and complete coverage. Real carbon totals need approved factors, activity measurements, applicability/GWP/allocation and substitution evidence; the real factor registry remains empty. Reference market prices, directory prose and the generic legal citation do not fill those gaps.

H1–H4, host gates, the actual `domain.ts` composition and case session execution remain H-owned integration work. The proposed adapter accepts `submit(raw, signal)` and `answer(caseId, raw, signal)` and must return independently scoped, host-validated results, honor cancellation and use unique case IDs. No Azure trace, usage, authentication success or end-to-end live execution was demonstrated. Lead browser and Astra review results are recorded above.

## PR18 P2 correction ready — P1 approval still pending (2026-11-06)

P2 now retains distinct reviewed material/energy exclusion notes through credits, net and compatible avoided-emissions arithmetic. Each excluded zero explicitly means calculation zero rather than evidenced/observed zero. The always-visible summary places policy beside affected metrics; unavailable net also discloses applicable credit policies. Gross and included evidenced zero are not labelled excluded. Detailed/print audits retain notes, without changing shared fixed-input/VAT grouping or globally merging assumptions.

Both exclusion flags must match for baseline compatibility. Matching excluded policies produce a qualified restricted-boundary comparison; mismatch returns unavailable. The 75 arithmetic case now uses compatible included policies with supported-zero baseline credits. Separate tests preserve rejection of mismatch and credit-exclusion overlap, and missing evidence remains unavailable.

Actual checks: P2 carbon/report **39 pass / 0 fail**; comparison/carbon/report **72 pass / 1 fail**, solely the deliberately retained P1 mass regression. Both source and O-test typechecks and `git diff --check` pass. Full red→green record, exact assumptions and actual function input/output table: [o-regression-evidence.md](o-regression-evidence.md). Raw current-session artifacts: `/tmp/o-p2-tests.log`, `/tmp/o-p2-with-p1.log`, `/tmp/o-p2-actual-io.jsonl`.

P1 `caseMass` approval remains pending; no context/shared schema, P1 check, fixture, source/provenance or other-owner change was made in this correction. No commit/push, cloud, install, browser, smoke or delegation. P2 is ready; stop here.

## PR18 P1 approved O-only mass supplement implemented (2026-11-06)

The user approved **only** `CalculationContext.caseMass`; this section supersedes the earlier P1-pending/stop statements. Shared `src/contracts.ts` and all O1/source/H modules remain unchanged. P2 exclusion assumptions, visible disclosures, policy baseline comparisons and its test changes are preserved. The original P1 regression body and all earlier red evidence are retained.

`CaseMassReview` has exactly `caseId`, `assessmentDate`, `functionalUnit`, `boundary`, `material`, `condition`, `moistureBasis`, `massKg`, `evidenceIds`. It means the independently reviewed **whole-case incoming waste mass represented by the functional unit**, in kg. H must provide the current reviewed supplement; O never parses numeric functional-unit text, derives the anchor from quotes, or treats quote agreement as independent proof. Missing/undefined/null is supported migration behavior and makes whole-case totals unavailable. Invalid schema, extra fields, non-positive/non-finite/non-numeric mass throw typed `ValidationError`; invalid calendar dates follow the existing date convention.

The entire record binds to `case-mass:<caseId>`. Case/date/FU/boundary must match the comparison, and material/condition/moisture basis must match the reviewed route. Its own evidence must be in the comparison, bound, permitted, effective and fresh under the existing document policy. Missing/inapplicable reviews use `case-mass-review-missing` / `case-mass-review-inapplicable`; specific evidence failures remain visible. A stale or incorrect upstream review that still meets the declared evidence/freshness policy remains an upstream review responsibility.

Every consumed quote review must have `caseMassKg === anchor.massKg`; mismatch gives `quote-case-mass-mismatch`. Applicability bounds use the anchor. Checks also apply to total/per-trip quotes, included children, operator/processor sales and already-netted sales. Valid applicability still requires the original quantity, ownership, VAT, coverage and commercial checks. Quote lines and all available whole-case cost/carbon/avoided totals include anchor evidence and disclose `검토된 사례 전체 유입 폐기물 질량: 2000 kg` for the fixture. Baseline composition validates both routes against the same context anchor and compares its numeric mass in addition to the preserved route/policy compatibility checks. Missing/invalid anchor cannot yield self-baseline zero.

**Quantity limitation:** non-sales per-kg/per-tonne billing supports whole-case incoming mass only. Stage-priced treatment/residue needs a future explicit billed-flow role and evidenced quantity. This change is **not a general mass-balance verifier**. Sales bills still use independently reviewed `saleableOutputKg`; carbon stage/residue activities and output × substitution derivations retain their own units/quantities. Valid fixture treatment2t, sales100kg, residue100kg and substituted material50kg remain available at **240000 KRW / 45 kgCO2e**. Carbon whole-case gross/credits/net require the anchor without forcing each stage mass to equal it. Individual carbon activity lines remain auditable when only the anchor is unavailable.

`calculationFixture` explicitly authors mass2000kg and its full fact. `bindSynthetic` only binds the supplied anchor, including its own case key; it never manufactures or repairs one after quote edits. All-stale 1000kg quote reviews are rejected against the unchanged 2000kg anchor. Separate-document tests demonstrate that valid quote/activity evidence cannot replace missing, stale, inapplicable or unbound anchor evidence.

Actual final checks: `bun test tests` **151 pass / 0 fail**, 7 files, 55 expect calls, 7.75s; `bun run typecheck` and `bun run typecheck:o-tests` exit0 without diagnostics; extension build 1 module/0.78KB and app build 15 modules/124.57KB exit0; `bun run demo:o` exit0 with normal/held/review/reference200 and absent-adapter503. `git diff --check` passes. Full commands, actual calculator inputs/outputs and red→green evidence: [o-regression-evidence.md](o-regression-evidence.md).

Smoke was **not rerun**. Read-only inspection found the existing SDK environment points at `/home/yeonbug/.omo/agent`, which is read-only; no cache write, environment override or permission workaround was attempted. The default smoke EROFS failure and separately recorded scoped-cache success above are **historical**, not a current pass. No live H/Azure, browser/PDF acceptance, commit/push, install, cloud request or other-agent work is claimed.

## Separate J/H/O provenance integration limitation

J's raw CSV/PDF and O's derived `/facts` JSON are **separate document identities**. Each needs its own source/document ID, hash of its actual bytes and locator into that document. A raw CSV/PDF hash cannot authenticate the derived JSON. Real integration must additionally agree on the transformation lineage from original documents/rows/pages to derived facts and the reviewer/check/version lineage of those facts.

Current `evidenceIssue` requires **every cited source to duplicate the complete bound fact**. It cannot express several original documents jointly supporting one derived review. Multi-source support and the J/H/O lineage agreement remain unresolved integration work; this P1 patch performs no provenance overhaul and does not assert that a synthetic `/facts` record completes real-source integration.

## PR18 correction acceptance

Astra (`gpt-6-astra`, xhigh) reviewed the P1/P2 changes against `fe787b3`
and approved them without actionable in-scope findings. It confirmed that
the baseline fixture correction preserves the 75 kgCO2e arithmetic check with
matching policies and that the original red evidence remains intact.

The lead independently called the public comparison functions:
normal input returned 240000 KRW / 45 kgCO2e; the reported mixed-mass input
returned cost unavailable (`quote-case-mass-mismatch`) while preserving the
independently valid carbon result of 45 kgCO2e. Excluded credits returned
0 / 0 and net 100 with both exclusion policies and the restricted-boundary
qualification in public assumptions.

The actual `renderReport` output for that excluded-credit result was opened in
Chromium at 1440px and 390px, in light and dark themes. With audit details
closed, exclusion notes were visible beside credit and net values; no horizontal
document overflow occurred. This checks the function-generated report, not
live H/Azure integration. Local input/output and screenshot evidence is in
`/tmp/resource-ai-p1p2-qa-QFZwhU/`; temporary captures are not committed.

The prior smoke outcomes remain historical, as stated above. O4 integration
and the separate J/H/O provenance agreement remain open. This correction does
not close those work items or change the Oyeonseok assignment.

## O4 local H integration — 2026-11-06

Local integration, packaging and the launcher test correction are complete on
`feat/oyeonseok-o4-input-questions`, base
`b2ca2c427e1da7570907a4bf8192de4885eb99e1`. Final verification:
**298 tests pass, 0 fail**, including actual source and packaged launchers.
Astra (`gpt-6-astra`, xhigh) returned **APPROVE** after reviewing the full diff
and all 42 full-page captures. Earlier sections remain
historical; this section is the current O4 handoff.

The launcher uses `createResourceApp({ origin, timeoutMs: 10000 })` with no
runner or operational resources. Environment variables cannot enable Azure.
The existing nine-field input and single-column layout remain. Owned
needs-information, needs-review and compared pages allow explicit JSON field
corrections; omitted fields stay unchanged, permitted null means unknown, and
numbers must be unquoted. H converts native form strings and reassesses patches.
Printable report routes contain no forms. Missing execution metadata leaves
model execution information unavailable and Azure success unverified.

Input errors return safe 400 guidance. Recognized session failures map to
404/409/408/504/429/503/502; unknown failures remain generic 502. Origin,
session ownership, identity, size and output validation remain enforced.
SIGINT/SIGTERM dispose work with bounded shutdown; actual SIGTERM exit and
occupied-port exit 1 with a static message are verified.

Distribute `dist/app/` **with sibling `dist/data/`** and the external package
dependencies; launch with `bun /path/to/dist/app/app.js`.
`bun run build:app` stages manifest-listed bundled assets, including legal PDFs
and text snapshots, with lexical/real-path confinement and SHA-256 checks.
Missing files, escaped paths and hash mismatches fail the build. All 14 staged
manifest assets were hash-checked.

Reproduction commands and log results are in
[verification](verification.md#2026-11-06-o4-local-inputcorrection-integration).
The retained launcher regression removes stale `dist/data`, performs a fresh
build/staging, and runs both entries from unrelated temporary directories. It
checks native submission → polymer and mass questions → mass only after
`{"polymer":"PP"}` → review after `{"massKg":100}`, keeping the same case ID,
correction access, no `snapshot-unavailable`, form-free print and SIGTERM exit 0.

The lead's actual packaged browser, **after restart**, also shows
needs-information with polymer and mass and no `snapshot-unavailable`:
`/tmp/resource-ai-o4-qa-vqI0QI/bundle-fixed.json` and
`packaged-questions-mobile.png`. The original missing-asset failure remains
recorded in `bundle-initial.html` in that directory.

Failed-first evidence is retained in `/tmp/resource-ai-o4-red.log`:
28 pass / 15 fail comprised 14 intended behavior regressions and one loopback
reservation failure before child spawn. That environment failure did not
establish a launcher behavior regression. The corrected test asserts H's
instructional list item once, then compares the actual missing-fact questions;
it does not count the instruction as a third question. The currentness
assertion checks `currentness-unverified` while retaining November 6 input.
All original tests and 21 added instances remain enabled; none were removed
or skipped.

Browser evidence covers seven states × three widths × two themes (42
combinations), with zero detector errors/warnings and no horizontal overflow.
320px expanded-text-spacing and keyboard-focus checks pass. HTTP checks show
cross-session case/report/answer isolation 404, foreign Origin 403 and invalid
answer 400. Evidence and capture details are in
`/tmp/resource-ai-o4-qa-vqI0QI/qa-summary.md` and its JSONs. Detector advisories
include an absent script-error probe and existing mobile heading wrapping.
Before/after review found no new blocking readability defect. The two long
mobile comparison captures reach the image height limit; bottom captures
supplement them. No Lighthouse or comprehensive WCAG certification is claimed.

No actual Azure/model calls or operational resources were used. Synthetic
comparison is QA only; pending approval and unavailable/no-baseline semantics
remain. J coverage ends November 5, so November 6 currentness remains held.
Photos are references, not image inference. H's 30-minute case TTL can expire
before O's one-hour session, yielding restart guidance while O's report survives.
H commits facts before O validates its returned envelope; preserving O's
snapshot does not guarantee H rollback. Real reviewed operational supplements,
refreshed legal coverage and live Azure verification remain external work.
No H/J/shared-contract/dependency changes were made. The optional no-excuse
scanner timed out (124); LSP/linter were unavailable. Neither is claimed as a
pass. A nonblocking review note remains: the launcher test pins H's existing
guidance sentence, so an intentional copy change will require updating that
expectation. Review: `/tmp/resource-ai-o4-astra-final-review.txt`.
