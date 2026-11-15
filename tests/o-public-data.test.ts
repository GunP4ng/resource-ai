import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { validateResourceArtifact } from "../src/o-resources.ts";
import { parseCaseInput } from "../src/input.ts";
import { revision } from "../src/o-validation.ts";
import { readPriceSnapshot, sourceManifest } from "../src/sources.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = join(root, "data/o-public-development/2026-11-15");
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const load = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, "utf8"));
const receiptSchema = Type.Object({ status: Type.Literal("verified"), inputRevision: Type.String(),
  artifactCanonicalSha256: Type.String(), artifactFileSha256: Type.String(), lineageFileSha256: Type.String(),
  resourcesSha256: Type.String(), population: Type.Object({ records: Type.Number(), numeric: Type.Number(),
    null: Type.Number(), skipped: Type.Number(), issues: Type.Number() }) });
function run(path: string) {
  return new Promise<{ readonly code: number | null; readonly out: string; readonly err: string }>((done, reject) => {
    const child = spawn(process.execPath, [join(root, "scripts/o-public-data.ts"), "verify", path],
      { env: process.env, stdio: ["ignore", "pipe", "pipe"], timeout: 15000 });
    let out = "", err = "";
    child.stdout.on("data", chunk => { out += String(chunk); });
    child.stderr.on("data", chunk => { err += String(chunk); });
    child.on("error", reject); child.on("close", code => done({ code, out, err }));
  });
}

test("serialized public subset preserves source cells, unpublished null, dates and original attribution", async () => {
  const source = sourceManifest.find(entry => entry.sourceId === "keco-price-2026-10");
  assert.ok(source?.localPath);
  const result = readPriceSnapshot(await readFile(join(root, source.localPath)), source);
  assert.ok(result.state === "available");
  const subset = Value.Parse(Type.Object({ source: Type.Unknown(), rows: Type.Array(Type.Unknown()),
    unit: Type.String(), locators: Type.Unknown() }), await load(join(root, "data/reference/public-2026-11-15/keco-price-subset.json")));

  assert.deepEqual(subset.rows, result.rows.filter(row => row.rowNumber === 4 && ["수도권", "강원"].includes(row.region)));
  assert.deepEqual(subset.source, result.evidence);
  assert.equal(result.evidence.sha256, "562bf85c2f9a2047649b52d9875da462fdb2ca14be36e21cfd1950ff976dfeb3");
  assert.equal(result.evidence.retrievedAt, "2026-11-05T08:53:59Z");
  assert.equal(subset.unit, "KRW/kg");
  assert.deepEqual(subset.locators, { dataRow: 3, csvRowIncludingHeader: 4, previewRowIndex: 3, columnIndices: [2, 3] });
});

test("public package verifies separate hashes while retaining unknown facts and J holds", async () => {
  const parsed = parseCaseInput(await load(join(directory, "input.json"))); assert.ok(parsed.ok);
  const artifactBytes = await readFile(join(directory, "artifact.json"));
  const accepted = await validateResourceArtifact(JSON.parse(artifactBytes.toString("utf8")), parsed.value);

  const result = await run(directory);

  assert.equal(result.code, 0, result.err);
  const receipt = Value.Parse(receiptSchema, JSON.parse(result.out));
  assert.deepEqual(receipt.population, { records: 136, numeric: 60, null: 76, skipped: 9, issues: 0 });
  assert.equal(receipt.inputRevision, revision(parsed.value));
  assert.equal(receipt.artifactCanonicalSha256, accepted.artifact.sha256);
  assert.equal(receipt.artifactFileSha256, sha(artifactBytes));
  assert.equal(receipt.resourcesSha256, revision({}));
  assert.equal(receipt.lineageFileSha256, sha(await readFile(join(directory, "lineage.json"))));
  assert.deepEqual([parsed.value.process, parsed.value.polymer, parsed.value.contamination, parsed.value.massKg, parsed.value.region], [null, null, null, null, null]);
  assert.equal(parsed.value.hazardousContact, "unknown"); assert.deepEqual(parsed.value.photoRefs, []);
  assert.deepEqual(accepted.resources, {});
  assert.deepEqual(accepted.artifact.record.sources.map(source => ({ sourceId: source.sourceId, state: source.state })), [
    { sourceId: "legal-public-annex5-4-obligations", state: "verified" },
    { sourceId: "legal-public-annex5-3-r3-3-packaging", state: "verified" },
    { sourceId: "legal-public-annex5-4-290881-pdf", state: "verified" },
    { sourceId: "legal-290881-annex5-3-pdf", state: "verified" },
  ]);
  assert.equal(accepted.artifact.record.dataOrigin.kind, "synthetic");
  assert.equal(accepted.artifact.record.decision.state, "needs-review");
  assert.deepEqual(accepted.artifact.record.assessment.routes.map(route => route.eligibility.state), ["unknown", "unknown", "unknown", "unknown"]);
});

for (const scenario of ["lineage-bytes", "missing-lineage", "wrong-revision", "artifact-bytes", "invented-polymer"] as const) {
  test(`public verification rejects ${scenario} at the package boundary`, async t => {
    const temporary = await mkdtemp(join(tmpdir(), "o-public-integrity-"));
    t.after(() => rm(temporary, { recursive: true, force: true }));
    for (const name of ["input.json", "lineage.json", "artifact.json"]) {
      await writeFile(join(temporary, name), await readFile(join(directory, name)));
    }
    const parsed = parseCaseInput(await load(join(temporary, "input.json"))); assert.ok(parsed.ok);
    switch (scenario) {
      case "lineage-bytes": await writeFile(join(temporary, "lineage.json"), await readFile(join(temporary, "lineage.json"), "utf8") + " "); break;
      case "missing-lineage": await rm(join(temporary, "lineage.json")); break;
      case "wrong-revision": await writeFile(join(temporary, "input.json"), JSON.stringify({ ...parsed.value, description: "다른 합성 revision" })); break;
      case "artifact-bytes": await writeFile(join(temporary, "artifact.json"), "{corrupted"); break;
      case "invented-polymer": await writeFile(join(temporary, "input.json"), JSON.stringify({ ...parsed.value, polymer: "PE" })); break;
      default: assert.fail(scenario satisfies never);
    }

    const result = await run(temporary);

    assert.equal(result.code, 1); assert.equal(result.out, "");
    const reason = { "lineage-bytes": "lineage-binding", "missing-lineage": "ENOENT", "wrong-revision": "lineage-revision",
      "artifact-bytes": "JSON", "invented-polymer": "synthetic-unknowns" }[scenario];
    assert.ok(result.err.includes(reason), result.err);
  });
}
