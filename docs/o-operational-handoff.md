# O4 operational runtime handoff

## Goal and demo update: 2026-11-15

The code and QA receipts below are historical implementation evidence. The current [recommendation goal](recommendation-goal.md) uses labelled public/synthetic packages without waiting for field data. Permits, acceptance/contracts, actual quotes/mass/distance, factor site applicability and site approval are pre-execution checks, not prerequisites for all route comparisons. Provider/financial authority, private-store guards, independent recovery supervisor and retention ownership remain live operational requirements; corpus independence and human labels remain evaluation requirements.

The new five-minute demo target supersedes the held-only script below: three minutes show the versioned input, compared routes and reasons, sourced processor candidates, labelled calculation items and checklist; two minutes submit hazardous-contact or contradictory input, inspect the block, correct the same case, and inspect the returning comparison and checklist. This is a target to prove after recommendation-mode integration, not a claim that it already ran. Neither the existing nor new demo establishes field suitability, financial settlement or independent labels.

Branch: `feat/oyeonseok-o4-supplier-selection`, base
`ceb9e48b6db3e1a16b1eb69a65a35da8482b0dc4`. O owns supplier-selection assembly,
component checks and this execution handoff. The parent owns whole-suite/real
HTTP/UI QA, Astra final gate and PR; the team lead owns integrated acceptance
and final report/video. Keep #12
open and #8 closed. No provider approval or field package is supplied here.

## Entry and prerequisites

Supported host: one Linux x64 process, Bun 1.4.2, `/usr/bin/flock` from
util-linux, loopback HTTP, private local filesystem and installed external
packages. Shared/network filesystems, distributed workers, enterprise identity,
Windows and remote financial atomicity are outside this implementation.

From the checkout:

```sh
bun --version
test -x /usr/bin/flock
bun install --frozen-lockfile --offline
bun run typecheck
bun run typecheck:o-tests
bun run build
bun run build:app
mkdir -m 700 /absolute/private/sdk-smoke-cache
RESOURCE_MODEL_RUNNER=local OMO_CODING_AGENT_DIR=/absolute/private/sdk-smoke-cache SENPI_CODING_AGENT_DIR=/absolute/private/sdk-smoke-cache bun run smoke
```

The offline install checks the existing cache; on a new host install the locked
packages with `bun install --frozen-lockfile` before disconnecting the network.
Neither installation command authorizes inference. Bundles retain external
dependencies beside the package; they are not standalone executables.

Provision an account and initial case with the local runner first:

```sh
mkdir -m 700 /absolute/private/resource-artifacts
bun scripts/o-account.ts create --state-dir /absolute/private/resource-state --username operator
RESOURCE_MODEL_RUNNER=local RESOURCE_APP_AUTH=local-operator RESOURCE_STATE_DIR=/absolute/private/resource-state RESOURCE_RESOURCES_DIR=/absolute/private/resource-artifacts bun scripts/app.ts
```

Log in through `/login`, create a case, and export `/cases/CASE_ID/input`.
Record the exact case ID, input ETag/revision and stable actor ID from the private
runtime database's `accounts.actor_id` for that username. The account CLI does
not print an actor ID; a username is not that ID. Stop this process before operational startup. Runtime state
must already exist; operational mode cannot provision accounts or use memory.

## Mutually exclusive accounting selection

`createOperatorRuntime` defaults to `{kind:"o-journal"}` and preserves the
nonoptional `runtime.journal` API for journal callers. The ordinary environment
launcher remains journal-backed. Explicit `{kind:"h-suppliers",open}` calls the
trusted `OpenOperatorSuppliers` factory once and assembles H's
`createOperationalHandoff` directly. This path exposes no journal, does not open
or inspect `<state>/operations`, and does not use journal transport accounting.
Unknown/mixed selections, invalid suppliers and selected-backend failures stop
startup; there is no fallback or environment JavaScript/module loader.

`startApp({suppliers:{configuration,open},transport?})` is the typed server-entry
API. It requires explicit `RESOURCE_MODEL_RUNNER=operational`, local operator
identity, existing private state/resources and **unset**
`RESOURCE_OPERATIONAL_CONFIG`. A deployment entrypoint must supply a real
operator-reviewed bundle before this API can run operationally. No such bundle,
ledger approval or provider approval is included in this checkout. The CLI
command below selects the existing O journal only; it cannot select H.

