import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCaseStore, parseAssessment } from "../src/o-case-store.ts";
import { openRuntimeDatabase, RuntimeStorageError } from "../src/o-runtime-db.ts";
import { createAssessmentAdapter } from "../src/session.ts";
import { createResourceDomain } from "../src/domain.ts";
import { syntheticCase } from "./h-fixtures.ts";
import { revision } from "../src/o-validation.ts";

const input = { ...syntheticCase, caseId: "audit-persistence" }, owner = "actor:audit-owner";
const signal = () => new AbortController().signal;
async function assessment(reject = false) {
  const adapter = createAssessmentAdapter({ runner: async facts => ({ proposal: reject ? {} : await createResourceDomain(facts).decide() }) });
  try { return await adapter.evaluate(input, signal()); }
  finally { adapter.dispose(); }
}

for (const mode of ["passed", "rejected", "legacy"] as const) {
  test(`SQLite reload retains ${mode} assessment with existing ownership and lifetime`, async () => {
    const root = await mkdtemp(join(tmpdir(), "model-host-storage-"));
    let db = await openRuntimeDatabase(root), now = 1000;
    let store = createCaseStore(() => now, undefined, db);
    try {
      const full = await assessment(mode === "rejected");
      const envelope = mode === "legacy" ? { decision: full.decision } : full;
      const lease = store.begin(owner, input.caseId, null);
      await store.run(lease, input, async () => undefined);
      store.commit(lease, envelope, () => undefined);
      store.dispose(); db.close();
      db = await openRuntimeDatabase(root);
      store = createCaseStore(() => now, undefined, db);
      const restored = store.read(owner, input.caseId);
      assert.deepEqual(restored?.assessment, envelope);
      assert.equal(restored?.evaluated.revision, revision(input));
      assert.equal(restored?.expires, 3601000);
      assert.equal(store.read("actor:someone-else", input.caseId), undefined);
      now = 3601000;
      assert.equal(store.read(owner, input.caseId), undefined);
    } finally { store.dispose(); db.close(); await rm(root, { recursive: true, force: true }); }
  });
}

test("audit revision mismatch rejects a commit and preserves the previous case", async () => {
  const store = createCaseStore(), result = await assessment();
  try {
    const first = store.begin(owner, input.caseId, null);
    await store.run(first, input, async () => undefined);
    store.commit(first, result, () => undefined);
    const lease = store.begin(owner, input.caseId, 1);
    await store.run(lease, { ...input, massKg: 1 }, async () => undefined);
    assert.throws(() => store.commit(lease, result, () => undefined), /model-audit-input-mismatch/);
    store.rollback(lease);
    assert.equal(store.read(owner, input.caseId)?.version, 1);
    assert.deepEqual(store.read(owner, input.caseId)?.assessment, result);
  } finally { store.dispose(); }
});

test("parseAssessment rejects overbounds, wrong stages, added prose and forged host selections", async () => {
  const result = await assessment(), audit = result.modelAudit;
  assert.ok(audit);
  const variants = [
    { ...audit, caseId: "different" },
    { ...audit, inputRevision: "not-a-digest" },
    { ...audit, decisionRevision: "0".repeat(64) },
    { ...audit, rawModelText: "secret" },
    { ...audit, stages: audit.stages.slice(1) },
    { ...audit, stages: audit.stages.map((stage, index) => index ? stage : { ...stage, stage: 2 }) },
    { ...audit, validation: { ...audit.validation, reasons: ["x".repeat(513)] } },
    { ...audit, validation: { ...audit.validation, passedChecks: [], status: "validation-passed" } },
    { ...audit, stages: audit.stages.map((stage, index) => index !== 5 ? stage : { ...stage, hostSelected: { items: [], totalItems: 0 } }) },
    { ...audit, stages: audit.stages.map((stage, index) => index !== 5 ? stage : { ...stage,
      proposed: { items: Array.from({ length: 17 }, () => stage.proposed.items[0]), totalItems: 17 } }) },
  ];
  for (const modelAudit of variants) assert.throws(() => parseAssessment({ ...result, modelAudit }));
  assert.deepEqual(parseAssessment({ decision: result.decision }), { decision: result.decision });
  assert.deepEqual(parseAssessment(result.decision), { decision: result.decision });
});

test("SQLite startup validates audit binding instead of trusting retained JSON", async () => {
  const root = await mkdtemp(join(tmpdir(), "model-host-tamper-"));
  const db = await openRuntimeDatabase(root), store = createCaseStore(() => 1000, undefined, db);
  try {
    const result = await assessment(), lease = store.begin(owner, input.caseId, null);
    await store.run(lease, input, async () => undefined);
    store.commit(lease, result, () => undefined);
    store.dispose();
    db.database.query("UPDATE cases SET snapshot=json_set(snapshot,'$.assessment.modelAudit.inputRevision',?) WHERE case_id=?")
      .run("0".repeat(64), input.caseId);
    assert.throws(() => createCaseStore(() => 1000, undefined, db), RuntimeStorageError);
  } finally { store.dispose(); db.close(); await rm(root, { recursive: true, force: true }); }
});
