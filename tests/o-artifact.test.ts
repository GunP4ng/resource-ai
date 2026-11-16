import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, stat, readdir, rm, chmod, truncate, symlink, link, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { openRuntimeDatabase } from "../src/o-runtime-db.ts";
import { createCaseStore } from "../src/o-case-store.ts";
import { prepareCaseRecord, createBundledSnapshotReader } from "../src/case-record.ts";
import { revision } from "../src/o-validation.ts";
import { syntheticCase } from "./h-fixtures.ts";
import type { FsProbe } from "./o-artifact-fs-preload.ts";

const script = fileURLToPath(new URL("../scripts/o-artifact.ts", import.meta.url));
const preload = fileURLToPath(new URL("./o-artifact-fs-preload.ts", import.meta.url));
async function fixture(t: { after(fn: () => unknown): void }) {
  const root = await mkdtemp(join(tmpdir(), "o-install-")), state = join(root, "state"), resources = join(root, "resources");
  await mkdir(resources, { mode: 0o700 });
  const db = await openRuntimeDatabase(state), cases = createCaseStore(Date.now, undefined, db);
  // Synthetic account only; the CLI must never select password_hash.
  db.database.query("INSERT INTO accounts VALUES(?,?,?,1,0,?)").run("installer-owner", "operator", "unused-test-hash", Date.now());
  const input = { ...syntheticCase, caseId: "installer-case", photoRefs: [] };
  const lease = cases.begin("actor:installer-owner", input.caseId, null);
  await cases.run(lease, input, async () => undefined);
  cases.commit(lease, { decision: { state: "needs-information", caseId: input.caseId, questions: ["review"], evidence: [] } }, () => {});
  const artifact = await prepareCaseRecord(input, { dataOrigin: { kind: "synthetic", reference: "installer tests; no field approval" },
    codeRevision: "f0d907c8d227790f9818dd440ae4bc9e1d400dcc", signal: new AbortController().signal,
    sources: createBundledSnapshotReader(fileURLToPath(new URL("../", import.meta.url))) });
  const source = join(root, "package.json"), bytes = JSON.stringify(artifact) + "\n";
  await writeFile(source, bytes, { mode: 0o600 });
  const target = join(resources, "installer-owner", input.caseId, revision(input) + ".json");
  const args = ["--state-dir", state, "--resources-dir", resources, "--username", "operator", "--case-id", input.caseId,
    "--expected-revision", revision(input), "--artifact", source];
  let attempt = 0;
  const run = (command = "install", sourcePath = source, expectedRevision = revision(input), probe?: Pick<FsProbe, "failSync">) => new Promise<{
    code: number | null; out: string; err: string; events: { operation: string; path: string }[];
  }>((done, reject) => {
    const trace = join(root, `fs-trace-${attempt++}.jsonl`);
    const child = spawn(process.execPath, [...(probe ? ["--preload", preload] : []), script, command, ...args.slice(0, -3), expectedRevision, "--artifact", sourcePath], {
      cwd: tmpdir(), timeout: 10000, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...(probe ? { O_ARTIFACT_FS_PROBE: JSON.stringify({ ...probe, root: resources, trace } satisfies FsProbe) } : {}) },
    });
    let out = "", err = "";
    child.stdout.on("data", chunk => { out += String(chunk); }); child.stderr.on("data", chunk => { err += String(chunk); });
    child.on("error", reject); child.on("close", async code => {
      try {
        const lines = probe ? await readFile(trace, "utf8").catch(error => { if (error.code === "ENOENT") return ""; throw error; }) : "";
        done({ code, out, err, events: lines.trim() ? lines.trim().split("\n").map(line => JSON.parse(line)) : [] });
      } catch (error) { reject(error); }
    });
  });
  const snapshot = () => db.database.serialize();
  t.after(async () => { cases.dispose(); db.close(); await rm(root, { recursive: true, force: true }); });
  return { root, state, resources, db, cases, input, artifact, source, bytes, target, run, snapshot };
}

test("CLI check validates without publication or state changes", async t => {
  const f = await fixture(t), before = f.snapshot();
  const result = await f.run("check", f.source, revision(f.input), {});
  assert.equal(result.code, 0, result.err); assert.equal(JSON.parse(result.out).status, "checked");
  assert.deepEqual(result.events, []);
  assert.deepEqual(await readdir(f.resources), []); assert.deepEqual(f.snapshot(), before);
});

