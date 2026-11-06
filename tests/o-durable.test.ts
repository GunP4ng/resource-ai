import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, chmod, rename, mkdir, symlink, link, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { createCaseStore, CaseConflict, CASE_LEASE_MS, parseAssessment } from "../src/o-case-store.ts";
import { openRuntimeDatabase, createMemoryRuntimeDatabase, RuntimeStorageError, type RuntimeDatabase } from "../src/o-runtime-db.ts";
import { prepareCaseRecord } from "../src/case-record.ts";
import { revision } from "../src/o-validation.ts";
import type { PhotoReceipt } from "../src/photos.ts";
import { syntheticCase } from "./h-fixtures.ts";

const owner = "actor:owner", ref = "11111111-1111-4111-8111-111111111111";
const input = { ...syntheticCase, caseId: "durable-case", photoRefs: [] };
const assessment = { decision: { state: "needs-review", caseId: input.caseId, reasons: ["review"], evidence: [] } } as const;
async function seed(store: ReturnType<typeof createCaseStore>) {
  const lease = store.begin(owner, input.caseId, null);
  await store.run(lease, input, async () => undefined);
  store.commit(lease, assessment, () => undefined);
}

test("cleanup permission notice arriving during evaluation survives publication", async () => {
  const store = createCaseStore(); await seed(store);
  const lease = store.begin(owner, input.caseId, 1);
  await store.run(lease, input, async () => undefined);
  store.queueCleanup(owner, input.caseId, ref);
  store.commit(lease, assessment, () => undefined);
  assert.equal(store.read(owner, input.caseId)?.permissionChanged, true);
  assert.deepEqual(store.read(owner, input.caseId)?.pendingCleanup, [ref]);
  store.dispose();
});

async function fixture(work: (f: { root: string; connect: () => Promise<RuntimeDatabase>; store: (database: RuntimeDatabase, now?: () => number) => ReturnType<typeof createCaseStore> }) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "o-durable-")), connections: RuntimeDatabase[] = [], stores: ReturnType<typeof createCaseStore>[] = [];
  try { await work({ root, async connect() { const db = await openRuntimeDatabase(root); connections.push(db); return db; },
    store(db, now) { const store = createCaseStore(now, undefined, db); stores.push(store); return store; } }); }
  finally { for (const store of stores) { try { store.dispose(); } catch { /* invalid storage is intentionally exercised below */ } }
    for (const db of connections) db.close(); await rm(root, { recursive: true, force: true }); }
}
const receipt: PhotoReceipt = { version: 1, photoRef: ref, caseId: input.caseId, uploadRevision: revision(input), originalSha256: "a".repeat(64), sha256: "b".repeat(64),
  width: 1, height: 1, createdAt: 1000, expiresAt: 10000000, consent: { recordId: "consent", store: true, model: false, visibleContentReviewed: false, expiresAt: 10000000 } };
async function attach(store: ReturnType<typeof createCaseStore>) {
  store.associate(store.begin(owner, input.caseId, 1), receipt, () => undefined);
}
test("reopen recovers owner, versions, presentation and original retention deadlines", async () => fixture(async f => {
  const first = await f.connect(), store = f.store(first, () => 1000); await seed(store);
  const lease = store.begin(owner, input.caseId, 1);
  await store.run(lease, input, async () => store.stagePresentation({ mode: "live", execution: { traceId: "trace", usage: "0 tokens" } }));
  store.commit(lease, assessment, () => undefined);
  store.dispose(); first.close();
  const restored = f.store(await f.connect(), () => 2000), snapshot = restored.read(owner, input.caseId);
  assert.equal(snapshot?.version, 2); assert.equal(snapshot?.expires, 3601000); assert.equal(snapshot.editUntil, 1801000);
  assert.equal(snapshot.presentation?.execution?.usage, "0 tokens"); assert.equal(snapshot.evaluated.revision, revision(input));
  assert.equal(restored.read("actor:other", input.caseId), undefined); assert.deepEqual(restored.list("actor:other"), []);
  assert.equal(restored.list(owner)[0]?.caseId, input.caseId);
}));

