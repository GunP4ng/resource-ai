# O4 local operator runtime

This implements the next O-owned #12 wiring after PR27. It does not claim
enterprise SSO, approved field data, live provider execution or integrated
acceptance. Defaults keep the existing anonymous ephemeral launcher.

Explicit `local-operator` mode uses operator-provisioned accounts, hashed
passwords and opaque sessions in a private Bun SQLite database. There is no
public signup and no inferred organization membership. The same database
holds committed cases and cleanup obligations; active candidates remain
request-private. Existing case/report retention and owner isolation remain.

The resource input is the existing `{ record, sha256 }` result of
`prepareCaseRecord`, supplied privately for an exact actor/case/input revision.
Its hashes and existing evidence/domain checks establish consistency, not
human approval. Missing approved field packages remain unavailable; synthetic
packages retain their synthetic identity.

## Narrow H integration boundary

O extends the existing trusted identity object with an optional server-only,
synchronous `assertCurrent()` check. Existing trusted string resolvers remain
compatible. Local accounts always supply finite expiry and the assertion;
private responses and mutation publication recheck it, including inside the
shared SQLite transaction. A browser cannot supply this assertion or actor.

The existing operational and session app factories forward O-owned
authentication and presentation dependencies to `createApp`. This changes
neither `CaseInput`/`DecisionResult` nor runner policy, photo execution mappings,
model dispatch, audit or billing contracts.

These are integration changes for review, not a claim of human H
approval. Subscription model-photo transmission remains disabled. H retains
the actual provider/model mapping and guarded photo boundary.

## Implementation and acceptance

Persistence and artifact loading can be implemented before authentication.
Local account validation then shares the committed database, followed by
native login/recovery/input-export views and one explicit launcher assembly.

Tests must exercise restart, real database contention, private staging,
rollback, revocation and cleanup races, malformed storage, session expiry and
disable/logout during evaluation, exact resource binding and truthful usage.
Parent-owned real HTTP/browser QA and a single Astra gate precede PR handoff.
Real field-package delivery and the lead's integrated QA/video remain separate.

## Screen brief

The styled reference is the existing `src/report.ts` page and its tokens.
Layout: retain Re:Source's 74ch single-column native forms and report flow;
use a plain owned-case table, with no dashboard grid or new visual skin.

- Login: primary action is login; show provisioned-account scope, username,
  concealed password, generic failure and a return path. No signup.
- Owned cases: primary action is create a case; list owned descriptions,
  versions and retention, with case/report links and a separate logout action.
- Case/report: keep verdict, conditions, sources, corrections and human review.
  Add persisted runtime/data/execution/usage context and historical-evaluation
  notice when current input differs. No source approval inferred from login.
- Failure: identify the failed attempt and link to the previous owned case or
  case list; never label a failed evaluation as the last committed outcome.

Before UI edits, the parent captured the unchanged main UI through real
Chrome: home, held case and report, each desktop1440/mobile390 light/dark.
Artifacts are `/tmp/o4-runtime-before-<home|case|report>-<device>-<theme>.png`.
The source match to main1daaf80 was checked before capturing. New login/list
surfaces have no previous implementation; they reuse the existing native form
and table style. Final QA must cover them and the affected existing views.

## Configuration and provisioning

Run with the installed Bun runtime. There is one assembly path in `scripts/app.ts`.
Default `RESOURCE_APP_AUTH=anonymous` preserves temporary sessions and the
subscription runner default. Explicit invalid values or incompatible settings
fail startup; storage errors never select a memory fallback.

| Setting | Values and constraint |
| --- | --- |
| `RESOURCE_APP_AUTH` | `anonymous` (default), `local-operator` |
| `RESOURCE_STATE_DIR` | Required absolute, canonical private root in local mode; forbidden in anonymous mode |
| `RESOURCE_RESOURCES_DIR` | Optional absolute curated root; local mode required; directories 0700 and files 0600 |
| `RESOURCE_PRIVATE_PHOTOS` | `off` (default), `on`; local mode required; storage only |
| `RESOURCE_MODEL_RUNNER` | Existing `subscription` (default), `azure`, `local` |
| `PORT` | Existing loopback port; default 3000 |

Use dedicated operator-owned roots. The database opener creates a missing final
directory with mode 0700; its parent must already exist. Existing roots/files
must satisfy the foundational private-path checks. No accounts are shipped.

