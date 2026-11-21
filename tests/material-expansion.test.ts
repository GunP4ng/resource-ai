import assert from "node:assert/strict";
import { test } from "node:test";
import type { CaseInput } from "../src/contracts.ts";
import { createResourceDomain } from "../src/domain.ts";
import { lookupLegalEvidence, loadEvidenceRegistry } from "../src/evidence.ts";
import { createResourceApp } from "../src/session.ts";
import { materialFamily } from "../src/material-context.ts";
import { canonical } from "../src/o-validation.ts";
import { hostVerificationOrder } from "../src/o-verification-plan.ts";
import { syntheticCase, syntheticReviewed } from "./h-fixtures.ts";
import registry from "../data/sources/evidence-candidates.json" with { type: "json" };

const cases: readonly { input: CaseInput; code: string; type: string }[] = [
  { input: { ...syntheticCase, caseId: "synthetic-ferrous", polymer: "고철", description: "분리 수거된 철 스크랩",
    process: "사업장일반폐기물 금속 절단", contamination: "없음", assessmentDate: "2026-11-22" }, code: "51-29-01", type: "R-3-3" },
  { input: { ...syntheticCase, caseId: "synthetic-nonferrous", polymer: "알루미늄", description: "분리 수거된 비철 금속 스크랩",
    process: "사업장일반폐기물 금속 절단", contamination: "없음", assessmentDate: "2026-11-22" }, code: "51-29-02", type: "R-3-3" },
  { input: { ...syntheticCase, caseId: "synthetic-raw-wood", polymer: "무처리 원목", description: "무처리 원목 절단 부산물",
    process: "사업장일반폐기물 원목 제재", contamination: "없음", assessmentDate: "2026-11-22" }, code: "51-20-22", type: "R-3-4" },
  { input: { ...syntheticCase, caseId: "synthetic-wood-packaging", polymer: "무처리 목재 포장재", description: "깨끗한 원목 포장재",
    process: "사업장일반폐기물 포장재 사용", contamination: "없음", assessmentDate: "2026-11-22" }, code: "51-20-23", type: "R-3-4" },
  { input: { ...syntheticCase, caseId: "synthetic-paper", polymer: "골판지", description: "무코팅 골판지 포장",
    process: "사업장일반폐기물 포장재 사용", contamination: "없음", assessmentDate: "2026-11-22" }, code: "51-28-02", type: "R-3-3" },
  { input: { ...syntheticCase, caseId: "synthetic-carton", polymer: "복합 종이팩", description: "PE 및 알루미늄으로 적층된 종이팩",
    process: "사업장일반폐기물 음료 포장재 사용", contamination: "없음", assessmentDate: "2026-11-22" }, code: "51-28-01", type: "R-3-3" },
];

test("material legal quotes retain the existing original-source integrity checks", () => {
  const loaded = loadEvidenceRegistry(registry);
  assert.deepEqual(loaded.issues, []);
  for (const { input, code } of cases) {
    const lookup = lookupLegalEvidence(input);
    const citation = lookup.citations.find(item => item.kind === "waste-code" && item.claim.includes(code));
    assert.ok(citation);
    const candidate = loaded.candidates.find(item => item.record.sourceId === citation.sourceId);
    assert.ok(candidate?.originalVerified && candidate.claimVerified);
    assert.ok(candidate.provenance?.originalSha256);
  }
});

for (const { input, code, type } of cases) {
  test(`${input.caseId} receives its own conditional route without invented metrics`, async () => {
    const before = canonical(input);
    const lookup = lookupLegalEvidence(input);
    assert.equal(lookup.citations.some(citation => citation.claim.includes("51-03-01")), false);
    const decision = await createResourceDomain(input).decide();
    assert.equal(decision.state, "compared");
    assert.ok(decision.state === "compared");
    assert.equal(decision.humanApproval, "pending");
    assert.equal(decision.recommendations?.length, 1);
    assert.equal(decision.recommendations?.[0]?.grade, "public-conditional");
    assert.equal(decision.recommendations?.[0]?.cost.value, null);
    assert.equal(decision.recommendations?.[0]?.carbon.value, null);
    const route = decision.routes.find(item => item.route === "mechanical-recycling");
    assert.ok(route?.eligibility.state === "conditional");
    assert.match(route.eligibility.conditions.join(" "), new RegExp(`${code}.*${type}`));
    assert.deepEqual(decision.scenarios, []);
    if (materialFamily(input) === "wood") assert.match(decision.preExecutionChecks?.join(" ") ?? "", /사전 분석|사전분석/);
    assert.equal(canonical(input), before);
  });
}