test("competing connections enforce leases, version CAS and token-owned rollback", async () => fixture(async f => {
  let time = 1000;
  const a = f.store(await f.connect(), () => time), b = f.store(await f.connect(), () => time); await seed(a);
  const stale = a.begin(owner, input.caseId, 1); await a.run(stale, input, async () => undefined);
  assert.throws(() => b.begin(owner, input.caseId, 1), CaseConflict);
  time += CASE_LEASE_MS;
  const fresh = b.begin(owner, input.caseId, 1);
  a.rollback(stale);
  assert.throws(() => a.begin(owner, input.caseId, 1), CaseConflict);
  assert.throws(() => a.commit(stale, assessment, () => undefined), CaseConflict);
  await b.run(fresh, input, async () => undefined); b.commit(fresh, assessment, () => undefined);
  assert.throws(() => a.begin(owner, input.caseId, 1), CaseConflict);
  assert.equal(a.read(owner, input.caseId)?.version, 2);
}));

test("uncommitted candidate, resources and presentation remain private across connections", async () => fixture(async f => {
  const db = await f.connect(), a = f.store(db), b = f.store(await f.connect()); await seed(a);
  const artifact = await prepareCaseRecord(input, { dataOrigin: { kind: "synthetic", reference: "fixture" }, codeRevision: "1".repeat(40), signal: new AbortController().signal, sources: async () => null });
  const lease = a.begin(owner, input.caseId, 1);
  await a.run(lease, input, async () => {
    a.stageResources(artifact); a.stagePresentation({ mode: "synthetic", sourceVersion: "fixture" });
    assert.equal(a.currentActor(), "owner");
    assert.equal(b.read(owner, input.caseId)?.version, 1);
    assert.equal(b.read(owner, input.caseId)?.review, null);
    assert.equal(db.database.query("SELECT * FROM review_records").all().length, 0);
  });
  a.commit(lease, assessment, () => undefined);
  const committed = b.read(owner, input.caseId); assert.equal(committed?.review?.hash, artifact.sha256);
  assert.equal(committed.presentation?.mode, "synthetic"); assert.equal("record" in committed, false);
  const next = a.begin(owner, input.caseId, 2); await a.run(next, input, async () => undefined); a.commit(next, assessment, () => undefined);
  assert.equal(b.read(owner, input.caseId)?.review, null); assert.equal(b.read(owner, input.caseId)?.presentation, undefined);
  assert.throws(() => a.stageResources(null), CaseConflict); assert.throws(() => a.stagePresentation({ mode: "live" }), CaseConflict);
}));

test("final guard failure rolls back case and staged artifact writes", async () => fixture(async f => {
  const db = await f.connect(), store = f.store(db); await seed(store);
  const artifact = await prepareCaseRecord(input, { dataOrigin: { kind: "synthetic", reference: "fixture" }, codeRevision: "1".repeat(40), signal: new AbortController().signal, sources: async () => null });
  const before = store.read(owner, input.caseId), lease = store.begin(owner, input.caseId, 1); let guards = 0;
  await store.run(lease, input, async () => store.stageResources(artifact));
  assert.throws(() => store.commit(lease, assessment, () => { if (++guards === 2) throw new Error("final-guard"); }), /final-guard/);
  assert.equal(guards, 2); assert.deepEqual(store.read(owner, input.caseId), before);
  assert.equal(db.database.query("SELECT * FROM review_records").all().length, 0);
  store.rollback(lease);
}));

test("SQL abort and zero affected-row writes never publish success", async () => fixture(async f => {
  const db = await f.connect(), store = f.store(db); await seed(store); const before = store.read(owner, input.caseId);
  for (const action of ["ABORT", "IGNORE"]) {
    const lease = store.begin(owner, input.caseId, 1); await store.run(lease, input, async () => undefined);
    db.database.exec(`CREATE TRIGGER fail_update BEFORE UPDATE ON cases BEGIN SELECT RAISE(${action}${action === "ABORT" ? ", 'test abort'" : ""}); END`);
    assert.throws(() => store.commit(lease, assessment, () => undefined), action === "ABORT" ? RuntimeStorageError : CaseConflict);
    db.database.exec("DROP TRIGGER fail_update"); assert.deepEqual(store.read(owner, input.caseId), before); store.rollback(lease);
  }
}));