for (const child of ["actor", "case"] as const) {
  test(`CLI retries failed ${child} ancestor sync before publishing`, { timeout: 30000 }, async t => {
    const f = await fixture(t), before = f.snapshot(), actor = join(f.resources, "installer-owner");
    const parent = child === "actor" ? f.resources : actor, directory = child === "actor" ? actor : join(actor, f.input.caseId);
    const failed = await f.run("install", f.source, revision(f.input), { failSync: parent });
    assert.equal(failed.code, 1); assert.equal(failed.out, "");
    assert.deepEqual(failed.events.at(-1), { operation: "fsync-failed", path: parent });
    assert.ok((await stat(directory)).isDirectory());
    await assert.rejects(stat(f.target), { code: "ENOENT" });
    const retry = await f.run("install", f.source, revision(f.input), {});
    assert.equal(retry.code, 0, retry.err); assert.equal(JSON.parse(retry.out).status, "installed; reassessment pending");
    const syncs = retry.events.filter(event => event.operation === "fsync").map(event => event.path);
    assert.deepEqual(syncs.slice(0, 2), [f.resources, actor]);
    const publication = retry.events.findIndex(event => event.operation === "publish");
    assert.ok(publication > retry.events.findIndex(event => event.operation === "fsync" && event.path === parent));
    assert.match(syncs[2]!, /\/\.install-[^/]+$/); // Complete file sync remains before publication.
    assert.equal(syncs[3], join(actor, f.input.caseId));
    assert.equal(await readFile(f.target, "utf8"), f.bytes); assert.equal((await stat(f.target)).nlink, 1);
    assert.deepEqual(f.snapshot(), before);
  });

  test(`CLI repeated ${child} ancestor sync failure refuses success on retry`, { timeout: 30000 }, async t => {
    const f = await fixture(t), before = f.snapshot();
    const parent = child === "actor" ? f.resources : join(f.resources, "installer-owner");
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await f.run("install", f.source, revision(f.input), { failSync: parent });
      assert.equal(result.code, 1, `attempt ${attempt + 1}: ${result.out}`); assert.equal(result.out, "");
      assert.equal(result.err, "Artifact operation failed: unavailable.\n");
      assert.deepEqual(result.events.at(-1), { operation: "fsync-failed", path: parent });
      assert.ok(!result.events.some(event => event.operation === "create" || event.operation === "publish"));
      await assert.rejects(stat(f.target), { code: "ENOENT" });
    }
    assert.deepEqual(f.snapshot(), before);
  });

  test(`CLI identical file retries require ${child} ancestor sync and check remains read-only`, { timeout: 30000 }, async t => {
    const f = await fixture(t), before = f.snapshot(), actor = join(f.resources, "installer-owner");
    assert.equal((await f.run()).code, 0);
    const installed = await stat(f.target), parent = child === "actor" ? f.resources : actor;
    for (let attempt = 0; attempt < 2; attempt++) {
      const failed = await f.run("install", f.source, revision(f.input), { failSync: parent });
      assert.equal(failed.code, 1); assert.equal(failed.out, "");
      assert.deepEqual(failed.events.at(-1), { operation: "fsync-failed", path: parent });
      assert.equal(await readFile(f.target, "utf8"), f.bytes);
    }
    const retry = await f.run("install", f.source, revision(f.input), {});
    assert.equal(retry.code, 0, retry.err); assert.equal(JSON.parse(retry.out).status, "installed; reassessment pending");
    assert.deepEqual(retry.events.filter(event => event.operation === "fsync").map(event => event.path),
      [f.resources, actor, f.target, join(actor, f.input.caseId)]);
    assert.ok(!retry.events.some(event => event.operation === "create" || event.operation === "publish"));
    assert.equal((await stat(f.target)).ino, installed.ino); assert.equal((await stat(f.target)).nlink, 1);
    const check = await f.run("check", f.source, revision(f.input), { failSync: parent });
    assert.equal(check.code, 0, check.err); assert.equal(JSON.parse(check.out).status, "checked"); assert.deepEqual(check.events, []);
    assert.deepEqual(f.snapshot(), before);
  });
}

test("CLI installs complete private unchanged bytes and identical retries leave state untouched", async t => {
  const f = await fixture(t), before = f.snapshot();
  const results = [await f.run(), await f.run()];
  for (const result of results) { assert.equal(result.code, 0, result.err); assert.equal(JSON.parse(result.out).status, "installed; reassessment pending"); }
  assert.equal(await readFile(f.target, "utf8"), f.bytes);
  const info = await stat(f.target); assert.equal(info.mode & 0o777, 0o600); assert.equal(info.nlink, 1);
  assert.equal((await stat(join(f.resources, "installer-owner"))).mode & 0o777, 0o700);
  assert.deepEqual(await readdir(join(f.resources, "installer-owner", f.input.caseId)), [revision(f.input) + ".json"]);
  assert.deepEqual(f.snapshot(), before);
});

test("concurrent CLI installs publish one complete single-link artifact", async t => {
  const f = await fixture(t);
  const results = await Promise.all([f.run(), f.run()]);
  for (const result of results) assert.equal(result.code, 0, result.err);
  assert.equal(await readFile(f.target, "utf8"), f.bytes); assert.equal((await stat(f.target)).nlink, 1);
});

