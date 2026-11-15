import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { revision } from "../src/o-validation.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const bundle = join(root, "data/o-public-images/2026-11-15");
const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const objectSchema = Type.Record(Type.String(), Type.Unknown());
function object(value: unknown) {
  assert.ok(Value.Check(objectSchema, value));
  return value;
}
async function load(directory: string, name: string) {
  const raw: unknown = JSON.parse(await readFile(join(directory, name), "utf8"));
  return object(raw);
}
const save = (directory: string, name: string, value: unknown) => writeFile(join(directory, name), JSON.stringify(value, null, 2) + "\n");
async function fixture() {
  const temporary = await mkdtemp(join(tmpdir(), "o-public-images-"));
  await cp(bundle, temporary, { recursive: true });
  return temporary;
}
function run(directory: string, command = "verify") {
  return new Promise<{ readonly code: number | null; readonly out: string; readonly err: string }>((done, reject) => {
    const child = spawn(process.execPath, [join(root, "scripts/o-public-images.ts"), command, directory],
      { env: process.env, stdio: ["ignore", "pipe", "pipe"], timeout: 15000 });
    let out = "", err = "";
    child.stdout.on("data", chunk => { out += String(chunk); });
    child.stderr.on("data", chunk => { err += String(chunk); });
    child.on("error", reject); child.on("close", code => done({ code, out, err }));
  });
}

// Owns the serialized bundle CLI: existing suites cover neither these bytes nor this admission boundary.
// No test-only seam: removing an integrity/unknowns guard admits a corrupted private copy.
test("prepare and verify reproduce an offline bundle with separate byte and canonical hashes", async t => {
  const directory = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const report = await load(directory, "qa.json");
  report["actualAppProof"] = { status: "not_run", reason: "isolated test report" };
  await save(directory, "qa.json", report);
  await rm(join(directory, "lineage.json"));
  await rm(join(directory, "artifact.json"));
  const prepared = await run(directory, "prepare");
  assert.equal(prepared.code, 0, prepared.err);

  const result = await run(directory);

  assert.equal(result.code, 0, result.err);
  const raw: unknown = JSON.parse(result.out), receipt = object(raw);
  assert.equal(receipt["status"], "verified");
  assert.equal(receipt["inputRevision"], revision(await load(directory, "input.json")));
  assert.equal(receipt["inputFileSha256"], sha(await readFile(join(directory, "input.json"))));
  assert.equal(receipt["artifactFileSha256"], sha(await readFile(join(directory, "artifact.json"))));
  assert.equal(receipt["lineageFileSha256"], sha(await readFile(join(directory, "lineage.json"))));
  const artifact = await load(directory, "artifact.json");
  assert.equal(receipt["artifactCanonicalSha256"], revision(artifact["record"]));
  assert.equal(receipt["decision"], "needs-information");
  assert.equal(receipt["resourcesSha256"], revision({}));
  const record = object(artifact["record"]);
  assert.equal(receipt["codeRevision"], record["codeRevision"]);
  assert.deepEqual(record["images"], []);
  const images = receipt["images"];
  assert.ok(Value.Check(Type.Array(Type.Object({ path: Type.String(), curatedSha256: Type.String(),
    resanitizedSha256: Type.String(), decodedWidth: Type.Number(), decodedHeight: Type.Number() }), { minItems: 3, maxItems: 3 }), images));
  for (const image of images) {
    const bytes = await readFile(join(directory, image.path));
    assert.equal(image.curatedSha256, sha(bytes));
    assert.equal(image.decodedWidth, bytes.readUInt32BE(16));
    assert.equal(image.decodedHeight, bytes.readUInt32BE(20));
  }
});

for (const scenario of ["changed-image", "missing-image", "extra-image", "lineage-revision", "lineage-bytes",
  "artifact-revision", "rights-approval", "rights-snapshot", "known-polymer", "known-contact"] as const) {
  test(`verify rejects ${scenario} at the serialized bundle boundary`, async t => {
    const directory = await fixture();
    t.after(() => rm(directory, { recursive: true, force: true }));
    let reason: string;
    switch (scenario) {
      case "changed-image": {
        const path = join(directory, "samples/river-fragments.png"), data = await readFile(path);
        data[100] = (data[100] ?? 0) ^ 1;
        await writeFile(path, data); reason = "image-bytes"; break;
      }
      case "missing-image": await rm(join(directory, "samples/gannet-plastic.png")); reason = "sample-set"; break;
      case "extra-image": await writeFile(join(directory, "samples/unapproved.png"), "unapproved"); reason = "sample-set"; break;
      case "lineage-revision": {
        const value = await load(directory, "lineage.json"); value["inputRevision"] = "0".repeat(64);
        await save(directory, "lineage.json", value); reason = "lineage-input"; break;
      }
      case "lineage-bytes": {
        await writeFile(join(directory, "lineage.json"), await readFile(join(directory, "lineage.json"), "utf8") + " ");
        reason = "lineage-binding"; break;
      }
      case "artifact-revision": {
        const value = await load(directory, "artifact.json"); object(value["record"])["caseRevision"] = "0".repeat(64);
        await save(directory, "artifact.json", value); reason = "artifact-binding"; break;
      }
      case "rights-approval": {
        const value = await load(directory, "manifest.json"); object(value["runtimeIdentity"])["modelExecutionApproval"] = true;
        await save(directory, "manifest.json", value); reason = "manifest-boundary"; break;
      }
      case "rights-snapshot": {
        const value = await load(directory, "license-snapshots.json"), snapshots = value["snapshots"];
        assert.ok(Value.Check(Type.Array(Type.Object({ text: Type.String(), sha256: Type.String() })), snapshots));
        for (const snapshot of snapshots) { snapshot.text += "Unobserved rights approval\n"; snapshot.sha256 = sha(snapshot.text); }
        await save(directory, "license-snapshots.json", value); reason = "snapshot-provenance"; break;
      }
      case "known-polymer": case "known-contact": {
        const value = await load(directory, "input.json");
        value[scenario === "known-polymer" ? "polymer" : "hazardousContact"] = scenario === "known-polymer" ? "PET" : "no";
        await save(directory, "input.json", value); reason = "synthetic-unknowns"; break;
      }
      default: assert.fail(scenario satisfies never);
    }

    const result = await run(directory);

    assert.equal(result.code, 1, result.out);
    assert.equal(result.out, "");
    assert.ok(result.err.includes(reason), result.err);
  });
}