```sh
mkdir -m 700 /absolute/private/resource-artifacts
bun scripts/o-account.ts create --state-dir /absolute/private/resource-state --username operator
RESOURCE_MODEL_RUNNER=local RESOURCE_APP_AUTH=local-operator RESOURCE_STATE_DIR=/absolute/private/resource-state RESOURCE_RESOURCES_DIR=/absolute/private/resource-artifacts bun run app
```

The CLI conceals the password prompt. For managed stdin use `--stdin-secret`
with a private input stream ending at EOF. Never put secrets in argv, environment
variables or logs. The other operations are:

```sh
bun scripts/o-account.ts reset-password --state-dir /absolute/private/resource-state --username operator
bun scripts/o-account.ts disable --state-dir /absolute/private/resource-state --username operator
bun run build:app
bun /absolute/checkout/dist/app/o-account.js create --state-dir /absolute/private/another-state --username operator
RESOURCE_MODEL_RUNNER=local RESOURCE_APP_AUTH=local-operator RESOURCE_STATE_DIR=/absolute/private/resource-state bun /absolute/checkout/dist/app/app.js
```

Packaged entries work from an unrelated cwd while installed external dependencies
remain available beside the checkout/package. Only public manifest assets are
staged under `dist/data`; state, accounts, photos and curated artifacts are never
copied. This is a Bun bundle with external packages, not a standalone executable.

## HTTP, recovery and exact artifact installation

1. Open `http://localhost:3000/login`. Native `POST /login` verifies bounded
   username/password fields, checks same origin and sets the opaque HttpOnly
   session cookie. There is no public account creation. Login rotates any older
   session for that account. A missing identity returns 403 with a login link.
2. `GET /` creates a case using the existing native `POST /cases` form.
   `GET /cases` lists only the authenticated actor's unexpired cases, versions
   and retention deadlines; local mode never creates anonymous sessions.
3. `GET /cases/:id` retains corrections, sources, conditions and photo controls.
   `GET /cases/:id/input` exports the committed `CaseInput` as JSON, with
   `ETag: "<revision(input)>"` and `Cache-Control: private, no-store`.
   Save the exact bytes/input before requesting an independently reviewed package.
4. The operator obtains the stable actor ID from the provisioned account's
   private SQLite `accounts.actor_id` (not the username). Install the existing
   `prepareCaseRecord` result, unchanged, at:

   ```text
   <RESOURCE_RESOURCES_DIR>/<actor_id>/<caseId>/<input-revision>.json
   ```

   Create each private directory with mode 0700 and write the regular, single-link
   artifact with mode 0600. The object is exactly `{ record, sha256 }`, not just
   `record`. Neither the UI nor a model accepts a filesystem path. Do not rewrite
   another artifact to fit this case, its revision, mass or date.
5. Explicitly reassess by submitting an unchanged existing field in the native
   correction box, e.g. `{"massKg":100}` only when the exported input has that
   exact mass. The form includes `baseVersion` and explicit photo selection.
   JSON clients use `POST /cases/:id/answers` with
   `{"baseVersion":1,"patch":{"massKg":100}}`. An empty patch is rejected.
   Re-export if input changes; artifacts are bound to exact revisions.
6. `GET /cases/:id/report` is the print view. Reports use saved runtime settings
   and `snapshot.review`, including artifact origin/hash and evaluated revision.
   Restarting with another runner or artifact directory cannot relabel an old
   result. Current input that differs from `evaluated.revision` gets a historical
   evaluation warning. Retention is one hour after evaluation and editing is
   allowed for 30 minutes; restarting does not renew either deadline.
7. Restart the same local mode with the same state root, log in again, then use
   `/cases` to recover cases. `POST /logout` durably revokes the current session.
   Reset/disable invalidate that account's sessions. Other actors receive 404
   for a case, export, report, edit or photo they do not own.

Authentication expiry/revocation is rechecked before private responses and in
publication transactions. Original request deadlines cover body, authentication,
resources and model evaluation. Missing/expired identity is 403, conflict 409,
cancellation 408, deadline 504 and authentication/storage/resource availability
failure 503. Failed attempts preserve the last committed report and link to
owned recovery. No automatic reassessment follows an uncertain/lost response.

## Integration APIs and lifecycle

`createApp` accepts `localAuth: ReturnType<typeof createLocalAuth>` and optional
`runtime: { identity: "anonymous" | "trusted" | "local-operator", storage:
"ephemeral" | "sqlite", runner: "local" | "subscription" | "azure" |
"unspecified" }`. Trusted `actorForRequest` strings and object resolvers remain
compatible; objects may additionally expose synchronous `assertCurrent()`.
Actual local identities always have a finite `validUntil` and the assertion.

