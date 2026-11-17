# PR27 H/O photo execution scope

This is the implemented proposed technical H/O contract for the PR27 consent correction.
It enforces the reviewer's required boundaries; it does not claim that a
human H owner has approved production provider/purpose values. The owner must
supply those values before enabling real model photos. Missing or ambiguous
mapping keeps model photos disabled. Text execution and private storage remain
available independently. H issue #8 is closed; this work stays under #12.

## One execution authority

**2026-11-12 correction:** PR #28 (`2ee1cb2`) added a subscription target next to the Azure target described below. `SubscriptionTarget` (`src/photo-execution.ts`) binds `chatgpt-subscription`, the selected finite endpoint, model ID and account hash. Subscription photo execution is therefore implemented but opt-in: the default `bun run app` launcher never publishes an authority, so photos are not sent to any model unless a server integrator publishes approved mappings. No live account or field photo run has been accepted.

H owns an in-process execution authority containing a checked Azure
configuration and explicit target-to-scope mappings. O consumes its issued
photo ticket rather than maintaining an independent `guardedModel` label.

- A target consists of endpoint, deployment, SDK model ID and API version.
- A scope consists of exact, nonblank provider and purpose values. Neither
  value is inferred from Azure, a model name, a deployment name or browser data.
- Exactly one mapping must match the checked target. Missing, invalid or
  ambiguous mappings issue no photo ticket.
- Configuration and mapping changes are published atomically. Tickets contain
  a generation, binding ID, target and scope; credentials remain private.
- The authority verifies issuance and generation synchronously. A supplied
  object with matching fields is not an issued ticket.
- A target/provider/purpose change creates a new consent binding and
  invalidates outstanding tickets, including an A-to-B-to-A sequence.
  Credential rotation alone need not require fresh user consent.

For a photo assessment, the pinned ticket is the runner's sole configuration
source. It must not select another configuration through a mutable callback.
The existing configuration callback remains available for text-only runs.

## Server integration API

`src/photo-execution.ts` exports `createPhotoExecutionAuthority`,
`PhotoExecutionAuthority`, `PhotoExecutionTicket`, `AzureTarget`, `ModelScope`,
`ScopeMapping` and `matchesPhotoConsent`. The factory starts without a ticket.
H calls `publish(configuration, mappings)` with the server secret configuration
and owner-approved exact `ScopeMapping[]`; no production values are inferred or
provided in this repository. `publish(null)` disables photos. Invalid checked
configuration throws without publishing either half of a new snapshot; valid
configuration with absent/invalid/ambiguous mapping publishes no ticket.
Every successful publication advances generation. Credential-only publication
retains the binding but invalidates the old ticket. Bindings are process-local;
restarting this authority requires fresh consent.

The composition uses the same instance everywhere:

```ts
const photoExecution = createPhotoExecutionAuthority();
photoExecution.publish(serverAzureConfiguration, ownerApprovedMappings);
const cases = createCaseStore(Date.now, photoExecution);
const photos = await createPhotoStore({
  root: absolutePrivatePath, retentionMs, maxPhotos,
  authorize: cases.authorize, photoExecution,
});
const app = createOperationalApp({
  origin, caseStore: cases, photoStore: photos,
  actorForRequest: trustedServerIdentityResolver,
  photoPolicy: { retentionMs },
  operations: { ...requestGatedOperations, photoExecution },
});
```

`AzureConfiguration` and `checkedConfiguration` live in
`src/azure-configuration.ts`; `operations.ts` retains its public configuration
type export. This avoids an app/session/authority runtime cycle and shares H's
existing validator. `photoPolicy.guardedModel` is accepted for source
compatibility but has no authority. Operational composition exposes model
offers only with enabled operations and an issued ticket. Default local and
subscription launchers remain text-only.

`createCaseStore(now?, photoExecution?)` accepts tickets in
`eligible(snapshot, input, ticket)` and `run(lease, input, work, ticket)`.
`currentPhotoTicket()` exposes only the live request's pinned ticket, for
resource callbacks needing `photos.resolver(actor, cases.currentPhotoTicket())`.
Call this only for inputs containing photos. Metadata never enters `CaseInput`.
Direct photo APIs are `resolver(actor, ticket)` and
`assertCanTransmit(actor, input, signal, expectedHashes?, ticket)`; optional
ticket parameters preserve source compatibility but omission denies access.
`put` requires scope and binding for new model grants; its reader still accepts
legacy missing fields for storage preview. Do not migrate them automatically.

`OperationalRunnerOptions.photoExecution` supplies the sole photo
configuration source. The integrated app sets `photoTicket()` to the lease
accessor; a direct guarded runner pins `authority.current()` at entry. Resolver
and transmission callbacks receive that ticket as their final argument.
Text-only runs still call the existing `configuration(signal)` callback.

## O presentation and consent

O reads one current ticket when rendering the case page, shows its scope, and
uses the same binding for selection eligibility. The native upload form echoes
`modelBindingId`; that echo is untrusted and must match a current issued ticket.
Only the server ticket supplies the recorded scope and binding ID.