test("busy writer returns an immediate bounded conflict", async () => fixture(async f => {
  const first = await f.connect(), second = await f.connect(), store = f.store(second);
  first.database.exec("BEGIN IMMEDIATE");
  try { assert.throws(() => store.begin(owner, input.caseId, null), CaseConflict); }
  finally { first.database.exec("ROLLBACK"); }
  store.rollback(store.begin(owner, input.caseId, null));
}));

test("cleanup metadata merges across connections without releasing a newer evaluation", async () => fixture(async f => {
  const a = f.store(await f.connect(), () => 1000), b = f.store(await f.connect(), () => 1000); await seed(a);
  a.queueCleanup(owner, input.caseId, ref);
  const lease = a.begin(owner, input.caseId, 1); await a.run(lease, { ...input, massKg: 123 }, async () => undefined);
  b.completeCleanup(owner, input.caseId, ref);
  const otherRef = "22222222-2222-4222-8222-222222222222"; b.queueCleanup(owner, input.caseId, otherRef);
  assert.throws(() => b.begin(owner, input.caseId, 1), CaseConflict);
  a.commit(lease, assessment, () => undefined);
  const snapshot = b.read(owner, input.caseId); assert.equal(snapshot?.input.massKg, 123);
  assert.deepEqual(snapshot.pendingCleanup, [otherRef]); assert.equal(snapshot.permissionChanged, true);
  assert.deepEqual(b.pendingCleanup(owner).map(p => p.photoRef), [otherRef]);
}));

test("revocation invalidates remote work, persists denial and keeps historical evaluated revision", async () => fixture(async f => {
  const db = await f.connect(), a = f.store(db, () => 1000), b = f.store(await f.connect(), () => 1000); await seed(a); await attach(a);
  const lease = a.begin(owner, input.caseId, 2); await a.run(lease, { ...input, massKg: 123 }, async () => undefined);
  b.withdraw(owner, input.caseId, ref, true);
  assert.throws(() => a.commit(lease, assessment, () => undefined), CaseConflict);
  const restored = f.store(await f.connect(), () => 1000).read(owner, input.caseId);
  assert.equal(restored?.version, 3); assert.equal(restored?.evaluated.version, 1); assert.equal(restored?.evaluated.revision, revision(input));
  assert.deepEqual(restored?.denied, [ref]); assert.deepEqual(restored?.pendingCleanup, [ref]); assert.deepEqual(restored?.photos, []);
  a.rollback(lease);
}));

test("expiry transfers photos and late compensation survives case deletion and restart", async () => fixture(async f => {
  let time = 1000; const db = await f.connect(), a = f.store(db, () => time); await seed(a); await attach(a);
  time += 3600000;
  assert.deepEqual(a.list(owner), []); assert.equal(a.read(owner, input.caseId), undefined);
  const late = "22222222-2222-4222-8222-222222222222"; a.queueCleanup(owner, input.caseId, late);
  a.dispose(); db.close(); const b = f.store(await f.connect(), () => time);
  assert.deepEqual(b.pendingCleanup("actor:other"), []);
  assert.deepEqual(new Set(b.pendingCleanup(owner).map(p => p.photoRef)), new Set([ref, late]));
  b.completeCleanup(owner, input.caseId, ref); b.completeCleanup(owner, input.caseId, late);
  assert.deepEqual(b.pendingCleanup(owner), []);
}));

test("restart never extends editing or report retention", async () => fixture(async f => {
  const db = await f.connect(), store = f.store(db, () => 1000); await seed(store); store.dispose(); db.close();
  const editExpired = f.store(await f.connect(), () => 1801000);
  assert.throws(() => editExpired.begin(owner, input.caseId, 1), CaseConflict);
  assert.equal(editExpired.read(owner, input.caseId)?.expires, 3601000);
  const expired = f.store(await f.connect(), () => 3601000); assert.equal(expired.read(owner, input.caseId), undefined);
}));