`createResourceApp` and `createOperationalApp` forward those O dependencies.
The H adapter forwards typed O resource/storage availability errors to O's HTTP
boundary instead of converting them to a provider error. Model/provider error
policy, shared DTOs, photo execution authority and dispatch gates are unchanged.
The store's presentation schema accepts the precise optional runtime/review/history
metadata; evaluation stages runtime metadata using `stagePresentation` in the
active lease. Review labels at render time always come from the saved snapshot.

Application factories expose `settled()` for actual pending work, including work
that has already lost a response timeout/cancellation race. The assessment adapter
tracks the underlying resource/runner promise until it settles; a completed HTTP
race alone is insufficient to drain it. The composed factories retain
`dispose()` cancellation semantics and add awaited `close()` for owned resources.
The launcher stops accepting, cancels work, waits for HTTP handlers and pending
application work, then closes leases/SQLite. Its existing one-second forced exit
bound remains; it does not close SQLite under still-running work at that bound.
A successfully published lease has a no-op rollback so `finally` cannot issue a
new failing database write after the commit marker.
Abort listeners contain typed storage/contention failures after synchronously
invalidating the local lease. They do not retry SQL or release another token's
reservation: an undeleted reservation remains bounded by the existing 65-second
lease expiry and the normal recovery sweep.

Private photos remain single-process and storage-only under `<state>/photos`.
There is no model-photo mapping or transmission enablement. Local HTTP withdrawal
durably denies/queues before returning success; physical deletion is separately
pending. With photo storage enabled only, startup and 30-second non-overlapping
passes independently run the existing physical photo-expiry sweep, including
expired files from renewed cases and files never successfully associated with a
case. The same serialized worker then sweeps case expiry and processes at most
100 owners × 10 obligations per pass, including expired cases. It advances
process-local keyset cursors between passes and wraps after the end, so persistent
failures do not permanently exclude later owners/items. Restart resets only the
scan position; every durable obligation remains. `pendingCleanup(owner, limit,
after?)` accepts an optional `{ queuedAt, caseId, photoRef }` cursor, validates it,
and always applies the supplied owner restriction. Existing two-argument calls
retain their original behavior. A queue entry is removed only after `revoke` confirms
physical deletion. Failures retain the obligation; shutdown cancels/drains the
worker before closing SQLite. Legacy trusted photo integrations retain their
existing immediate deletion/retry behavior.

Bun password operations retain native Argon2id and crypto limits. A typed
`node:module` runtime boundary loads only that API; the Node compiler avoids
Bun's global `fetch.preconnect` overload conflicting with the installed SDK.
The existing Node/Bun test split includes the Bun auth tests, all new runtime
tests, helpers, account CLI and `qa-o4.ts`, with no suppressed library checks.

## Timed demonstration and remaining acceptance

- **Normal, 3 minutes:** login/recover (0:00–0:30), show `/demo/normal` explicitly
  as synthetic (0:30–1:00), compare costs/conditions/unavailable values and human
  approval (1:00–2:00), inspect original versus derived source hashes and print
  (2:00–3:00). Until a real reviewed package exists, this is synthetic calculation
  evidence and cannot establish field acceptance.
- **Held, 2 minutes:** create incomplete native input (0:00–0:30), correct an
  existing field on the same versioned case (0:30–1:00), inspect remaining
  questions/currentness hold and export (1:00–1:30), restart and recover through
  `/cases` (1:30–2:00). Current legal coverage remains an external J dependency.

`RESOURCE_MODEL_RUNNER=local bun run demo:o` generates normal/held/review HTML,
then drives a real temporary SQLite/native correction/restart handler flow with
an ephemeral demonstration account. The state is removed afterwards. Generated
HTML is neither actual network/browser QA nor a recording. O owns this change's
full-suite/smoke and actual HTTP/browser checks, including light/dark desktop
and mobile comparisons. The lead owns integrated acceptance and final videos.
Local QA uses synthetic accounts, pixels and artifacts with the local runner;
it cannot establish field approval, live execution or billing evidence.

No production artifact exists. Exact reviewed quotations, independent mass
review, permits/acceptance, approved factors, current legal coverage and
original-to-derived provenance still need a real supplier. Declared `field`
origin is not approval. Existing evidence binding cannot express several
originals jointly supporting one derived fact; J/H/O must explicitly resolve
that boundary. H retains real provider execution and durable audit/billing;
execution trace is not provider request ID, reported usage is not billing, and
missing usage is unavailable while a supplied string `0` remains zero.
