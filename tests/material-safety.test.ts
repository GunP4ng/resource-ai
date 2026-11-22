import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import inputs from "../data/evaluation/material-safety-20261122/inputs.json" with { type: "json" };
import manifest from "../data/evaluation/material-safety-20261122/manifest.json" with { type: "json" };
import { createResourceDomain } from "../src/domain.ts";
import { parseCaseInput } from "../src/input.ts";
import { safetyReasons } from "../src/o-safety-reasons.ts";
import { revision } from "../src/o-validation.ts";

test("the exposed material safety inputs retain their frozen bytes and input identities", async () => {
  const bytes = await readFile(new URL("../data/evaluation/material-safety-20261122/inputs.json", import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), manifest.sourceHash);
  assert.deepEqual(inputs.cases.map(row => ({ caseId: row.input.caseId, inputSha256: revision(row.input) })), manifest.cases);
  assert.equal(new Set(manifest.cases.map(row => row.caseId)).size, manifest.cases.length);
});

for (const { input, expected, family, condition } of inputs.cases) {
  test(`${input.caseId} ${family} ${condition} retains its declared safety outcome`, async () => {
    const parsed = parseCaseInput(input);
    assert.ok(parsed.ok);
    const before = revision(parsed.value);
    const result = await createResourceDomain(parsed.value).decide();
    assert.equal(result.state, expected.state);
    if (expected.reasonKey !== null) {
      const reason = Object.entries(safetyReasons).find(([key]) => key === expected.reasonKey)?.[1];
      assert.ok(reason, expected.reasonKey);
      assert.ok(result.state !== "compared");
      const reasons = result.state === "needs-review" ? result.reasons : result.questions;
      assert.ok(reasons.includes(reason), input.caseId);
    }
    if (result.state === "compared") {
      assert.equal(result.humanApproval, "pending");
      assert.deepEqual(result.scenarios, []);
      assert.equal(result.recommendations?.[0]?.cost.value, null);
      assert.equal(result.recommendations?.[0]?.carbon.value, null);
    }
    assert.equal(revision(parsed.value), before);
  });
}