test("concurrent different valid package bytes refuse overwrite", async t => {
  const f = await fixture(t), alternate = join(f.root, "alternate.json"), bytes = JSON.stringify(f.artifact, null, 2);
  await writeFile(alternate, bytes, { mode: 0o600 });
  const results = await Promise.all([f.run(), f.run("install", alternate)]);
  assert.deepEqual(results.map(result => result.code).sort(), [0, 1]);
  const rejected = results.find(result => result.code === 1); assert.ok(rejected); assert.match(rejected.err, /failed: conflict/);
  assert.ok([f.bytes, bytes].includes(await readFile(f.target, "utf8"))); assert.equal((await stat(f.target)).nlink, 1);
});

for (const scenario of ["missing-state", "missing-database", "malformed-state", "disabled", "unknown", "owner", "case", "expected-revision", "artifact-hash", "closed", "changed-input", "invalid-package", "oversize-source", "public-source", "public-root", "linked-source", "hardlinked-source", "linked-root", "target-parent-file", "conflict"] as const) {
  test(`CLI refuses ${scenario} without state mutation or replacement`, async t => {
    const f = await fixture(t);
    switch (scenario) {
      case "missing-state": f.db.close(); await rm(f.state, { recursive: true }); break;
      case "missing-database": f.db.close(); await rm(f.state, { recursive: true }); await mkdir(f.state, { mode: 0o700 }); break;
      case "malformed-state": f.db.close(); await writeFile(join(f.state, "runtime.sqlite"), "private damaged database"); break;
      case "disabled": f.db.database.query("UPDATE accounts SET disabled=1").run(); break;
      case "unknown": f.db.database.query("UPDATE accounts SET username='different'").run(); break;
      case "owner": f.db.database.query("UPDATE accounts SET actor_id='different'").run(); break;
      case "case": f.db.database.query("DELETE FROM cases").run(); break;
      case "expected-revision": break;
      case "artifact-hash": await writeFile(f.source, JSON.stringify({ ...f.artifact, sha256: "0".repeat(64) })); break;
      case "closed": {
        // Move both durable clocks consistently, retaining valid snapshot metadata.
        const row = f.db.database.query<{ snapshot: string }, []>("SELECT snapshot FROM cases").get(); assert.ok(row);
        const value = JSON.parse(row.snapshot); value.editUntil -= 1800001; value.expires -= 1800001; value.evaluated.committedAt -= 1800001;
        f.db.database.query("UPDATE cases SET snapshot=?,edit_until=?,expires=?").run(JSON.stringify(value), value.editUntil, value.expires); break;
      }
      case "changed-input": {
        const lease = f.cases.begin("actor:installer-owner", f.input.caseId, 1), input = { ...f.input, massKg: 12345 };
        await f.cases.run(lease, input, async () => undefined);
        f.cases.commit(lease, { decision: { state: "needs-information", caseId: input.caseId, questions: ["changed"], evidence: [] } }, () => {}); break;
      }
      case "invalid-package": await writeFile(f.source, "PRIVATE-PACKAGE invalid"); break;
      case "oversize-source": await truncate(f.source, 64 * 1024 * 1024 + 1); break;
      case "public-source": await chmod(f.source, 0o644); break;
      case "public-root": await chmod(f.resources, 0o755); break;
      case "linked-source": await rename(f.source, f.source + ".original"); await symlink(f.source + ".original", f.source); break;
      case "hardlinked-source": await link(f.source, f.source + ".linked"); break;
      case "linked-root": await rename(f.resources, f.resources + ".original"); await symlink(f.resources + ".original", f.resources); break;
      case "target-parent-file": await writeFile(join(f.resources, "installer-owner"), "blocked", { mode: 0o600 }); break;
      case "conflict": await mkdir(join(f.resources, "installer-owner", f.input.caseId), { recursive: true, mode: 0o700 }); await writeFile(f.target, "existing private conflict", { mode: 0o600 }); break;
    }
    const closed = ["missing-state", "missing-database", "malformed-state"].includes(scenario);
    const before = closed ? undefined : f.snapshot();
    const result = await f.run("install", f.source, scenario === "expected-revision" ? "0".repeat(64) : revision(f.input));
    assert.equal(result.code, 1); assert.equal(result.out, ""); assert.match(result.err, /^Artifact operation failed: [a-z-]+\.\n$/);
    if (before) assert.deepEqual(f.snapshot(), before);
    if (scenario === "missing-state") await assert.rejects(stat(f.state), { code: "ENOENT" });
    else if (scenario === "missing-database") assert.deepEqual(await readdir(f.state), []);
    else if (scenario === "malformed-state") assert.equal(await readFile(join(f.state, "runtime.sqlite"), "utf8"), "private damaged database");
    else if (scenario === "conflict") assert.equal(await readFile(f.target, "utf8"), "existing private conflict");
    else if (scenario === "target-parent-file") assert.equal(await readFile(join(f.resources, "installer-owner"), "utf8"), "blocked");
    else await assert.rejects(stat(f.target), { code: "ENOENT" });
  });
}
