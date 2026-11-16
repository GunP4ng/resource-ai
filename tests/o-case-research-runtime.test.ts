import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm, cp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Value } from "typebox/value";
import type { Type } from "typebox";
import { createCaseStore, CASE_LEASE_MS } from "../src/o-case-store.ts";
import { openRuntimeDatabase, RuntimeStorageError } from "../src/o-runtime-db.ts";
import { readCaseResearchCatalog, prepareResearchCaseRecord } from "../src/o-case-research.ts";
import { ResearchCaseArtifactSchema } from "../src/o-case-artifact.ts";
import type { ResearchCaseArtifact } from "../src/o-case-artifact.ts";
import { validateStoredArtifact } from "../src/o-case-record-validation.ts";
import { artifactCodeRevision } from "../src/o-artifact-target.ts";
import { validateResourceArtifact, createFileResourceProvider } from "../src/o-resources.ts";
import { createAssessmentAdapter } from "../src/session.ts";
import { revision } from "../src/o-validation.ts";
import type { PhotoReceipt } from "../src/photos.ts";
import { createLocalAuth } from "../src/o-auth.ts";

const root = fileURLToPath(new URL("../", import.meta.url)), actorId = "research-owner", owner = "actor:" + actorId;
const catalog = await readCaseResearchCatalog(), source = catalog.calculations.data.cases[0];
assert.ok(source);
const input = { ...source.original, caseId: "research-runtime" }, inputRevision = revision(input);
const decision = { state: "needs-information", caseId: input.caseId, questions: ["review"], evidence: [] } as const;
const signal = () => new AbortController().signal;
const codeRevision = artifactCodeRevision();
type RawArtifact = Type.Static<typeof ResearchCaseArtifactSchema>;
async function fixture(t: { after(fn: () => unknown): void }) {
  const directory = await mkdtemp(join(tmpdir(), "o-research-runtime-")), state = join(directory, "state");
  const db = await openRuntimeDatabase(state);
  let at = 1000;
  const store = createCaseStore(() => at, undefined, db);
  const artifact = await prepareResearchCaseRecord({ actorId, input, inputRevision, codeRevision, signal: signal() }, "OYS-20261110-001", catalog);
  const publish = async (value: ResearchCaseArtifact | null, base: number | null = null) => {
    const lease = store.begin(owner, input.caseId, base);
    await store.run(lease, input, async () => store.stageResources(value));
    store.commit(lease, { decision }, () => {});
  };
  t.after(async () => { store.dispose(); db.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, state, db, store, artifact, publish, time(value: number) { at = value; } };
}

test("v2 provider stages the full package while actual runner resources stay empty", async t => {
  const f = await fixture(t), resources = join(f.directory, "resources");
  await mkdir(join(resources, actorId, input.caseId), { recursive: true, mode: 0o700 });
  await writeFile(join(resources, actorId, input.caseId, inputRevision + ".json"), JSON.stringify(f.artifact), { mode: 0o600 });
  const provider = await createFileResourceProvider({ root: resources, caseStore: f.store });
  const adapter = createAssessmentAdapter({ resources: provider, runner: async (actual, _signal, facts) => {
    assert.deepEqual(actual, input); assert.deepEqual(facts, {});
    assert.equal(JSON.stringify({ actual, facts }).includes("research-display"), false);
    return {};
  } });
  const lease = f.store.begin(owner, input.caseId, null);
  try {
    const result = await f.store.run(lease, input, active => adapter.evaluate(input, active));
    f.store.commit(lease, result, () => {});
    assert.deepEqual(f.store.readReport(owner, input.caseId)?.research, { artifactSha256: f.artifact.sha256, attachment: f.artifact.record.research });
  } finally { adapter.dispose(); await adapter.settled(); f.store.rollback(lease); }
});

const corruptions: readonly [string, (a: RawArtifact) => void][] = [
  ["actor", a => { a.record.research.binding.actorId = "forged"; }],
  ["case", a => { a.record.research.binding.caseId = "forged"; }],
  ["revision", a => { a.record.research.binding.inputRevision = "0".repeat(64); }],
  ["source", a => { a.record.research.calculations.originalSha256 = "0".repeat(64); }],
  ["rights", a => { const s = a.record.research.calculations.sources.find(s => s.source_id === "WARM"); assert.ok(s); s.commercial_use = "allowed_with_conditions"; }],
  ["lineage", a => { a.record.research.processors.source.derivedFrom = "0".repeat(64); }],
];
for (const [name, mutate] of corruptions) test("ingestion rejects resealed " + name, async t => {
  const f = await fixture(t), changed = Value.Parse(ResearchCaseArtifactSchema, f.artifact);
  mutate(changed); changed.sha256 = revision(changed.record);
  await assert.rejects(validateResourceArtifact(changed, input, { actorId }, signal()));
});
test("v2 cannot use its declared actor as caller authority", async t => {
  const f = await fixture(t);
  await assert.rejects(validateResourceArtifact(f.artifact, input));
  await assert.rejects(validateResourceArtifact(f.artifact, input, { actorId: "another" }));
  assert.deepEqual((await validateResourceArtifact(f.artifact, input, { actorId })).resources, {});
});
test("staging independently binds the live lease owner", async t => {
  const f = await fixture(t), lease = f.store.begin("actor:other", input.caseId, null);
  await assert.rejects(f.store.run(lease, input, async () => f.store.stageResources(f.artifact)), /review-owner/);
  f.store.rollback(lease);
});
test("stored cached domain assessment stays opaque and returned reports are detached", async t => {
  const f = await fixture(t), value = { ...structuredClone(f.artifact) };
  Reflect.set(value.record, "assessment", { historical: "opaque" }); value.sha256 = revision(value.record);
  assert.doesNotThrow(() => validateStoredArtifact(value));
  await assert.rejects(validateResourceArtifact(value, input, { actorId }));
  await f.publish(value);
  const report = f.store.readReport(owner, input.caseId); assert.ok(report?.research);
  Reflect.set(report.research.attachment.binding, "actorId", "edited");
  Reflect.set(report.snapshot.input, "massKg", 999);
  assert.equal(f.store.readReport(owner, input.caseId)?.research?.attachment.binding.actorId, actorId);
  assert.equal(f.store.read(owner, input.caseId)?.input.massKg, 24);
  assert.equal(f.store.readReport("actor:other", input.caseId), undefined);
});
test("null-staged reevaluation removes a previously committed attachment", async t => {
  const f = await fixture(t); await f.publish(f.artifact);
  await f.publish(null, 1);
  assert.equal(f.store.readReport(owner, input.caseId)?.research, null);
});
test("real account disable revokes publication of a staged v2 package", async t => {
  const f = await fixture(t), auth = createLocalAuth(f.db, { origin: "http://localhost:3000" });
  const password = "synthetic runtime test password";
  const account = await auth.create("operator", password), owned = "actor:" + account.actorId;
  const login = await auth.login("operator", password, signal());
  const artifact = await prepareResearchCaseRecord({ actorId: account.actorId, input, inputRevision, codeRevision, signal: signal() }, "OYS-20261110-001", catalog);
  const first = f.store.begin(owned, input.caseId, null);
  await f.store.run(first, input, async () => f.store.stageResources(artifact));
  f.store.commit(first, { decision }, login.identity.assertCurrent);
  const before = f.store.readReport(owned, input.caseId), lease = f.store.begin(owned, input.caseId, 1);
  await f.store.run(lease, input, async () => f.store.stageResources(artifact));
  auth.disable("operator");
  assert.throws(() => f.store.commit(lease, { decision }, login.identity.assertCurrent));
  assert.deepEqual(f.store.readReport(owned, input.caseId), before); f.store.rollback(lease);
});

for (const failure of ["final-guard", "disable", "cancel", "stale", "withdrawal", "sql-abort", "sql-ignore"] as const) test("v2 publication rolls back on " + failure, async t => {
  const f = await fixture(t); await f.publish(f.artifact);
  const replacement = { ...f.artifact, record: { ...f.artifact.record, recordedAt: "2026-11-16T00:00:00.000Z" } };
  const next = { ...replacement, sha256: revision(replacement.record) };
  const lease = f.store.begin(owner, input.caseId, 1);
  await f.store.run(lease, input, async () => f.store.stageResources(next));
  let guardCalls = 0;
  if (failure === "cancel") lease.controller.abort();
  if (failure === "stale") f.time(1000 + CASE_LEASE_MS);
  if (failure === "withdrawal") f.store.withdraw(owner, input.caseId, "11111111-1111-4111-8111-111111111111", false);
  if (failure.startsWith("sql-")) f.db.database.exec("CREATE TEMP TRIGGER research_failure BEFORE UPDATE ON cases BEGIN SELECT RAISE(" + (failure === "sql-abort" ? "ABORT,'private'" : "IGNORE") + "); END");
  const before = f.store.readReport(owner, input.caseId);
  assert.throws(() => f.store.commit(lease, { decision }, () => {
    if (failure === "disable" || (failure === "final-guard" && ++guardCalls === 2)) throw new Error("revoked");
  }));
  if (failure.startsWith("sql-")) f.db.database.exec("DROP TRIGGER research_failure");
  assert.deepEqual(f.store.readReport(owner, input.caseId), before);
  assert.equal(f.db.database.query("SELECT 1 FROM review_records WHERE hash=?").get(next.sha256), null);
  f.store.rollback(lease);
});
test("two connections read one old/new snapshot and attachment despite replacement sweep", async t => {
  const f = await fixture(t); await f.publish(f.artifact);
  const other = await openRuntimeDatabase(f.state);
  let interleave: (() => void) | undefined;
  const reader = createCaseStore(() => { const work = interleave; interleave = undefined; work?.(); return 1000; }, undefined, other);
  t.after(() => { reader.dispose(); other.close(); });
  const value = { ...f.artifact, record: { ...f.artifact.record, recordedAt: "2026-11-16T00:00:00.000Z" } };
  const next = { ...value, sha256: revision(value.record) }, lease = f.store.begin(owner, input.caseId, 1);
  await f.store.run(lease, input, async () => f.store.stageResources(next));
  interleave = () => { f.store.commit(lease, { decision }, () => {}); f.store.pendingCleanup(owner); };
  const old = reader.readReport(owner, input.caseId), fresh = reader.readReport(owner, input.caseId);
  assert.equal(old?.snapshot.version, 1); assert.equal(old?.research?.artifactSha256, f.artifact.sha256);
  assert.equal(fresh?.snapshot.version, 2); assert.equal(fresh?.research?.artifactSha256, next.sha256);
  assert.equal(f.db.database.query("SELECT 1 FROM review_records WHERE hash=?").get(f.artifact.sha256), null);
});
test("restart restores synchronously with calculation/source files unavailable", async t => {
  const f = await fixture(t); await f.publish(f.artifact);
  const expected = f.store.readReport(owner, input.caseId); f.store.dispose(); f.db.close();
  const isolated = join(f.directory, "offline");
  await cp(join(root, "src"), join(isolated, "src"), { recursive: true });
  await mkdir(join(isolated, "data/sources"), { recursive: true });
  await cp(join(root, "data/sources/manifest.json"), join(isolated, "data/sources/manifest.json"));
  await cp(join(root, "data/sources/evidence-candidates.json"), join(isolated, "data/sources/evidence-candidates.json"));
  await symlink(join(root, "node_modules"), join(isolated, "node_modules"), "dir");
  const script = `import assert from "node:assert/strict";
    import {createCaseStore} from ${JSON.stringify(join(isolated, "src/o-case-store.ts"))};
    import {openRuntimeDatabase} from ${JSON.stringify(join(isolated, "src/o-runtime-db.ts"))};
    import {readCaseResearchCatalog} from ${JSON.stringify(join(isolated, "src/o-case-research.ts"))};
    const db=await openRuntimeDatabase(${JSON.stringify(f.state)});
    const store=createCaseStore(()=>1000,undefined,db);
    const report=store.readReport(${JSON.stringify(owner)},${JSON.stringify(input.caseId)});
    assert.equal(store instanceof Promise,false);assert.equal(report instanceof Promise,false);
    await assert.rejects(readCaseResearchCatalog());
    process.stdout.write(JSON.stringify(report));store.dispose();db.close();`;
  const result = await promisify(execFile)(process.execPath, ["--eval", script], { cwd: tmpdir(), env: process.env, timeout: 10000 });
  assert.deepEqual(JSON.parse(result.stdout), expected);
});
test("photo association, historical revision, withdrawal and outbox preserve evaluated research", async t => {
  const f = await fixture(t); await f.publish(f.artifact);
  const ref = "11111111-1111-4111-8111-111111111111";
  const receipt: PhotoReceipt = { version: 1, photoRef: ref, caseId: input.caseId, uploadRevision: inputRevision,
    originalSha256: "a".repeat(64), sha256: "b".repeat(64), width: 1, height: 1, createdAt: 1000, expiresAt: 9999999,
    consent: { recordId: "stored-only", store: true, model: false, visibleContentReviewed: false, expiresAt: 9999999 } };
  f.store.associate(f.store.begin(owner, input.caseId, 1), receipt, () => {});
  const row = f.db.database.query<{ snapshot: string }, []>("SELECT snapshot FROM cases").get(); assert.ok(row);
  const historical = JSON.parse(row.snapshot);
  historical.input.massKg = 25;
  f.db.database.query("UPDATE cases SET snapshot=?").run(JSON.stringify(historical));
  f.store.withdraw(owner, input.caseId, ref, true);
  const before = f.store.readReport(owner, input.caseId);
  assert.equal(before?.snapshot.input.massKg, 25); assert.equal(before?.snapshot.evaluated.revision, inputRevision);
  assert.equal(before?.research?.artifactSha256, f.artifact.sha256);
  assert.deepEqual(f.store.pendingCleanup(owner).map(p => p.photoRef), [ref]);
  const restored = createCaseStore(() => 1000, undefined, f.db);
  assert.deepEqual(restored.readReport(owner, input.caseId), before);
  restored.completeCleanup(owner, input.caseId, ref); restored.dispose();
  assert.equal(f.store.readReport(owner, input.caseId)?.research?.artifactSha256, f.artifact.sha256);
});
for (const fault of ["hash", "actor", "case", "revision", "date", "source-bytes", "extras", "resources", "origin"] as const) test("stored corruption fails closed: " + fault, async t => {
  const f = await fixture(t); await f.publish(f.artifact);
  const value = Value.Parse(ResearchCaseArtifactSchema, f.artifact);
  if (fault === "actor") value.record.research.binding.actorId = "wrong";
  if (fault === "case") value.record.research.binding.caseId = "wrong";
  if (fault === "revision") value.record.research.binding.inputRevision = "0".repeat(64);
  if (fault === "date") value.record.research.binding.assessmentDate = "2026-02-30";
  if (fault === "source-bytes") { const s = value.record.sources.find(s => s.state === "verified"); assert.ok(s); s.base64 += "\n"; }
  if (fault === "extras") Reflect.set(value.record, "extra", true);
  if (fault === "resources") Reflect.set(value.record.resources, "research", {});
  if (fault === "origin") value.record.dataOrigin.reference = "changed";
  value.sha256 = fault === "hash" ? "0".repeat(64) : revision(value.record);
  const text = JSON.stringify(value);
  f.db.database.query("UPDATE review_records SET artifact=?,bytes=?").run(text, Buffer.byteLength(text));
  assert.throws(() => f.store.readReport(owner, input.caseId), RuntimeStorageError);
  assert.throws(() => createCaseStore(() => 999999999, undefined, f.db), RuntimeStorageError);
});
for (const fault of ["missing-reference", "unreferenced-corruption"] as const) test("startup validates retained artifacts: " + fault, async t => {
  const f = await fixture(t); await f.publish(f.artifact);
  if (fault === "missing-reference") f.db.database.exec("PRAGMA foreign_keys=OFF; DELETE FROM review_records; PRAGMA foreign_keys=ON");
  else f.db.database.query("INSERT INTO review_records VALUES(?,?,?)").run("0".repeat(64), "{}", 2);
  assert.throws(() => createCaseStore(() => 999999999, undefined, f.db), RuntimeStorageError);
  if (fault === "missing-reference") assert.throws(() => f.store.readReport(owner, input.caseId), RuntimeStorageError);
});