`parseHOperationalConfiguration` accepts the same explicit execution/grant and
technical-limit fields as the old O config, **omits `journalCapacity`**, and
requires `budget:{mode,policyReference,budgetReference}`. Modes are `financial`,
`request-quota`, or the explicitly synthetic harness mode `test-only`. References
use the approval-ID syntax and must identify the supplied ledger's actual policy
and budget. The ledger must durably acknowledge these bindings in
`activatePolicy(configuration)` and atomically enforce request/concurrency
limits itself. O adds no parallel counter. A financial policy and its amounts,
rates/currency/price versions are the supplied ledger's responsibility; a
request quota and `maxOutputTokens` never establish a monetary cap. `test-only`
requires an injected synthetic transport. Every injected transport persists
synthetic presentation; readiness remains `liveModelVerified=false`.

The required `OperatorSupplierBundle` contract is exported from
`src/o-operational-backend.ts`:

| Implementation / policy | Required identity and responsibility |
| --- | --- |
| `ledger.reserve/release/reconcile` | Identified actual ledger, budget mode and policy reference; durable per-attempt reservation IDs distinct from stable O policy `approvalId`; atomic quotas and idempotent aggregate settlement |
| `store` | Already constructed real `createOperationalAuditStore`; separate file-backed audit and recovery databases; append H audit once and synchronously acknowledge recovery once |
| `privateFileGuard()` | Identified implementation verifying canonical paths, pinned inode/owner/mode, links, approved parent directories and SQLite sidecars; returns `true` only after checks |
| `recoverySupervisor.assertReady()` | Identified independent supervisor that can inspect the ledger and use recovery-only storage after web-process/audit loss, including expired/crashed/lost-response reservations |
| `retention.assertReady()` | Approved retention-policy identity and named responsible owner; unresolved obligations survive archival/deletion; store capacity and photo retention are separate settings |
| `assertReady`, `activatePolicy`, `settled(runId?)`, `close` | Real readiness, durable approval pinning, complete descendant drain and idempotent application-resource close |

Identity strings alone are insufficient. Startup checks implementations, private
guard, an actual audit-store read, supervisor/retention readiness and durable
activation. The factory owns cleanup if it throws before returning its bundle.
Bundle identities, captured callback implementations and all settings stay
immutable until restart. The adapter binds callback references to their supplied
owners; it does not freeze supplier-owned mutable resource/lifecycle state.

The factory receives frozen configuration and `binding(runId)`. Each immutable
binding contains the random run ID, stable policy approval, exact actor/case/
lease/input revision, artifact SHA/origin and shared photo ticket. The ledger
must persist that association before acknowledging a reservation. Terminal and
late recovery use captured bindings after identity/lease cancellation; bindings
remain available until H, raw supplier/transport and bundle descendants settle.
O checks live identity, credentials, grant/source, selected photos and ticket at
start, before reserve, after authorization, dispatch audit and synchronously
before actual transport. H retains its account/model/payload/image checks.

H's additive `settled(runId?)` drains authorization/record operations and the
actual internal finalization promise, including rejected/late work. It does not
change H reservation, audit, deadline or financial semantics. In particular H
marks `transportStarted` before invoking O's wrapper: O may refuse the final
guard with zero underlying calls while H conservatively reconciles unknown
usage. That is not evidence of a refund. Reserve/release/reconcile and audit
are owned solely by H on this path; O performs no double audit.

Reload stops admission, drains the selected backend, validates immutable fields,
delegates durable activation, then publishes grants/validity/approval. Reused
approval IDs must pin identical configuration and never reset consumed or
unresolved quota. Backend, target, budgets, suppliers, authority and retention
require restart. Failure remains stopped; a completing reload cannot undo
concurrent close. Typed H callers invoke `runtime.reloadConfiguration` with
H-native configuration; the ordinary journal launcher uses SIGHUP as below.

Close cancels admissions/application requests, serializes against reload and
drains handlers, app work, actual H finalization/late reserve, raw supplier and
transport promises, bundle settlement and cleanup before closing resources.
Failed recovery acknowledgement stops further admission, including a callback
that incorrectly returns false. An uncooperative continuation keeps close
pending; the launcher's referenced grace timer exits nonzero without closing
resources underneath it. The independent supervisor remains responsible after
process death. Its idempotent handler must track its own raw promises past
`processOperationalRecovery`'s timeout/cancellation race, and must keep its own
connections open until those promises finish.

