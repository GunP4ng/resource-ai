import { readFile } from "node:fs/promises";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { DecisionResult } from "../src/contracts.ts";
import { lookupLegalEvidence, pendingLegalSources } from "../src/evidence.ts";

const nullableText = Type.Union([Type.String(), Type.Null()]);
const CaseSchema = Type.Object({
  caseId: Type.String(), description: Type.String(), photoRefs: Type.Array(Type.String()),
  process: nullableText, polymer: nullableText, contamination: nullableText,
  hazardousContact: Type.Union([Type.Literal("yes"), Type.Literal("no"), Type.Literal("unknown")]),
  massKg: Type.Union([Type.Number(), Type.Null()]), region: nullableText, assessmentDate: Type.String(),
});
const DemoSchema = Type.Array(Type.Object({
  label: Type.String(), caseOrigin: Type.Union([Type.Literal("constructed-reproduction"), Type.Literal("user-supplied")]),
  input: CaseSchema, intendedUse: Type.Union([Type.Literal("general-resin"), Type.Literal("food-container")]),
}));
const path = process.argv[2] ?? new URL("../data/reference/legal/demo-inputs.json", import.meta.url);
const raw: unknown = JSON.parse(await readFile(path, "utf8"));
const entries = Value.Parse(DemoSchema, raw);
const results = entries.map((entry) => {
  const lookup = lookupLegalEvidence(entry.input, undefined, { intendedUse: entry.intendedUse });
  const decision: DecisionResult = {
    state: "needs-review", caseId: entry.input.caseId, evidence: lookup.evidence,
    reasons: [...lookup.reviewRequirements, ...lookup.issues.map((issue) => `${issue.sourceId ?? "lookup"}: ${issue.kind}`),
      "법령 참고자료 조회 결과이며 사례별 적법성·허가·처리경로 확정은 수행하지 않았다."],
  };
  return { ...entry, lookup, pending: pendingLegalSources(entry.input), decision };
});
console.log(JSON.stringify({ schemaVersion: 1, results }, null, 2));
