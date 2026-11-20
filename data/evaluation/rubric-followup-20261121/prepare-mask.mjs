import assert from "node:assert/strict";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [runDirectory, privateDirectory] = process.argv.slice(2);
assert.ok(runDirectory && privateDirectory, "Usage: bun prepare-mask.mjs RUN_DIRECTORY PRIVATE_DIRECTORY");
const directory = dirname(fileURLToPath(import.meta.url));
const maskedDirectory = join(directory, "masked");
const hash = value => createHash("sha256").update(value).digest("hex");
const protocol = await readFile(join(directory, "protocol.md"));
const targets = await readFile(join(directory, "question-targets.json"));
JSON.parse(targets.toString());
const items = [];
const key = [];
const sources = [];
for (const arm of ["A", "B", "C"]) {
  const filename = join(resolve(runDirectory), `${arm}.jsonl`);
  const bytes = await readFile(filename);
  const rows = bytes.toString("utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.equal(rows.length, 18);
  sources.push({ arm, filename, sha256: hash(bytes), rows: rows.length });
  for (const [index, row] of rows.entries()) {
    assert.equal(row.arm, arm);
    assert.equal(row.outcome, "success");
    assert.equal(row.errorCategory, null);
    const recordId = randomUUID();
    const input = row.effectiveInput;
    assert.equal(input.caseId, row.caseId);
    const outputSha256 = hash(JSON.stringify(row.output));
    const inputSha256 = hash(JSON.stringify(input));
    items.push({ recordId, caseId: row.caseId, input, inputSha256, output: row.output, outputSha256 });
    key.push({ recordId, arm, caseId: row.caseId, originalFile: filename, originalLine: index + 1,
      rawInputSha256: row.inputSha256, inputSha256, outputSha256, gitSha: row.gitSha });
  }
}
assert.equal(items.length, 54);
assert.equal(new Set(items.map(item => item.recordId)).size, 54);
for (let i = items.length - 1; i > 0; i--) {
  const j = randomInt(i + 1);
  [items[i], items[j]] = [items[j], items[i]];
}
await mkdir(maskedDirectory, { recursive: true });
await mkdir(resolve(privateDirectory), { recursive: true, mode: 0o700 });
const batches = [];
for (let i = 0; i < 3; i++) {
  const name = `batch-${i + 1}.jsonl`;
  const content = items.slice(i * 18, (i + 1) * 18).map(item => JSON.stringify(item)).join("\n") + "\n";
  await writeFile(join(maskedDirectory, name), content, { flag: "wx" });
  await chmod(join(maskedDirectory, name), 0o444);
  batches.push({ name, records: 18, sha256: hash(content) });
}
const manifest = { preparedAt: new Date().toISOString(), records: 54, batches,
  protocolSha256: hash(protocol), questionTargetsSha256: hash(targets),
  masking: "Outer arm/filename/order/usage/calls/request IDs removed; original input/output content unchanged. Schema/style can still reveal arm." };
await writeFile(join(directory, "mask-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
await writeFile(join(resolve(privateDirectory), "arm-key.json"),
  JSON.stringify({ ...manifest, sources, key }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
console.log(JSON.stringify(manifest, null, 2));