## Existing O journal configuration contract

`readOperationalConfiguration(absolutePath)` reads a JSON object with exactly
the following keys. Unknown keys fail validation. The config and auth file
must be canonical absolute, regular, single-link, UID-owned 0600 files in
UID-owned 0700 directories. Startup checks auth metadata without reading
credentials. Only the guarded SDK path reads credentials during execution;
it refuses refresh, pool rotation and credential writes. The auth inode is
pinned for the lifetime of the assembly. Replacing that file requires restart.

| Key | Required value |
| --- | --- |
| `approvalId` | Actual operator-supplied approval reference, `[A-Za-z0-9_.-]{1,128}` |
| `validFrom`, `validUntil` | Explicit epoch milliseconds, `validFrom <= now < validUntil` |
| `grants` | 1–100 exact `{actorId, caseId, inputRevision, artifactSha256}` entries; enabled local account, 64-character lowercase SHA-256 revision; artifact SHA-256 or explicit `null` for absent package |
| `target` | `{provider:"chatgpt-subscription", endpoint:"https://chatgpt.com/backend-api/codex/responses", modelId, accountIdSha256, authPath}`; exact approved model, account-ID SHA-256 and private auth path |
| `purpose` | Explicit nonblank purpose, at most 500 characters |
| `photos` | `{enabled:false,mappings:[]}`, or `enabled:true` with exactly one `{target,scope}` mapping; mapping target has the four target fields excluding `authPath`; scope is `{provider:"chatgpt-subscription",purpose}` matching the configured purpose |
| `requestAllowance` | Integer 1–1,000,000; technical requests, never money |
| `concurrentRuns` | Integer 1–100, no greater than allowance |
| `permitLifetimeMs` | Integer 1–60,000; expiry also bounded by approval expiry |
| `runnerTimeoutMs` | Integer 1–60,000, at most request timeout |
| `requestTimeoutMs` | Integer 2–64,999; strictly below the 65-second case lease |
| `maxTurns` | Integer 1–10 |
| `maxOutputTokens` | Integer 16–8192; SDK setting, **not a subscription provider cap** |
| `journalCapacity` | Integer 10–1,000,000 total policy/run/attempt/event rows; exhaustion blocks writes and dispatch, never drops history |
| `shutdownGraceMs` | Integer 1–120,000, at least request timeout |
| `acknowledgeUncappedSubscription` | Literal `true` |
| `acknowledgeRequestQuotaIsNotMoney` | Literal `true` |

There are deliberately no repository values for approval, account, auth path,
purpose, deadlines or quotas. H/lead must supply these; copyable invented
approval or financial ceilings would give a false authorization boundary.
An artifact's hash and `field` declaration are integrity metadata, not approval.
An absent package stays absent; corruption or mismatch fails before transport.

After writing the real private configuration, the explicit startup command is:

```sh
RESOURCE_MODEL_RUNNER=operational RESOURCE_APP_AUTH=local-operator RESOURCE_STATE_DIR=/absolute/private/resource-state RESOURCE_RESOURCES_DIR=/absolute/private/resource-artifacts RESOURCE_PRIVATE_PHOTOS=off RESOURCE_OPERATIONAL_CONFIG=/absolute/private/operator/operations.json bun /absolute/checkout/dist/app/app.js
```

Use `RESOURCE_PRIVATE_PHOTOS=on` when enabling the explicit photo mapping.
`RESOURCE_MODEL_ID`, `RESOURCE_AUTH_PATH` and the direct Azure configuration
variables must be **unset**, including empty values. Invalid operational
configuration stops before listen; it never selects a direct runner, anonymous
identity or memory database. Config-file presence in another mode does not
enable inference. Legacy modes retain their previous selection behavior;
always explicitly select `RESOURCE_MODEL_RUNNER=local` for offline work.

For component verification, `createOperatorRuntime({... , transport})` accepts
an injected synthetic HTTP transport and optional `openCaseSession` seam. Any
injected transport persists `presentation.mode="synthetic"`, regardless of
artifact origin. The launcher has no environment switch pretending a real
transport is synthetic. Readiness always leaves live verification false.

## Exact revision grants and photos

