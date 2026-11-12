# O4 operational runtime handoff

Branch: `feat/oyeonseok-o4-operational-handoff`, base
`74c8c3d9a3bae87b560f72e05068f991ca255265`. O owns the implementation PR,
component checks and execution handoff; the team lead owns integrated acceptance
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

## Configuration contract

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