Stored consent contains both `modelScope` and `modelBindingId`. Existing records
missing either remain previewable but cannot be used for model transmission.
Changed scope or binding requires a fresh upload and consent. There is no
automatic migration or regrant.

Uploads that grant model consent recheck the ticket before publishing the
receipt. A stale offer or a change during storage cannot silently substitute a
new provider/purpose. Storage-only uploads do not require a photo ticket.

## H evaluation, photo storage and dispatch

The case lease pins the issued ticket before resources or evaluation run.
Scope metadata stays outside `CaseInput` and its input revision hash.

One consent-match predicate is shared by UI selection, case-store eligibility
and photo-store authorization. The photo store independently requires the same
authority and issued ticket for model resolution and transmission assertions.
It rechecks after asynchronous reads, alongside owner, case revision, expiry,
content review, revocation and byte-integrity checks.

H checks the actual serialized Responses target and deployment against the
ticket, including the configured API version as used by the installed SDK.
The installed adapter emits `/openai/v1/responses?api-version=...` and request
body `model` equal to the deployment, while SDK model ID is bound by runner
construction. An injected real-SDK SSE regression confirms this serialization;
unexpected path, query, method or deployment fails closed. No live Azure call
is part of that check.
After dispatch approval, audit and asynchronous photo checks, H performs a
synchronous current-ticket assertion immediately before invoking transport.
There is no intervening `await`. Every dispatch and the final assessment
commit repeats that assertion.

Already-invoked transmission cannot be recalled. A subsequent authority
change blocks later dispatches and stale assessment publication; it does not
claim to reverse provider processing or billing.

## Required regressions

- Matching target, provider, purpose and binding: UI, direct photo access and
  guarded injected dispatch agree.
- Provider-only, purpose-only, missing scope/binding or ambiguous mapping:
  model selection and transmission are denied; private preview still works.
- Changes after rendering, during upload/resources, during dispatch approval,
  during audit or the last asynchronous photo check: stale association,
  dispatch and commit are refused.
- Same-label different-target changes, A-to-B-to-A changes, forged tickets,
  different authority instances and same-origin wrong deployments fail closed.
- Tests use synthetic images and injected transport only. No production mapping
  or live execution is invented.

## Explicit subscription routes

`SubscriptionConfiguration.route` defaults to `codex`, preserving the legacy
endpoint and account-header gate. Explicit `siwc` selects only
`https://api.openai.com/v1/responses`. The issued photo target contains that
endpoint, model and approved account hash; route changes invalidate the old
ticket and consent binding. O/H operational configuration must pair
`target.route="siwc"` with that exact `target.endpoint` and matching photo scope
mapping. Arbitrary endpoints and mismatched route/endpoint pairs are rejected.

SiWC selects a flat credential or an explicitly named `credentialSlot` in a
managed OAuth store, without following or changing pin/order. The selected
credential must have `route="siwc"`, `planUsageEnabled=true`, the
`chatgpt.tokens.use.direct` scope and sufficient remaining expiry. Canonical
SiWC credentials require the selected slot's SDK-verified `subject`, fixed
`issuer="https://auth.openai.com"` and nonempty issued `clientId`.
`dynamic_agent_client` is the registration entrypoint and is rejected here.
`accountIdSha256` is SHA-256 of `JSON.stringify([issuer, subject, clientId])`
using those exact selected strings. Subject/email alone do not identify a
workspace; a different issued registration changes the approved connection
and invalidates the old photo binding. Slot projection preserves all three
selected identity fields without inheriting pool-envelope metadata.
JWT or opaque access tokens need no legacy account claim. Missing canonical
metadata is rejected on SiWC; legacy Codex retains its account-ID/header
contract. This app does not revalidate ID-token signatures or perform login.
The emitted Bearer must equal the selected credential. No refresh, rotation
or store mutation is performed.

The pinned subscription catalog supplies the configured model object; the SiWC
route explicitly adapts it to `provider=openai`, `api=openai-responses` and the
public Responses base URL. The operator must select a model available to the
approved account. The real SDK serializes text/images and consumes SSE. Before
dispatch the host verifies method, exact endpoint, model, `store=false`,
`stream=true`, output allowance and image SHA, retaining approval/audit/photo
checks and the final current-ticket assertion. Failed/incomplete/interrupted
SSE and streams over 512 KiB cannot commit an assessment. Usage stays unknown
on failure. Subscription policy still conservatively requires its existing
uncapped-usage acknowledgement and request quota acknowledgement.

For the direct text launcher only, set `RESOURCE_SUBSCRIPTION_ROUTE=siwc`,
`RESOURCE_AUTH_PATH`, `RESOURCE_ACCOUNT_ID_SHA256`, and optionally
`RESOURCE_CREDENTIAL_SLOT`. Operational mode instead takes route/account/slot
from its explicit private configuration. Azure and default subscription model
selection are unchanged. Synthetic photos remain functional observations, not
chemistry, hazardous classification or accuracy evidence.