One subscription photo authority is shared by case leases, photo storage and
operations. It publishes only the configured exact target/scope mapping.
Consent is explicit, bound to the issued authority and checked again before
transmission/publication. Text-only execution needs no photo ticket.

Photo references are generated at upload, so an exact selected-photo revision
cannot be approved before upload. The compatible addition is a drained grant
reload that preserves the authority:

1. Upload and explicitly consent through the authenticated case page.
2. Determine the exact proposed input revision with those photo references;
   obtain the operator's actual grant and, if required, exact resource package.
3. Write the new private config with a **new actual approval reference**, exact
   grants and validity interval. All other config fields must stay identical.
4. Send `kill -HUP PID`. Admissions pause, existing work drains, and the new
   policy is durably pinned before admissions resume. Failed reload stops the
   launcher nonzero; the library leaves admissions stopped. It does not retarget
   the authority or extend an existing request's absolute deadline.

The same approval ID can only replay identical configuration. Editing its quota
or grants cannot reset it. A new approval has its own explicit request allowance;
old consumed and unresolved history remains. Restart creates a new authority;
old photo consent cannot authorize a fresh model run. Upload/consent again,
then obtain and reload the new exact grant. There is no automatic photo approval.

## Journal and recovery

`<state>/operations/journal.sqlite` is a separate private SQLite database with
a closed schema, WAL and `synchronous=FULL`. The existing runtime schema is
unchanged. Startup validates schema/retained metadata and checks path/inode
identity. Storage failures never use an in-memory substitute. These SQLite
settings and process-crash tests are **not a power-loss durability guarantee**.

The exclusive lock is a kernel `flock` held by a parent-owned file descriptor.
`flock(1)` acquires it through the inherited descriptor; closing/crashing the
owner releases it. The lock file may remain and must not be deleted. Opening a
second runtime or inspector while the owner lives fails, including another
connection in the same process. This prevents recovery of active work without
PID reuse checks, stale lock deletion races or permanent crash lockouts.

Reservation and audit bind to the actual lease, actor, case, input revision and
staged artifact hash/origin. Live identity and grant are checked at start,
authorization, dispatch audit and immediately before transport. Terminal writes
use the captured binding after cancellation/account disable. Actor and lease
IDs are hashed in the journal. Raw cases, image bytes, credentials, headers,
provider bodies and auth paths are not recorded.

| Durable evidence | Quota/recovery action |
| --- | --- |
| `reserved` or `dispatch`, no transport intent | Release once at finish or startup recovery |
| Transport intent committed | `unresolved` until observed response metadata is committed |
| Successful response headers observed | `consumed`, including when publication later fails |
| HTTP failure, thrown transport, crash during invocation | Retain `unresolved`; no automatic refund or retry |
| Successful H terminal usage | Store once at run level; null remains unavailable and reported zero remains zero |

Active reservation, consumed and unresolved attempts all occupy allowance.
Identical reservation/event replay is idempotent; conflicting replay fails.
There is no automatic allowance reset or expiry refund. The transport decorator
records the outbound byte digest and **intended** image hashes separately from
H terminal `images` and observed HTTP request IDs. A transport intent is not a
provider receipt. Aggregated H usage is not per-attempt billing. No prices,
currencies, price versions, financial refunds or monetary settlement are inferred.

Stop the process before inspection (use its actual PID):

```sh
kill -TERM PID
bun /absolute/checkout/dist/app/o-journal.js --state-dir /absolute/private/resource-state --limit 25
```

The inspector opens existing storage exclusively without running recovery. It
returns at most 100 sanitized rows, including approval target/account hash,
purpose hash, exact grant hashes, terminal audit, observed response metadata
and payload hashes. Continue with the final returned `(run,attempt)`:

```sh
bun /absolute/checkout/dist/app/o-journal.js --state-dir /absolute/private/resource-state --limit 25 --after-run LAST_RUN_ID --after-attempt LAST_ATTEMPT
```

After a crash, inspect first, then repeat the exact operational startup command
above with the same state and unchanged approved config. Startup releases only
proven uninvoked attempts and marks interrupted runs `recovered`. Transport
intent remains unresolved and blocks its allowance. No request is replayed.
Expired approval must be replaced through the actual operator approval process;
inspection does not need credentials or unexpired approval. Never delete the
journal, increase a reused approval's limit, or manually refund uncertainty.

