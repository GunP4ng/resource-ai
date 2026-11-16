import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, writeFile, readFile, chmod, symlink, link, truncate, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createCaseStore } from "../src/o-case-store.ts";
import { openRuntimeDatabase } from "../src/o-runtime-db.ts";
import { readCaseResearchCatalog } from "../src/o-case-research.ts";
import { artifactCodeRevision } from "../src/o-artifact-target.ts";
import { packageAppAssets } from "../scripts/package-app-assets.ts";
import { createFileResourceProvider } from "../src/o-resources.ts";
import { revision } from "../src/o-validation.ts";
import type { PhotoReceipt } from "../src/photos.ts";
import { sourceManifest } from "../src/sources.ts";

const root = fileURLToPath(new URL("../", import.meta.url)), catalog = await readCaseResearchCatalog();
const execute = promisify(execFile), actorId = "package-actor", owner = "actor:" + actorId;
async function fixture(t: { after(fn: () => unknown): void }, index = 0) {
  const directory = await mkdtemp(join(tmpdir(), "o-package-")), state = join(directory, "state");
  const db = await openRuntimeDatabase(state), store = createCaseStore(Date.now, undefined, db);
  db.database.query("INSERT INTO accounts VALUES(?,?,?,1,0,?)").run(actorId, "operator", "synthetic-unused-hash", Date.now());
  const source = catalog.calculations.data.cases[index]; assert.ok(source);
  const input = { ...source.original, caseId: "owned-case" }, lease = store.begin(owner, input.caseId, null);
  const decision = { state: "needs-information", caseId: input.caseId, questions: ["review"], evidence: [] } as const;
  await store.run(lease, input, async () => {}); store.commit(lease, { decision }, () => {});
  const args = ["--state-dir", state, "--username", "operator", "--case-id", input.caseId, "--expected-revision", revision(input)];
  const run = async (command: string, tail: readonly string[], script = join(root, "scripts/o-case-package.ts")) => {
    try {
      const result = await execute(process.execPath, [script, command, ...args, ...tail], { cwd: tmpdir(), env: process.env, timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
      return { code: 0, out: result.stdout, err: result.stderr };
    } catch (error) {
      if (!(error instanceof Error) || !("stdout" in error) || !("stderr" in error)) throw error;
      return { code: 1, out: String(error.stdout), err: String(error.stderr) };
    }
  };
  const prepare = () => run("prepare", ["--source-case", source.case_id]);
  const artifact = join(directory, "artifact.json");
  t.after(async () => { store.dispose(); db.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, state, db, store, input, decision, args, source, artifact, run, prepare };
}

for (const index of [0, 1, 2]) test("prepare off-cwd preserves the fixed original " + index, async t => {
  const f = await fixture(t, index), before = f.store.readReport(owner, f.input.caseId);
  const result = await f.prepare(); assert.equal(result.code, 0, result.err);
  const a = JSON.parse(result.out);
  assert.equal(a.record.version, 2); assert.equal(a.sha256, revision(a.record));
  assert.equal(a.record.codeRevision, artifactCodeRevision());
  assert.deepEqual(a.record.research.binding, { actorId, caseId: f.input.caseId, inputRevision: revision(f.input), assessmentDate: "2026-11-10" });
  assert.deepEqual(a.record.input.photoRefs, []); assert.deepEqual(a.record.images, []); assert.deepEqual(a.record.resources, {});
  assert.equal(a.record.research.calculations.cases[0].original.caseId, f.source.case_id);
  assert.equal(a.record.input.massKg, index === 0 ? 24 : index === 1 ? 18 : null);
  assert.deepEqual(f.store.readReport(owner, f.input.caseId), before);
});
test("handoff emits verified J lineage/rights/history and actual stored-only H receipts", async t => {
  const f = await fixture(t), prepared = await f.prepare(); assert.equal(prepared.code, 0, prepared.err);
  await writeFile(f.artifact, prepared.out, { mode: 0o600 });
  const now = Date.now(), ref = "11111111-1111-4111-8111-111111111111";
  const receipt: PhotoReceipt = { version: 1, photoRef: ref, caseId: f.input.caseId, uploadRevision: revision(f.input),
    originalSha256: "a".repeat(64), sha256: "b".repeat(64), width: 1, height: 1, createdAt: now, expiresAt: now + 300000,
    consent: { recordId: "stored-only", store: true, model: false, visibleContentReviewed: false, expiresAt: now + 300000 } };
  f.store.associate(f.store.begin(owner, f.input.caseId, 1), receipt, () => {});
  const result = await f.run("handoff", ["--artifact", f.artifact]); assert.equal(result.code, 0, result.err);
  const data = JSON.parse(result.out), a = JSON.parse(prepared.out);
  assert.deepEqual(data.j.original, a.record.research.calculations.cases[0]);
  assert.equal(data.j.original.law_version, "290881");
  assert.deepEqual(data.j.sources, a.record.research.calculations.sources);
  assert.deepEqual(data.j.processorDirectory, a.record.research.processors);
  assert.equal(data.j.process, f.input.process); assert.equal(data.j.contamination, f.input.contamination);
  assert.equal(data.j.hazardousContact, f.input.hazardousContact);
  assert.deepEqual(data.h.photoRefs, []); assert.equal(data.h.storedReceipts.length, 1);
  assert.deepEqual(data.h.storedReceipts[0].receipt, receipt);
  assert.equal(data.h.storedReceipts[0].selected, false); assert.equal(data.h.storedReceipts[0].modelConsentDeclared, false);
  assert.equal(data.h.storedReceipts[0].curatedSha256, null); assert.equal(data.h.storedReceipts[0].modelExecution, null);
  assert.equal(data.h.photoExecution, null); assert.equal(data.h.execution, null);
  assert.equal(result.out.includes("synthetic-unused-hash"), false);
});
test("check/install preserve the report until explicit reevaluation and restart", async t => {
  const f = await fixture(t), prepared = await f.prepare(); assert.equal(prepared.code, 0, prepared.err);
  await writeFile(f.artifact, prepared.out, { mode: 0o600 });
  const resources = join(f.directory, "resources"); await mkdir(resources, { mode: 0o700 });
  const before = f.store.readReport(owner, f.input.caseId);
  for (const command of ["check", "install"]) {
    const result = await f.run(command, ["--resources-dir", resources, "--artifact", f.artifact], join(root, "scripts/o-artifact.ts"));
    assert.equal(result.code, 0, result.err);
    assert.deepEqual(f.store.readReport(owner, f.input.caseId), before);
  }
  const provider = await createFileResourceProvider({ root: resources, caseStore: f.store }), lease = f.store.begin(owner, f.input.caseId, 1);
  await f.store.run(lease, f.input, async active => provider(f.input, active));
  f.store.commit(lease, { decision: f.decision }, () => {});
  const a = JSON.parse(prepared.out);
  assert.equal(f.store.readReport(owner, f.input.caseId)?.research?.artifactSha256, a.sha256);
  const restored = createCaseStore(Date.now, undefined, f.db);
  assert.deepEqual(restored.readReport(owner, f.input.caseId), f.store.readReport(owner, f.input.caseId)); restored.dispose();
});
for (const fault of ["disabled", "owner", "revision", "unknown-source", "changed-input", "caller-actor"] as const) test("prepare fails with no partial stdout: " + fault, async t => {
  const f = await fixture(t);
  if (fault === "disabled") f.db.database.exec("UPDATE accounts SET disabled=1");
  if (fault === "owner") f.db.database.exec("UPDATE accounts SET actor_id='another'");
  if (fault === "revision") f.args[f.args.indexOf("--expected-revision") + 1] = "0".repeat(64);
  if (fault === "changed-input") {
    const lease = f.store.begin(owner, f.input.caseId, 1), changed = { ...f.input, massKg: 25 };
    await f.store.run(lease, changed, async () => {}); f.store.commit(lease, { decision: f.decision }, () => {});
    f.args[f.args.indexOf("--expected-revision") + 1] = revision(changed);
  }
  const tail = ["--source-case", fault === "unknown-source" ? "arbitrary" : f.source.case_id];
  if (fault === "caller-actor") tail.push("--actor-id", actorId);
  const before = f.db.database.serialize(), result = await f.run("prepare", tail);
  assert.equal(result.code, 1); assert.equal(result.out, ""); assert.deepEqual(f.db.database.serialize(), before);
});
for (const fault of ["symlink", "hardlink", "public-file", "public-parent", "oversize", "corrupt", "binding", "rights"] as const) test("handoff rejects private filesystem/package negative: " + fault, async t => {
  const f = await fixture(t), prepared = await f.prepare(); assert.equal(prepared.code, 0, prepared.err);
  await writeFile(f.artifact, prepared.out, { mode: 0o600 });
  if (fault === "symlink") { await rm(f.artifact); await symlink("/dev/null", f.artifact); }
  if (fault === "hardlink") await link(f.artifact, join(f.directory, "link.json"));
  if (fault === "public-file") await chmod(f.artifact, 0o644);
  if (fault === "public-parent") {
    const publicDir = join(f.directory, "public"); await mkdir(publicDir, { mode: 0o755 });
    await writeFile(join(publicDir, "artifact.json"), prepared.out, { mode: 0o600 }); f.artifact = join(publicDir, "artifact.json");
  }
  if (fault === "oversize") await truncate(f.artifact, 67108865);
  if (fault === "corrupt") await writeFile(f.artifact, "{private-data");
  if (fault === "binding" || fault === "rights") {
    const a = JSON.parse(prepared.out);
    if (fault === "binding") a.record.research.binding.actorId = "forged";
    else a.record.research.processors.source.derivedFrom = "0".repeat(64);
    a.sha256 = revision(a.record); await writeFile(f.artifact, JSON.stringify(a));
  }
  const before = f.store.readReport(owner, f.input.caseId), result = await f.run("handoff", ["--artifact", f.artifact]);
  assert.equal(result.code, 1); assert.equal(result.out, "");
  assert.equal(result.err.includes("private-data"), false); assert.deepEqual(f.store.readReport(owner, f.input.caseId), before);
});
test("packaged CLI uses fixed assets and strict build receipt outside Git/cwd", { timeout: 30000 }, async t => {
  const f = await fixture(t), output = join(f.directory, "deployment"), app = join(output, "app");
  await mkdir(app, { recursive: true });
  await execute(process.execPath, ["build", join(root, "scripts/o-case-package.ts"), join(root, "scripts/o-artifact.ts"),
    "--target=bun", "--packages=external", "--outdir=" + app], { cwd: tmpdir(), env: process.env, timeout: 15000 });
  await packageAppAssets({ output });
  await symlink(join(root, "node_modules"), join(f.directory, "node_modules"), "dir");
  const prepared = await f.run("prepare", ["--source-case", f.source.case_id], join(app, "o-case-package.js"));
  assert.equal(prepared.code, 0, prepared.err); const a = JSON.parse(prepared.out);
  assert.equal(a.record.codeRevision, artifactCodeRevision());
  assert.deepEqual(a.record.research.calculations.implementation, catalog.calculations.implementation);
  await writeFile(f.artifact, prepared.out, { mode: 0o600 });
  const result = await f.run("handoff", ["--artifact", f.artifact], join(app, "o-case-package.js"));
  assert.equal(result.code, 0, result.err); assert.equal(JSON.parse(result.out).artifactSha256, a.sha256);
  const resources = join(f.directory, "resources"); await mkdir(resources, { mode: 0o700 });
  const installed = await f.run("install", ["--resources-dir", resources, "--artifact", f.artifact], join(app, "o-artifact.js"));
  assert.equal(installed.code, 0, installed.err);
  assert.equal(f.store.readReport(owner, f.input.caseId)?.research, null);
  assert.deepEqual((await readdir(output)).sort(), ["app", "data", "o-build-receipt.json", "scripts", "src"]);
  const files = await readdir(output, { recursive: true });
  assert.equal(files.some(p => /\.omo|runtime\.sqlite|representative|telephone|ulsan-processors-2025-12\.csv$/.test(p)), false);
  assert.deepEqual(files.filter(p => p.endsWith(".pdf")).sort(), sourceManifest
    .filter(s => s.access === "bundled" && s.licenseVerified && s.localPath?.endsWith(".pdf")).map(s => s.localPath).sort());
  assert.equal((await readdir(join(output, "src"))).length, 13);
  assert.deepEqual(JSON.parse(await readFile(join(output, "o-build-receipt.json"), "utf8")), { version: 1, codeRevision: artifactCodeRevision() });
  await writeFile(join(output, "o-build-receipt.json"), JSON.stringify({ version: 1, codeRevision: artifactCodeRevision(), extra: true }));
  const failed = await f.run("prepare", ["--source-case", f.source.case_id], join(app, "o-case-package.js"));
  assert.equal(failed.code, 1); assert.equal(failed.out, "");
});
