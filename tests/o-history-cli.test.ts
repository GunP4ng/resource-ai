import { createHash } from "node:crypto";
import { Value } from "typebox/value";
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, readFile, chmod, truncate, symlink, link, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { syntheticDocuments, syntheticHistory } from "./o-history-fixture.ts";
import { readPrivateArtifact } from "../src/o-artifact-target.ts";
import { HISTORY_SOURCE_BYTES, HISTORY_PACKAGE_BYTES, HistoryPackageSchema } from "../src/o-history-schema.ts";
import { acceptHistoryPackage, historyReceipt } from "../src/o-history.ts";
import { revision } from "../src/o-validation.ts";
import { parseHistoryJson } from "../src/o-history-validation.ts";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const scratch = "/tmp/resource-ai-o-demo-resume.o715Do/h14";
async function fixture(t: { after(fn: () => unknown): void }) {
  await mkdir(scratch, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(scratch, "history-"));
  const comment = join(directory, "comment.json"), evidence = join(directory, "evidence.json"), artifact = join(directory, "archive.json");
  const d = syntheticDocuments();
  await writeFile(comment, d.commentBytes, { mode: 0o600 });
  await writeFile(evidence, d.evidenceBytes, { mode: 0o600 });
  const run = (args: readonly string[], script = join(root, "scripts/o-case-package.ts")) => new Promise<{
    readonly code: number | null; readonly out: string; readonly err: string;
  }>((resolve, reject) => {
    const child = execFile(process.execPath, [script, ...args], { cwd: directory, timeout: 20000,
      env: { ...process.env, TMPDIR: scratch, RESOURCE_STATE_DIR: join(directory, "must-not-open-storage") },
    }, (error, out, err) => {
      if (error && !("code" in error)) { reject(error); return; }
      resolve({ code: error ? typeof error.code === "number" ? error.code : 1 : 0, out, err });
    });
    child.on("error", reject);
  });
  const receive = (script?: string) => run(["receive-history", "--source-comment", comment, "--evidence", evidence], script);
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, comment, evidence, artifact, d, run, receive };
}
test("off-cwd source CLI receives then fully reloads receipt without runtime storage", async t => {
  const f = await fixture(t), received = await f.receive();
  assert.equal(received.code, 0, received.err);
  await writeFile(f.artifact, received.out, { mode: 0o600 });
  const receipt = await f.run(["history-receipt", "--artifact", f.artifact]);
  assert.equal(receipt.code, 0, receipt.err);
  const accepted = acceptHistoryPackage(parseHistoryJson(received.out));
  assert.deepEqual(parseHistoryJson(receipt.out), historyReceipt(accepted));
  assert.equal(accepted.package.record.source.evidenceJson, f.d.evidenceJson);
  assert.deepEqual((await readdir(f.directory)).sort(), ["archive.json", "comment.json", "evidence.json"]);
});
test("import bundling delivers both commands in packaged off-cwd process without a new build entry", async t => {
  const f = await fixture(t), output = join(f.directory, "deployment");
  await execute(process.execPath, ["build", join(root, "scripts/o-case-package.ts"), "--target=bun", "--packages=external", "--outdir=" + output],
    { cwd: f.directory, env: process.env, timeout: 20000 });
  await symlink(join(root, "node_modules"), join(f.directory, "node_modules"), "dir");
  const script = join(output, "o-case-package.js"), result = await f.receive(script);
  assert.equal(result.code, 0, result.err);
  await writeFile(f.artifact, result.out, { mode: 0o600 });
  const receipt = await f.run(["history-receipt", "--artifact", f.artifact], script);
  assert.equal(receipt.code, 0, receipt.err);
  assert.deepEqual(parseHistoryJson(receipt.out), historyReceipt(acceptHistoryPackage(parseHistoryJson(result.out))));
});
for (const target of ["comment", "evidence", "artifact"] as const) {
  for (const fault of ["symlink", "hardlink", "public-file", "public-parent", "size", "corrupt", "utf8"] as const)
    test(`CLI refuses ${target} ${fault} with empty stdout and redacted stderr`, async t => {
      const f = await fixture(t);
      if (target === "artifact") {
        const received = await f.receive(); assert.equal(received.code, 0, received.err);
        await writeFile(f.artifact, received.out, { mode: 0o600 });
      }
      const path = f[target];
      switch (fault) {
        case "symlink": await rm(path); await symlink(f.directory + "/absent-private", path); break;
        case "hardlink": await link(path, path + ".linked"); break;
        case "public-file": await chmod(path, 0o644); break;
        case "public-parent": await chmod(f.directory, 0o755); break;
        case "size": await truncate(path, (target === "artifact" ? HISTORY_PACKAGE_BYTES : HISTORY_SOURCE_BYTES) + 1); break;
        case "corrupt": await writeFile(path, "PRIVATE-SOURCE-SENTINEL invalid"); break;
        case "utf8": await writeFile(path, Buffer.from([0xff, 0xfe])); break;
      }
      const result = target === "artifact" ? await f.run(["history-receipt", "--artifact", path]) : await f.receive();
      assert.equal(result.code, 1); assert.equal(result.out, "");
      assert.match(result.err, /^History operation failed: (filesystem|invalid-history|unavailable)\.\n$/);
      assert.equal(result.err.includes(f.directory), false); assert.equal(result.err.includes("PRIVATE-SOURCE-SENTINEL"), false);
    });
}
test("private reader accepts exact optional bound, rejects one byte less and retains default", async t => {
  const f = await fixture(t), bytes = await readFile(f.evidence);
  assert.deepEqual(readPrivateArtifact(f.evidence, bytes.length), bytes);
  assert.throws(() => readPrivateArtifact(f.evidence, bytes.length - 1));
  assert.deepEqual(readPrivateArtifact(f.evidence), bytes);
  for (const limit of [-1, Infinity, 1.5]) assert.throws(() => readPrivateArtifact(f.evidence, limit));
});
test("CLI rejects relative paths and argument ambiguity", async t => {
  const f = await fixture(t);
  for (const args of [ ["receive-history", "--source-comment", "relative", "--evidence", f.evidence],
    ["receive-history", "--source-comment", f.comment, "--source-comment", f.comment],
    ["history-receipt", "--artifact", f.artifact, "--extra", "PRIVATE-SOURCE-SENTINEL"] ]) {
    const result = await f.run(args);
    assert.equal(result.code, 1); assert.equal(result.out, "");
    assert.equal(result.err, "History operation failed: arguments.\n");
  }
});

test("receipt CLI fully rejects a well-formed resealed archive with forged case binding", async t => {
  const f = await fixture(t), received = await f.receive(); assert.equal(received.code, 0, received.err);
  const artifact = parseHistoryJson(received.out); assert.ok(Value.Check(HistoryPackageSchema, artifact));
  const evidence = syntheticHistory(), c = evidence.cases[0]; assert.ok(c);
  c.input.caseId = "synthetic-forged-input"; c.inputRevision = revision(c.input);
  const forged = syntheticDocuments(evidence);
  artifact.record.source.comment.body = forged.comment.body;
  artifact.record.source.evidenceJson = forged.evidenceJson;
  artifact.record.source.suppliedEvidenceBytesSha256 = createHash("sha256").update(forged.evidenceBytes).digest("hex");
  artifact.sha256 = revision(artifact.record);
  await writeFile(f.artifact, JSON.stringify(artifact), { mode: 0o600 });
  const result = await f.run(["history-receipt", "--artifact", f.artifact]);
  assert.equal(result.code, 1); assert.equal(result.out, "");
  assert.equal(result.err, "History operation failed: invalid-history.\n");
});