Shutdown stops admissions/cleanup scheduling, cancels application work, drains
HTTP handlers, H terminal audit callbacks, journal/transport continuations and
cleanup, then closes SQLite. The forced-exit timer remains referenced so a
promise with no other event-loop handles cannot accidentally exit successfully.
An incomplete drain exits 1 without closing SQLite underneath callbacks; restart
retains the uncertainty. The original request deadline and H audit budget remain.

The default local-auth clock combines wall time with monotonic elapsed time
within one process, including in-process database reopen. This avoids rejecting
that process's own attempt windows after a backward wall-clock correction.
Forward corrections may expire sessions sooner. The offset is not persisted or
shared across processes: process restart does not preserve elapsed-expiry history,
and future-start rows still fail closed. Case, photo and grant clocks remain
wall-clock based. This is not a general cross-process rollback guarantee.

## Package installation and reassessment

The PR30 package format, validator and installer are unchanged. With the exact
authenticated input export and a supplier package, run:

```sh
bun /absolute/checkout/dist/app/o-artifact.js check --state-dir /absolute/private/resource-state --resources-dir /absolute/private/resource-artifacts --username operator --case-id CASE_ID --expected-revision INPUT_REVISION --artifact /absolute/private/incoming/package.json
bun /absolute/checkout/dist/app/o-artifact.js install --state-dir /absolute/private/resource-state --resources-dir /absolute/private/resource-artifacts --username operator --case-id CASE_ID --expected-revision INPUT_REVISION --artifact /absolute/private/incoming/package.json
```

Installation does not evaluate or approve. In the authenticated case correction
form submit an unchanged existing field, with its actual current `baseVersion`.
For JSON clients the body is `{"baseVersion":CURRENT_VERSION,"patch":{"massKg":EXPORTED_MASS}}`
to `POST /cases/CASE_ID/answers`, with same-origin header and private login cookie.
An empty patch is invalid. Operational reassessment additionally requires an
exact grant with the installed artifact hash. Capture input revision, artifact
hash, resulting version, decision/conditions and journal run/receipt metadata.
If input changes, re-export and obtain a newly bound package. Missing supplier
packages, current legal/rights evidence and actual provider approval remain
absent; this implementation does not manufacture them.

## Demonstrations

Run `RESOURCE_MODEL_RUNNER=local bun run demo:o` for generated synthetic
normal/held/review artifacts and the disk-backed native handler demo. For a
live browser on a capable host, launch the local command above and log in.

* **Normal, three minutes:** 0:00–0:30 login/recover; 0:30–1:00 open
  `/demo/normal` and identify synthetic origin; 1:00–2:00 inspect calculation,
  conditions, unavailable values and human review; 2:00–3:00 follow original
  versus derived source references/hashes and print the report.
* **Held, two minutes:** 0:00–0:30 create incomplete input; 0:30–1:00 correct
  a field on the same versioned case; 1:00–1:30 show questions/currentness hold
  and export input; 1:30–2:00 stop/restart the same local state, log in and recover
  through `/cases`. Do not imply that a correction supplies current legal data.

For guarded SDK component evidence run the focused test commands; they create
only temporary synthetic credentials/accounts/pixels and injected SSE responses.
They do not contact providers. Neither demo establishes field acceptance or
independent evaluation labels. The lead owns recordings and integrated acceptance.

## Verification ownership

```sh
RESOURCE_MODEL_RUNNER=local bun test tests/o-operation-journal.test.ts tests/o-operational-runtime.test.ts tests/o-operational-photos.test.ts tests/o-runtime.test.ts tests/operations.test.ts tests/subscription-operations.test.ts
RESOURCE_MODEL_RUNNER=local bun test tests/o-operational-suppliers.test.ts tests/operational-handoff.test.ts tests/operational-audit-store.test.ts
bun run typecheck
bun run typecheck:o-tests
bun run build:app
```

Tests retain PR31's existing regressions and exercise real private disk SQLite,
writer contention, replay conflicts, interrupted child processes, shared photo
authority, stale identity, synthetic persistence and late transport metadata.
Actual TCP/SIGTERM normal and held launcher scenarios remain executable tests;
they require a host permitting loopback listen. O owns complete-suite and real
packaged desktop/mobile light/dark QA. Field approval, real
provider receipts, power-loss testing and financial settlement remain separate.

