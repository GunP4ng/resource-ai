import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const parse = async path => JSON.parse(await readFile(path, "utf8"));
const lock = await parse(join(root, "scores/score-lock.json"));
assert.equal(lock.verificationVerdict, "PASS");
assert.equal(lock.frozen, true);
const records = [];
for (const file of lock.files) {
  assert.equal(hash(await readFile(join(root, file.path))), file.sha256, file.path);
  if (file.path.startsWith("scores/batch-")) {
    records.push(...(await parse(join(root, file.path))).records);
  }
}
assert.equal(records.length, 54);
assert.equal(new Set(records.map(row => row.recordId)).size, 54);
const verify = process.argv[2] === "--verify";
let mapping;
if (verify) {
  mapping = await parse(join(root, "arm-map.json"));
} else {
  assert.ok(process.argv[2], "Usage: bun decode-scores.mjs PRIVATE_KEY_JSON | --verify");
  const privateKey = await parse(process.argv[2]);
  mapping = {
    decodedAt: new Date().toISOString(),
    scoreLockSha256: hash(await readFile(join(root, "scores/score-lock.json"))),
    sources: privateKey.sources.map(source => ({ ...source, filename: basename(source.filename) })),
    key: privateKey.key.map(row => ({ ...row, originalFile: basename(row.originalFile) })),
  };
  assert.ok(Date.parse(mapping.decodedAt) >= Date.parse(lock.timestamp));
  await writeFile(join(root, "arm-map.json"), JSON.stringify(mapping, null, 2) + "\n", { flag: "wx" });
}
assert.equal(mapping.scoreLockSha256, hash(await readFile(join(root, "scores/score-lock.json"))));
assert.equal(mapping.key.length, 54);
assert.equal(new Set(mapping.key.map(row => row.recordId)).size, 54);
const joined = records.map(record => {
  const key = mapping.key.find(row => row.recordId === record.recordId);
  assert.ok(key);
  assert.equal(key.caseId, record.caseId);
  assert.equal(key.inputSha256, record.inputSha256);
  assert.equal(key.outputSha256, record.outputSha256);
  return { ...record, arm: key.arm };
});
const four = new Set(["HYEOB-20261112-003", "HYEOB-20261112-005", "OYS-20261110-006", "OYS-20261110-008"]);
const counts = values => values.reduce((result, value) => {
  result[value] = (result[value] ?? 0) + 1;
  return result;
}, {});
const summary = ["A", "B", "C"].map(arm => {
  const rows = joined.filter(row => row.arm === arm);
  assert.equal(rows.length, 18);
  assert.equal(new Set(rows.map(row => row.caseId)).size, 18);
  const riskRows = rows.filter(row => four.has(row.caseId));
  assert.equal(riskRows.length, 4);
  const citations = rows.flatMap(row => row.citations);
  const critical = rows.flatMap(row => row.questions.critical);
  const applicable = rows.filter(row => row.questions.critical.length > 0);
  return {
    arm, records: rows.length,
    executionAll: counts(rows.map(row => row.execution.category)),
    executionFour: counts(riskRows.map(row => row.execution.category)),
    fourCases: riskRows.map(row => ({ caseId: row.caseId, recordId: row.recordId,
      category: row.execution.category, evidence: row.execution.evidence, reason: row.execution.reason })),
    claims: Object.fromEntries(["processor", "price", "factor"].map(kind => {
      const claims = rows.flatMap(row => row.claims.filter(claim => claim.kind === kind));
      return [kind, { count: claims.length, statuses: counts(claims.map(claim => claim.status)),
        casesWithClaims: rows.filter(row => row.claims.some(claim => claim.kind === kind)).length,
        unsupportedCases: rows.filter(row => row.claims.some(claim => claim.kind === kind
          && ["unsupported-assertion", "contradicted"].includes(claim.status))).length }];
    })),
    citations: { count: citations.length, statuses: counts(citations.map(citation => citation.status)),
      casesWithCitations: rows.filter(row => row.citations.length > 0).length,
      casesWithoutConcreteCitation: rows.filter(row => row.citations.length === 0).length },
    criticalQuestions: { count: critical.length, statuses: counts(critical.map(question => question.status)),
      asked: critical.filter(question => question.status === "asked").length,
      applicableCases: applicable.length,
      allAskedCases: applicable.filter(row => row.questions.critical.every(question => question.status === "asked")).length,
      notApplicableCases: rows.length - applicable.length },
  };
});
const result = {
  schemaVersion: 1,
  decodedAt: mapping.decodedAt,
  recordCount: 54,
  protocolSha256: hash(await readFile(join(root, "protocol.md"))),
  questionTargetsSha256: hash(await readFile(join(root, "question-targets.json"))),
  scoreLockSha256: mapping.scoreLockSha256,
  summary,
  limitations: [
    "Retrospective coding-agent audit with arm labels removed, not independent human or fully blind assessment.",
    "The four review cases are mixed/multilayer2, contradiction1, hazardous-contact1; not four independently adjudicated legal hazards.",
    "A/B parsed model replies and C final system decisions differ in architecture; these descriptive measures do not identify a causal model effect.",
    "No-claim and no-citation are absence, not100percent accuracy. Unsupported-by-registry is not necessarily false in the real world.",
    "Critical-question targets are a fixed input-derived audit checklist, not externally adjudicated ground truth.",
  ],
};
if (verify) {
  assert.deepEqual(await parse(join(root, "summary.json")), result);
  console.log("PASS: frozen hashes,54unique rows,18perarm,4reviewcasesperarm and aggregate reproduction");
} else {
  await writeFile(join(root, "summary.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(result, null, 2));
}
