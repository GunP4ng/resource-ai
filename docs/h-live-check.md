# H issue48 local subscription check

With Bun 1.4.2 and the pinned SDK installed, run from the repository root:

```sh
bun run live-check
```

This dispatches real inference through the existing subscription SDK runner and
`createOperationalApp`, as used by `startApp`. Defaults are
`RESOURCE_MODEL_RUNNER=subscription`, provider `chatgpt-subscription`, model
`gpt-6-sol`. Other runner/model settings are rejected. The SDK's existing auth
store is used; `RESOURCE_AUTH_PATH` can select an operator-owned store. The
command never logs in or out of the provider account. Login/logout in this check
belongs solely to a newly created, in-memory application account and session.
No real application state, photos, or field inputs are opened.

The three sequential checks are:

1. Submit synthetic PP text with server-owned reviewed synthetic resources.
   Compare the committed decision with fresh host-domain execution, require
   available cost/carbon scenarios and processor candidates, keep human approval
   pending, and compare the printable app report with host rendering.
2. Submit the same synthetic text with mass omitted. Require the host's
   needs-information decision, questions, and matching printable report.
3. Revoke the temporary app session via `/logout`, then reuse its revoked cookie
   for a case revision. Require 403, zero model dispatches, and an unchanged
   previously committed case. If neither earlier submission saved a case, this
   preservation check remains unverified and fails.

Synthetic fixtures reuse the existing H reviewed-resource pattern and O synthetic
documents/calculations. Their assessment date is deliberately fixed to
2026-11-05 to keep the synthetic evidence within its authored validity period.
This is regression evidence for a historical synthetic case, not proof of
current law, field suitability, treatment authorization, or current-date review.
Resource review, human approval, app identity, case revision, and deadline gates
run unchanged. The model must use actual tools/decision references; no canned
model decisions or fallback success are supplied.

One exclusively created `artifacts/live-check/<random UUID>/result.json` records
HEAD SHA, date, provider/model, per-case pass/failure category, decision state,
HTTP status, validated request IDs, safe provider trace, token counters, duration,
dispatch count, report equality and preservation checks. It is fsynced and made
read-only (0400); reruns create new directories. SHA describes HEAD; review the
working patch separately for uncommitted changes. The report contains no prompts,
raw decisions, provider errors, credential paths, headers, tokens, or accounts.
Missing/invalid IDs and usage stay null/unverified and cause a nonzero exit.
Senpi session IDs and response IDs never become provider request IDs. Logout
requires no inference; its ID/usage fields intentionally remain null.

`--out <directory>` changes the output root; `--timeout-ms <100..60000>` changes
the per-request application deadline (default 60000). There are at most three
SDK turns per inference case and six dispatched requests total, with SDK retries
disabled. The requested output allowance is 1500 tokens per turn. Subscription
SSE does not enforce that token cap: this is not a monetary ceiling. Actual
response streams are additionally limited to 512 KiB per request. Deadline,
invalid output, provider rejection, missing telemetry, and incomplete checks are
recorded as failures without retry. Exit 0 requires every required result;
otherwise exit 1. Setup failures after output creation also persist all three
uncompleted cases. Filesystem failure can prevent persistence and returns a fixed
safe stderr message. stdout prints fixed result scalars only; find files beneath
the selected output root. No supplied path is echoed.

This command is local-only; CI is unchanged. Tests use temporary owned SDK auth
fixtures and wire responses through the real SDK/app/report boundary:

```sh
bun test --timeout 30000 ./tests/live-check.test.ts ./tests/live-check-command.test.ts
```

Offline tests substitute the existing fetch boundary in an owned process; the
production API has no test transport option or alternate fake workflow.
Subprocess preloads exercise the unchanged executable entry point for both
successful completion and provider rejection. Their wire substitution is labeled
separately as `live=false` in QA evidence. The production command cannot detect
external monkey-patching; its `live` flag describes its configured transport,
not independent attestation.
An offline passing report is never evidence of a successful live subscription run.

The owner still needs to run real checks after H/O flow PR merges, daily through
the 11/20 feature freeze, and on 11/24 before the 11/25 presentation. Keep those
results in the issue or repository results folder; passing live results can
support #13. On failure the owner should open an issue, assign the responsible PR
owner and attach the sanitized result. This implementation creates no jobs,
issues, comments, commits, PRs, or live evidence. Merge, live execution, scheduled
evidence accumulation, and completion of issue48 remain unverified.