test("mutation guards roll back revocation, cleanup and reservation changes", async () => fixture(async f => {
  const store = f.store(await f.connect(), () => 1000); await seed(store); await attach(store); const before = store.read(owner, input.caseId);
  const fail = () => { throw new Error("guard"); };
  assert.throws(() => store.withdraw(owner, input.caseId, ref, true, fail), /guard/);
  assert.throws(() => store.queueCleanup(owner, input.caseId, ref, fail), /guard/);
  assert.deepEqual(store.read(owner, input.caseId), before); assert.deepEqual(store.pendingCleanup(owner), []);
  assert.throws(() => store.begin(owner, "reservation", null, fail), /guard/);
  store.rollback(store.begin(owner, "reservation", null));
  store.queueCleanup(owner, input.caseId, "22222222-2222-4222-8222-222222222222");
  assert.throws(() => store.completeCleanup(owner, input.caseId, "22222222-2222-4222-8222-222222222222", fail), /guard/);
  assert.equal(store.pendingCleanup(owner).length, 1);
}));

test("malformed restored input, envelope, time, version and receipt fail closed", async () => {
  for (const corrupt of [
    (value: Record<string, unknown>) => { value["input"] = { ...input, massKg: -1 }; },
    (value: Record<string, unknown>) => { value["assessment"] = { ...assessment, execution: { traceId: "", usage: null } }; },
    (value: Record<string, unknown>) => { value["expires"] = 999; },
    (value: Record<string, unknown>) => { value["version"] = 99; },
    (value: Record<string, unknown>) => { value["photos"] = [{ ...receipt, sha256: "bad" }]; },
  ]) await fixture(async f => {
    const db = await f.connect(), store = f.store(db, () => 1000); await seed(store);
    const snapshot = store.read(owner, input.caseId); assert.ok(snapshot);
    const raw: Record<string, unknown> = JSON.parse(JSON.stringify(snapshot)); corrupt(raw);
    db.database.query("UPDATE cases SET snapshot=?").run(JSON.stringify(raw));
    assert.throws(() => store.read(owner, input.caseId), RuntimeStorageError);
    assert.throws(() => createCaseStore(() => 1000, undefined, db), RuntimeStorageError);
  });
});

test("altered referenced artifacts are rejected at restoration", async () => fixture(async f => {
  const db = await f.connect(), store = f.store(db); await seed(store);
  const artifact = await prepareCaseRecord(input, { dataOrigin: { kind: "synthetic", reference: "fixture" }, codeRevision: "1".repeat(40), signal: new AbortController().signal, sources: async () => null });
  const lease = store.begin(owner, input.caseId, 1); await store.run(lease, input, async () => store.stageResources(artifact)); store.commit(lease, assessment, () => undefined);
  const altered = JSON.stringify({ ...artifact, sha256: "a".repeat(64) });
  db.database.query("UPDATE review_records SET artifact=?,bytes=?").run(altered, Buffer.byteLength(altered));
  assert.throws(() => store.read(owner, input.caseId), RuntimeStorageError);
  assert.throws(() => createCaseStore(undefined, undefined, db), RuntimeStorageError);
}));

test("unknown schema versions, altered schema and corrupt SQLite never reset", async () => {
  for (const mode of ["version", "schema", "corrupt"]) await fixture(async f => {
    const db = await f.connect();
    if (mode === "version") db.database.exec("PRAGMA user_version=2");
    if (mode === "schema") db.database.exec("ALTER TABLE accounts ADD COLUMN extra TEXT");
    db.close(); if (mode === "corrupt") await writeFile(join(f.root, "runtime.sqlite"), "not sqlite", { mode: 0o600 });
    await assert.rejects(f.connect(), RuntimeStorageError);
  });
});

test("unsafe root permissions and linked database paths are rejected", async () => {
  await fixture(async f => { await chmod(f.root, 0o755); await assert.rejects(f.connect(), RuntimeStorageError); });
  await fixture(async f => { const db = await f.connect(); db.close(); await link(join(f.root, "runtime.sqlite"), join(f.root, "linked")); await assert.rejects(f.connect(), RuntimeStorageError); });
  await fixture(async f => { const db = await f.connect(); db.close(); await rename(join(f.root, "runtime.sqlite"), join(f.root, "real")); await symlink(join(f.root, "real"), join(f.root, "runtime.sqlite")); await assert.rejects(f.connect(), RuntimeStorageError); });
  await assert.rejects(openRuntimeDatabase("relative"), RuntimeStorageError);
});