The final Linux/Bun 1.4.2 complete suite passed **594 tests / 0 failures**.
Strict source/Node/Bun/O typechecks, extension and packaged app/account/artifact/
journal builds, and official offline smoke passed. Native Chromium login,
same-revision evaluation, rejected ungranted revision and recovery were checked;
desktop and 390px mobile light/dark captures preserved synthetic and billing
disclosures. After graceful shutdown, the packaged inspector returned the
consumed request, observed synthetic response ID, reported zero usage and
payload digest from disk. Actual provider calls were zero.

Astra re-review approved the final photo-expiry guard and auth-clock corrections.
The photo regression crosses expiry after the durable transport-intent commit,
proves zero invocation and releases the uninvoked reservation. The login503
diagnosis was backed by an observed 1,444 ms host-clock rollback and a persisted
window 1,155 ms ahead. Earlier separate operator403/evaluation502 observations
were not independently diagnosed; the final complete suite passed, and those
observations are not claimed to share the proven login cause.

## 2026-11-13 supplier-selection evidence and second assignment check

This worktree remains uncommitted on the branch/base at the top of this file.
Environment: Linux x64, Bun 1.4.2, installed locked dependencies. No real
credentials, provider/external requests, data downloads, commits or pushes were
used. The parent still owns whole-suite, packaged real HTTP/UI verification,
Astra final gate and PR. Historical test totals above are historical evidence.

The O-owned harness in `tests/o-supplier-fixture.ts` supplies these **test-only**
implementations, not a production supplier:

| Identity | Actual implementation and owner |
| --- | --- |
| `TEST-ONLY-sqlite-quota-ledger` | O test harness: private FULL/WAL SQLite policy pins, per-attempt UUID reservations, technical request/concurrency limits, idempotent release and aggregate settlement; no financial rates |
| H `createOperationalAuditStore` | Actual H implementation with separate private `audit.sqlite` and `recovery.sqlite` connections; O harness supplies temporary databases |
| `TEST-ONLY-posix-inode-sidecar-guard` | O harness: canonical paths, pinned file identity, owner/mode/link/parent and WAL/SHM checks |
| `TEST-ONLY-independent-recovery-connection` | O harness: independently opened recovery-only store and ledger, expired/lost-response inspection, idempotent effect records and raw-handler drain beyond the bounded recovery attempt; also reopened after child/application shutdown |
| `TEST-ONLY-retain-all-obligations`, owner `O-test-harness` | Explicit harness policy retaining all rows; it implements no production retention/deletion approval |

Tests use native login, private persistent cases/photos/artifacts, real SDK
serialization and synthetic SSE transport. They prove one backend, single
accounting/audit invocation, exact immutable lease/run/artifact binding, distinct
policy/reservation IDs, reported-zero versus null usage, restart quota and
synthetic disclosure, final dispatch revocation, actual continuation drain,
independent recovery under audit contention, and reload/close/dispose ordering.
The real loopback/SIGTERM tests remain intact for a capable host.

Red evidence was observed before the corresponding fixes: new H drain tests
initially failed with `settled` absent; false recovery acknowledgement
left admissions open (`403` instead of `503`); dispose/reload reopened admission
(`408` instead of `503`); queued reloads reopened it during the later activation
(`403` instead of `503`). Mutation checks additionally removed actual-finalize
tracking (three failing stall tests) and final O credential guards (one underlying
call instead of zero). Restoring those mechanisms passed the affected tests.
An additional supplier-state regression rejected freezing a managed supplier's
internal lifecycle state; the adapter now pins bound callback references while
allowing its original close implementation to update its own resource state.
Task-local logs are `/tmp/o4-h-finalize-red-20261113.log`,
`/tmp/o4-final-guard-red-20261113.log`,
`/tmp/o4-final-guard-green-20261113.log`,
`/tmp/o4-dispose-reload-red-20261113.log`,
`/tmp/o4-dispose-reload-green-20261113.log`,
`/tmp/o4-queued-reload-red-20261113.log`, and
`/tmp/o4-control-final-20261113.log`, and
`/tmp/o4-supplier-state-red-20261113.log`. These are local artifacts, not provider
or financial acceptance records. Audit-stall tests observe the actual audit
AbortSignal before releasing the hold; HTTP completion alone is insufficient.