test("unknown material families ask for composition and origin without borrowing plastic codes", async () => {
  for (const polymer of ["폐목재", "금속", "MDF 목재", "포장재", "복합 포장재"]) {
    const input = { ...syntheticCase, polymer, description: "재질 신고", process: "발생원 미상", contamination: "없음",
      assessmentDate: "2026-11-22" };
    const decision = await createResourceDomain(input).decide();
    assert.ok(decision.state === "needs-information" || decision.state === "needs-review");
    const assessment = createResourceDomain(input).assess();
    assert.ok(assessment.questions.length > 0);
    assert.equal(lookupLegalEvidence(input).citations.some(citation => citation.kind === "waste-code"), false);
    if (polymer.includes("포장재")) assert.ok(assessment.questions.some(question => question.includes("구성 재질")));
  }
});

test("material hazards remain held even when a different field denies contact", async () => {
  const wood = cases.find(item => item.input.caseId === "synthetic-raw-wood")?.input;
  assert.ok(wood);
  for (const contamination of ["도료 있음", "방부처리 의심", "오일 접촉 미확인", "기름 오염", "painted wood"]) {
    const decision = await createResourceDomain({ ...wood, description: "유해물질 없음", contamination }).decide();
    assert.equal(decision.state, "needs-review");
    assert.ok(hostVerificationOrder(decision).safety.some(reason => reason.includes("도료")));
  }
  const describedRisk = { ...wood, description: "오일 접촉 의심", contamination: "없음" };
  const reviewed = createResourceDomain(describedRisk, syntheticReviewed(describedRisk));
  assert.equal(reviewed.assess().routes.some(route => route.eligibility.state === "eligible"), false);
  assert.equal((await reviewed.decide()).state, "needs-review");
});

test("negated clean histories and reported coating do not open a clean material route", async () => {
  for (const [caseId, description] of [
    ["synthetic-raw-wood", "무처리 여부 미확인"],
    ["synthetic-raw-wood", "무처리 원목이 아님"],
    ["synthetic-paper", "무코팅 아님"],
    ["synthetic-paper", "무코팅 신고와 달리 PP 코팅 있음"],
  ] as const) {
    const input = cases.find(item => item.input.caseId === caseId)?.input;
    assert.ok(input);
    const changed = { ...input, description };
    assert.equal(lookupLegalEvidence(changed).citations.some(item => item.kind === "waste-code"), false);
    assert.notEqual((await createResourceDomain(changed).decide()).state, "compared");
  }
});

test("new material cases and unknown packaging pass the real app boundary and preserve reported input", async () => {
  const origin = "http://localhost:3000";
  const app = createResourceApp({ origin, actorForRequest: async () => "material-test", runner: async () => ({}) });
  try {
    for (const input of [...cases.map(item => item.input),
      { ...syntheticCase, polymer: "복합 포장재", description: "구성 미확인 포장재" }]) {
      const { caseId: _caseId, ...body } = input;
      const created = await app.fetch(new Request(origin + "/cases", { method: "POST",
        headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) }));
      assert.equal(created.status, 303, input.polymer ?? "");
      const path = created.headers.get("location");
      assert.ok(path);
      const page = await app.fetch(new Request(origin + path));
      assert.equal(page.status, 200);
      assert.doesNotMatch(await page.text(), /data-out-of-scope/);
      const exported = await app.fetch(new Request(origin + path + "/input"));
      const saved: unknown = await exported.json();
      assert.ok(saved && typeof saved === "object" && "polymer" in saved);
      assert.equal(saved.polymer, input.polymer);
    }
  } finally { app.dispose(); }
});