test("pinned root and database replacement reject subsequent operations", async () => {
  await fixture(async f => {
    const db = await f.connect(), store = f.store(db); await seed(store);
    await rename(join(f.root, "runtime.sqlite"), join(f.root, "original")); await writeFile(join(f.root, "runtime.sqlite"), "", { mode: 0o600 });
    assert.throws(() => store.read(owner, input.caseId), RuntimeStorageError); assert.throws(() => db.assertReady(), RuntimeStorageError);
  });
  await fixture(async f => {
    const db = await f.connect(); await rename(f.root, f.root + "-old"); await mkdir(f.root, { mode: 0o700 });
    try { assert.throws(() => db.assertReady(), RuntimeStorageError); }
    finally { db.close(); await rm(f.root, { recursive: true }); await rename(f.root + "-old", f.root); }
  });
});

test("memory database uses the same schema and external lifecycle remains explicit", async () => {
  const db = createMemoryRuntimeDatabase(), store = createCaseStore(undefined, undefined, db); await seed(store);
  assert.equal(db.root, null); assert.equal(db.database.query("SELECT * FROM accounts").all().length, 0);
  store.dispose(); db.assertReady(); assert.throws(() => store.read(owner, input.caseId), RuntimeStorageError); db.close(); assert.throws(() => db.assertReady(), RuntimeStorageError);
});

test("restored reservations exceeding the global capacity fail startup", async () => fixture(async f => {
  const db = await f.connect();
  db.database.transaction(() => {
    for (let i = 0; i < 101; i++) db.database.query("INSERT INTO leases(case_id,token,owner,expected_version,notice_generation,created_at,expires) VALUES(?,?,?,NULL,0,1000,66000)")
      .run("reserved-" + i, randomUUID(), owner);
  }).immediate();
  assert.throws(() => createCaseStore(() => 1000, undefined, db), RuntimeStorageError);
}));

test("snapshot byte bounds reject oversize publication without changing the prior report", async () => {
  const store = createCaseStore(); await seed(store); const before = store.read(owner, input.caseId), lease = store.begin(owner, input.caseId, 1);
  await store.run(lease, { ...input, description: "x".repeat(1048576) }, async () => undefined);
  assert.throws(() => store.commit(lease, assessment, () => undefined), /storage-byte-limit/);
  assert.deepEqual(store.read(owner, input.caseId), before); store.rollback(lease); store.dispose();
});

test("shared parser preserves explicit usage and rejects malformed metadata", () => {
  assert.deepEqual(parseAssessment({ ...assessment, execution: { traceId: "trace", usage: "0 tokens" } }).execution, { traceId: "trace", usage: "0 tokens" });
  assert.throws(() => parseAssessment({ ...assessment, execution: { traceId: "trace", usage: 0 } }));
});

test("staging clones accepted provenance and inherited ALS cannot revive a closed lease", async () => {
  const store = createCaseStore(); await seed(store);
  const artifact = await prepareCaseRecord(input, { dataOrigin: { kind: "synthetic", reference: "original" }, codeRevision: "1".repeat(40), signal: new AbortController().signal, sources: async () => null });
  const lease = store.begin(owner, input.caseId, 1);
  let resume: () => void = () => assert.fail("missing continuation"), inherited: Promise<void> | undefined;
  const gate = new Promise<void>(resolveGate => { resume = resolveGate; });
  await store.run(lease, input, async () => {
    store.stageResources(artifact); store.stagePresentation({ mode: "synthetic" });
    assert.throws(() => store.stageResources(null), CaseConflict);
    inherited = gate.then(() => { assert.throws(() => store.currentActor(), CaseConflict); assert.throws(() => store.stagePresentation({ mode: "live" }), CaseConflict); });
  });
  artifact.record.dataOrigin.reference = "changed";
  store.commit(lease, assessment, () => undefined);
  assert.equal(store.read(owner, input.caseId)?.review?.origin.reference, "original");
  resume(); await inherited; store.dispose();
});

