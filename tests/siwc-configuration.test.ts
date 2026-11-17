import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configuration } from "./o-operations-fixtures.ts";
import { parseOperationalConfiguration, parseHOperationalConfiguration } from "../src/o-operations-config.ts";
import { openOperationJournal } from "../src/o-operation-journal.ts";
import { SIWC_ENDPOINT, SUBSCRIPTION_ENDPOINT } from "../src/subscription-configuration.ts";

test("O and H configuration require an explicit SiWC route paired with its finite endpoint", () => {
  const base = configuration(), target = { ...base.target, route: "siwc", endpoint: SIWC_ENDPOINT, credentialSlot: "approved" };
  const { journalCapacity: _capacity, ...h } = base;
  const hBase = { ...h, budget: { mode: "request-quota", policyReference: "approved", budgetReference: "bounded" } };
  for (const parse of [parseOperationalConfiguration, parseHOperationalConfiguration]) {
    const config = parse === parseOperationalConfiguration ? base : hBase;
    assert.equal(parse({ ...config, target }).target.endpoint, SIWC_ENDPOINT);
    for (const mismatch of [{ ...target, route: undefined }, { ...target, route: "codex" }, { ...target, endpoint: SUBSCRIPTION_ENDPOINT },
      { ...target, endpoint: SIWC_ENDPOINT + "?other=1" }, { ...target, endpoint: "https://example.invalid/responses" }]) {
      assert.throws(() => parse({ ...config, target: mismatch }));
    }
  }
});

test("SiWC journal persists and recovers finite-route policy and dispatch evidence without accepting legacy dispatch", async () => {
  const root = await mkdtemp(join(tmpdir(), "siwc-journal-"));
  const base = configuration();
  const config = parseOperationalConfiguration({ ...base, target: { ...base.target, route: "siwc", endpoint: SIWC_ENDPOINT, credentialSlot: "approved" } });
  const binding = { leaseToken: "synthetic", actorId: "operator", caseId: "case", inputRevision: "a".repeat(64), artifact: null };
  const options = { stateRoot: root, configuration: config, currentOperation: () => binding };
  const journal = await openOperationJournal(options);
  try {
    await journal.record({ phase: "start", runId: "synthetic", caseRevision: binding.inputRevision, at: new Date().toISOString(), elapsedMs: 0, requests: [], images: [], usage: null });
    const request = { runId: "synthetic", caseRevision: binding.inputRevision, endpoint: SIWC_ENDPOINT, deployment: "", modelId: "gpt-6-sol",
      attempt: 1, maxOutputTokens: 128, provider: "chatgpt-subscription" as const, outputLimitEnforced: false };
    await assert.rejects(journal.authorizeDispatch({ ...request, endpoint: SUBSCRIPTION_ENDPOINT }, new AbortController().signal));
    assert.ok(await journal.authorizeDispatch(request, new AbortController().signal));
    assert.equal(journal.inspectPending()[0]?.state, "reserved");
  } finally { await journal.close(); }
  try {
    const recovered = await openOperationJournal(options);
    try { assert.deepEqual(recovered.inspectPending(), []); }
    finally { await recovered.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
