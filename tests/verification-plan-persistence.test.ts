import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAssessmentAdapter } from "../src/session.ts";
import { createResourceDomain } from "../src/domain.ts";
import { createCaseStore } from "../src/o-case-store.ts";
import { openRuntimeDatabase, RuntimeStorageError } from "../src/o-runtime-db.ts";
import { createVerificationCandidates, presentAssessmentDecision } from "../src/o-verification-plan-candidates.ts";
import { revision } from "../src/o-validation.ts";
import { syntheticCase } from "./h-fixtures.ts";

const input = { ...syntheticCase, caseId: "verification-storage", polymer: null };
const owner = "actor:verification-owner";
async function assessment(reject = false) {
  const adapter = createAssessmentAdapter({ runner: async facts => {
    const proposal = await createResourceDomain(facts).decide();
    const candidates = createVerificationCandidates(revision(facts), presentAssessmentDecision(proposal));
    return { proposal, verificationPlan: { selectedIds: reject ? ["unknown-private-id"] : candidates.items.map(item => item.id).slice(0, 3) } };
  } });
  try { return await adapter.evaluate(input, new AbortController().signal); }
  finally { adapter.dispose(); }
}

for (const mode of ["selected", "rejected", "legacy"] as const) {
  test(`SQLite reload preserves ${mode} private envelope and input/final-decision binding`, async () => {
    const root = await mkdtemp(join(tmpdir(), "verification-storage-"));
    let db = await openRuntimeDatabase(root);
    let store = createCaseStore(() => 1000, undefined, db);
    try {
      const full = await assessment(mode === "rejected");
      const envelope = mode === "legacy" ? { decision: full.decision } : full;
      const lease = store.begin(owner, input.caseId, null);
      await store.run(lease, input, async () => undefined);
      store.commit(lease, envelope, () => undefined);
      store.dispose(); db.close();
      db = await openRuntimeDatabase(root);
      store = createCaseStore(() => 1000, undefined, db);
      const restored = store.read(owner, input.caseId);
      assert.deepEqual(restored?.assessment, envelope);
      assert.equal(restored?.assessment.verificationPlan?.decisionRevision, mode === "legacy" ? undefined : revision(envelope.decision));
      assert.equal(restored?.evaluated.revision, revision(input));
      assert.equal(store.read("actor:another-owner", input.caseId), undefined);
    } finally { store.dispose(); db.close(); await rm(root, { recursive: true, force: true }); }
  });
}

test("stale verification plan fails a new input commit without overwriting the saved assessment", async () => {
  const store = createCaseStore(() => 1000), result = await assessment();
  // Remove the audit to exercise the plan's own input binding, not its neighboring guard.
  const envelope = { decision: result.decision, verificationPlan: result.verificationPlan };
  try {
    const first = store.begin(owner, input.caseId, null);
    await store.run(first, input, async () => undefined);
    store.commit(first, envelope, () => undefined);
    const next = store.begin(owner, input.caseId, 1);
    await store.run(next, { ...input, massKg: 1 }, async () => undefined);
    assert.throws(() => store.commit(next, envelope, () => undefined), /verification-plan-input-mismatch/);
    store.rollback(next);
    assert.equal(store.read(owner, input.caseId)?.version, 1);
    assert.deepEqual(store.read(owner, input.caseId)?.assessment, envelope);
  } finally { store.dispose(); }
});

for (const field of ["inputRevision", "decisionRevision", "selected[0].text"] as const) {
  test(`SQLite startup rejects tampered verification plan ${field}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "verification-tamper-"));
    const db = await openRuntimeDatabase(root), store = createCaseStore(() => 1000, undefined, db);
    try {
      const result = await assessment(), lease = store.begin(owner, input.caseId, null);
      await store.run(lease, input, async () => undefined);
      store.commit(lease, result, () => undefined);
      store.dispose();
      db.database.query("UPDATE cases SET snapshot=json_set(snapshot,?,?) WHERE case_id=?")
        .run(`$.assessment.verificationPlan.${field}`, field.endsWith("text") ? "invented finding" : "0".repeat(64), input.caseId);
      assert.throws(() => createCaseStore(() => 1000, undefined, db), RuntimeStorageError);
    } finally { store.dispose(); db.close(); await rm(root, { recursive: true, force: true }); }
  });
}