test("unsafe or replaced WAL sidecars and symlinked roots fail closed", async () => {
  await fixture(async f => {
    const db = await f.connect(); db.assertReady(); const wal = join(f.root, "runtime.sqlite-wal");
    await rename(wal, join(f.root, "original-wal")); await writeFile(wal, "", { mode: 0o600 });
    assert.throws(() => db.assertReady(), RuntimeStorageError);
  });
  await fixture(async f => {
    const db = await f.connect(); await chmod(join(f.root, "runtime.sqlite-wal"), 0o644);
    assert.throws(() => db.assertReady(), RuntimeStorageError);
  });
  await fixture(async f => {
    const alias = f.root + "-link"; await symlink(f.root, alias);
    try { await assert.rejects(openRuntimeDatabase(alias), RuntimeStorageError); }
    finally { await rm(alias); }
  });
});

// Real children hold leases until explicit stdin release, or are killed without disposal.
const childSource = `
  import { openRuntimeDatabase } from ${JSON.stringify(resolve("src/o-runtime-db.ts"))};
  import { createCaseStore } from ${JSON.stringify(resolve("src/o-case-store.ts"))};
  const root=process.argv[1], mode=process.argv[2], at=Number(process.argv[3]);
  const db=await openRuntimeDatabase(root), store=createCaseStore(()=>at,undefined,db);
  const input=${JSON.stringify(input)}, assessment=${JSON.stringify(assessment)}, owner=${JSON.stringify(owner)};
  if(mode==='commit') { const l=store.begin(owner,input.caseId,null); await store.run(l,input,async()=>{});store.commit(l,assessment,()=>{});process.exit(0); }
  try { store.begin(owner,mode==='capacity'?process.argv[4]:input.caseId,mode==='edit'?1:null);console.log('acquired'); }
  catch(e) { if(e.name==='CaseConflict'||e.constructor.name==='CaseConflict')console.log('conflict');else throw e; }
  await Bun.stdin.text(); store.dispose();db.close();
`;
function child(root: string, mode: string, at = 1000, id = "child") {
  const process = spawn(globalThis.process.execPath, ["--eval", childSource, root, mode, String(at), id], { stdio: "pipe" });
  let diagnostics = ""; process.stderr.on("data", chunk => { diagnostics += String(chunk); });
  const exited = new Promise<number | null>((resolveExit, reject) => { process.once("close", resolveExit); process.once("error", reject); });
  return Object.assign(process, { exited, diagnostics: () => diagnostics });
}
async function message(process: ReturnType<typeof child>) {
  const lines = createInterface({ input: process.stdout });
  try { const [line] = await once(lines, "line"); return String(line).trim(); }
  finally { lines.close(); }
}
test("cross-process evaluation lease admits one owner and recovers only after crash expiry", async () => fixture(async f => {
  let time = 1000; const store = f.store(await f.connect(), () => time); await seed(store);
  const crashed = child(f.root, "edit");
  try {
    assert.equal(await message(crashed), "acquired"); assert.throws(() => store.begin(owner, input.caseId, 1), CaseConflict);
    crashed.kill("SIGKILL"); await crashed.exited;
    assert.throws(() => store.begin(owner, input.caseId, 1), CaseConflict);
    time += CASE_LEASE_MS; const recovered = store.begin(owner, input.caseId, 1); store.rollback(recovered);
  } finally { crashed.kill(); await crashed.exited; }
}));

test("atomic 100-case capacity counts cross-process creation reservations", async () => fixture(async f => {
  const store = f.store(await f.connect(), () => 1000);
  for (let i = 0; i < 99; i++) store.begin(owner, "reserved-" + i, null);
  const a = child(f.root, "capacity", 1000, "last-a"), b = child(f.root, "capacity", 1000, "last-b");
  try { const outcomes = await Promise.all([message(a), message(b)]); assert.deepEqual(outcomes.sort(), ["acquired", "conflict"]);
    assert.throws(() => store.begin(owner, "overflow", null), CaseConflict);
  } finally { a.stdin.end(); b.stdin.end(); await Promise.all([a.exited, b.exited]); }
}));

test("confirmed commit followed by immediate process exit survives reopen", async () => fixture(async f => {
  const first = await f.connect(); first.close(); const process = child(f.root, "commit");
  assert.equal(await process.exited, 0, process.diagnostics());
  const store = f.store(await f.connect(), () => 1000); assert.equal(store.read(owner, input.caseId)?.version, 1); assert.equal(store.list(owner).length, 1);
}));