The sandbox rejects loopback listen. A direct Node probe returned
`code:'EPERM', errno:-1, syscall:'listen', address:'127.0.0.1'`; Bun's HTTP
server also reported `EPERM: operation not permitted, listen`. No permission
workaround or replacement production path was used. Preserved tests requiring
parent-host execution are the journal normal/held SIGTERM tests, H normal/held
SIGTERM tests, H HTTP bridge, packaged local-operator launcher and O4 source/
packaged launcher scenario. Run the unfiltered commands above on that host.

For reproducible checks of all supported focused scenarios in this sandbox,
after separately recording the unfiltered loopback failures:

```sh
RESOURCE_MODEL_RUNNER=local bun test tests/o-operational-suppliers.test.ts tests/o-operational-runtime.test.ts tests/o-operational-photos.test.ts tests/o-operation-journal.test.ts tests/o-runtime.test.ts tests/operational-handoff.test.ts tests/operational-audit-store.test.ts tests/operations.test.ts tests/subscription-operations.test.ts -t '^(?!.*(?:HTTP launcher|HTTP bridge|packaged local operator launcher)).*$'
RESOURCE_MODEL_RUNNER=local bun test tests/processors.test.ts tests/comparison.test.ts tests/carbon.test.ts tests/report.test.ts tests/app.test.ts
```

Observed results (all counts refer to this working tree, not historical PR totals):

| Check | Result / task-local log |
| --- | --- |
| `bun run typecheck`, `bun run typecheck:o-tests`, `bun run build:app`, `bun run build` | Pass with installed Bun 1.4.2 dependencies |
| Unfiltered nine-file focused suite | 172 pass / 6 loopback failures; `/tmp/o4-focused-final-20261113.log` (before the final added control regressions) |
| Latest nine-file focused suite, only six loopback tests filtered by the command above | 174 pass / 1 failure / 6 filtered; `/tmp/o4-focused-supported-20261113.log`. The unchanged `journal permissions corruption stops startup before recovering reservations` failed its initial live-grant check, before permission corruption. Do not call this a clean combined run. |
| Unchanged journal file, isolated recheck | 19 pass / 0 fail; `/tmp/o4-journal-recheck-20261113.log`. The preceding intermittent live-grant failure was not reproduced or assigned a proven cause. Journal implementation and tests were not changed. |
| Final assembly/control checks after typed reload narrowing | 9 pass / 0 fail; `/tmp/o4-final-assembly-20261113.log` |
| Explicit late audit/release/reconcile/transport/bundle drain checks | 5 pass / 0 fail; `/tmp/o4-actual-drain-final-20261113.log` |
| Final pinned-callback/state, photo, selection, drain, reload and recovery-acknowledgement checks | 23 pass / 0 fail; `/tmp/o4-supplier-final-20261113.log` (after the supplier-state fix) |
| Typed launcher conflict selection after narrowing journal reload | 1 pass / 0 fail; `/tmp/o4-launcher-selection-final-20261113.log` |
| O1–O4 focused assignment checks | Unfiltered 152 pass / 1 loopback failure (`/tmp/o4-assignment-check-20261113.log`); with only that launcher scenario filtered: 152 pass / 0 fail (`/tmp/o4-assignment-supported-20261113.log`) |

The parent must rerun the unfiltered focused/whole suite and real packaged
HTTP/UI tests on its loopback-capable host, including the intermittent journal
startup case. The individual successful rerun does not erase that observation.

The second assignment check re-read O1–O4 ownership and source/test boundaries,
the unchanged O ten-candidate handoff/manifest, and PR35's unchanged photo
inventory. The documented read-only candidate validation passed: ten exact
CaseInputs, distinct IDs/paths, matching actual SHA256s and null independent
labels/reviewers/split/acceptance. No replacement candidates or independent J/H
labels were authored. The 700-photo inventory has no approved location, access
or retention, no accepted field cases and no model-transfer approval. It is not
a field package or an input grant; its originals were not accessed/downloaded.

O1 still needs actual permit/acceptance evidence. O2 needs reviewed quotes and
independent `CaseMassReview`. O3 needs rights/GWP/boundary-qualified factors.
O4's selectable assembly is implemented; actual provider/financial/field
acceptance, approved private-store guard, independent deployed supervisor and
retention policy/owner, field package, corpus acceptance and independent labels
remain external dependencies. Keep **#12 open and #8 closed**.
