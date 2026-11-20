import assert from "node:assert/strict";
import { test } from "node:test";
import { createResourceDomain } from "../src/domain.ts";
import { parseDecision } from "../src/o-decision.ts";
import { syntheticCase, syntheticReviewed } from "./h-fixtures.ts";
import { renderReport } from "../src/report.ts";
import { lookupLegalEvidence } from "../src/evidence.ts";
import { assessCase } from "../src/assessment.ts";
import { recommend, recommendationBlockers } from "../src/recommendation.ts";

test("complete safe facts produce a public-law conditional recommendation without field resources", async () => {
  const domain = createResourceDomain(syntheticCase);
  const result = await domain.decide();
  assert.equal(result.state, "compared");
  if (result.state !== "compared") throw new Error(JSON.stringify(result));
  assert.equal(result.humanApproval, "pending");
  assert.deepEqual(result.recommendations?.map(({ routeId, rank, grade }) => ({ routeId, rank, grade })),
    [{ routeId: "mechanical-recycling", rank: 1, grade: "public-conditional" }]);
  const route = result.routes.find(route => route.route === "mechanical-recycling");
  assert.equal(route?.eligibility.state, "conditional");
  assert.equal((await domain.assessRoutes(syntheticCase)).find(route => route.route === "mechanical-recycling")?.eligibility.state, "unknown");
  const recommendation = result.recommendations?.[0];
  assert.equal(recommendation?.cost.value, null);
  assert.equal(recommendation?.cost.label, "unavailable");
  assert.equal(recommendation?.carbon.value, null);
  assert.equal(recommendation?.carbon.label, "unavailable");
  assert.ok(recommendation?.cost.reasons.length);
  assert.ok(recommendation?.carbon.reasons.length);
  assert.equal(result.confidence?.level, "low");
  assert.ok(result.preExecutionChecks?.some(check => check.includes("허가")));
  assert.ok(result.preExecutionChecks?.some(check => check.includes("인수")));
  assert.ok(result.preExecutionChecks?.some(check => check.includes("견적")));
  assert.ok(result.preExecutionChecks?.some(check => check.includes("탄소")));
  assert.ok(result.preExecutionChecks?.some(check => check.includes("승인")));
  assert.equal(recommendation?.legalCitations.length, 4);
  for (const citation of recommendation?.legalCitations ?? []) {
    assert.ok(result.evidence.some(record => record.sourceId === citation.sourceId && record.locator === citation.locator && record.licenseVerified));
  }
  assert.deepEqual(await domain.decide(result), result);
});

test("presentation-day facts still use the effective legal edition after collection verification expires", async () => {
  const result = await createResourceDomain({ ...syntheticCase, assessmentDate: "2026-11-25" }).decide();
  assert.equal(result.state, "compared");
  if (result.state !== "compared") throw new Error(JSON.stringify(result));
  assert.deepEqual(result.recommendations?.[0]?.legalCitations.map(citation => citation.sourceId).sort(), [
    "legal-291947-annex4-2-r3-3", "legal-291947-annex4-3-types",
    "legal-291947-annex4-code", "legal-291947-annex5-3-common",
  ]);
});

test("a rejected citation and unverified metadata do not veto the remaining cited recommendation", () => {
  const current = assessCase(syntheticCase);
  const assessment = { ...current, legal: { ...current.legal,
    evidence: current.legal.evidence.map(record => ({ ...record, licenseVerified: false, license: null })),
    issues: [
      { kind: "out-of-period" as const, sourceId: "excluded-old-citation" },
      { kind: "reuse-unverified" as const, sourceId: "legal-290881-annex4-code" },
    ],
  } };
  assert.deepEqual(recommendationBlockers(syntheticCase, assessment), []);
  const result = recommend(syntheticCase, assessment);
  assert.equal(result.recommendations?.[0]?.grade, "public-conditional");
  assert.equal(result.recommendations?.[0]?.legalCitations.some(citation => citation.sourceId === "excluded-old-citation"), false);
  assert.ok(result.preExecutionChecks?.some(check => check.includes("reuse-unverified")));
  assert.ok(result.preExecutionChecks?.some(check => check.includes("excluded-old-citation")));
  assert.match(renderReport(result, { mode: "offline" }), /사용권 미확인 · 확인 아니오/u);
});

test("incomplete valid field reviews are advisory and never promoted to verified eligibility", async () => {
  const resources = syntheticReviewed(syntheticCase, review => ({ ...review,
    checks: review.checks.map(check => ({ ...check, state: "unknown" })) }));
  const result = await createResourceDomain(syntheticCase, { routeReviews: resources.routeReviews }).decide();
  assert.equal(result.state, "compared");
  if (result.state !== "compared") throw new Error(JSON.stringify(result));
  assert.equal(result.routes.find(route => route.route === "mechanical-recycling")?.eligibility.state, "conditional");
  assert.equal(result.recommendations?.[0]?.cost.value, null);
});

test("an unmet field permit check remains advisory while actual permit eligibility stays unverified", async () => {
  const resources = syntheticReviewed(syntheticCase, review => ({ ...review,
    checks: review.checks.map(check => check.requirement.includes("허가 범위")
      ? { ...check, state: "not-met", explanation: "현행 허가 유효성 확인 자료 없음" } : check) }));
  const result = await createResourceDomain(syntheticCase, { routeReviews: resources.routeReviews }).decide();
  assert.equal(result.state, "compared");
  if (result.state !== "compared") throw new Error(JSON.stringify(result));
  assert.equal(result.recommendations?.[0]?.grade, "public-conditional");
  assert.ok(result.preExecutionChecks?.some(check => check.includes("현행 허가 유효성 확인 자료 없음")));
});

test("an explicit designated-waste exclusion is not interpreted as hazardous suspicion", async () => {
  const result = await createResourceDomain({ ...syntheticCase, description: "지정폐기물 해당 없음, 일반 수지 자투리" }).decide();
  assert.equal(result.state, "compared");
});

test("verified but unrelated public citations remain advisory without granting strict route eligibility", async () => {
  const input = { ...syntheticCase, process: "결속밴드 분류", polymer: "PET" };
  const domain = createResourceDomain(input);
  const result = await domain.decide();
  assert.equal(result.state, "compared");
  if (result.state !== "compared") throw new Error(JSON.stringify(result));
  assert.equal(result.recommendations?.[0]?.grade, "public-conditional");
  assert.equal(result.recommendations?.[0]?.legalCitations.length, 4);
  assert.equal(result.confidence?.level, "low");
  assert.ok(result.confidence?.reasons.some(reason => reason.includes("관련성")));
  assert.ok(result.preExecutionChecks?.some(check => check.includes("관련성")));
  for (const requirement of lookupLegalEvidence(input, undefined, { includeWeakContext: true }).reviewRequirements) {
    assert.ok(result.preExecutionChecks?.includes(requirement), requirement);
  }
  assert.equal((await domain.assessRoutes(input)).find(route => route.route === "mechanical-recycling")?.eligibility.state, "unknown");
});

for (const [name, patch] of [
  ["PVC exclusion", { polymer: "PVC" }],
  ["nonplastic material", { polymer: "steel" }],
  ["oil-contaminated material", { contamination: "폐유 혼합" }],
  ["negated process", { process: "사출 아님" }],
] as const) {
  for (const date of ["2026-11-10", "2026-11-13"] as const) {
    test(`${name} cannot borrow a plastics citation on ${date}`, async () => {
      const input = { ...syntheticCase, ...patch, assessmentDate: date };
      const evidence = lookupLegalEvidence(input, undefined, { includeWeakContext: true });
      assert.equal(evidence.citations.some(citation => citation.kind === "waste-code"), false);
      const result = await createResourceDomain(input).decide();
      assert.equal(result.state, "needs-review");
      assert.equal("recommendations" in result, false);
    });
  }
}

for (const patch of [
  { hazardousContact: "unknown" },
  { contamination: "세척 완료, 이전 내용물·잔류물은 미확인" },
] as const) {
  test(`unresolved contact asks for information: ${JSON.stringify(patch)}`, async () => {
    const result = await createResourceDomain({ ...syntheticCase, process: "사용한 용기 세척·압축", ...patch }).decide();
    assert.equal(result.state, "needs-information");
    if (result.state !== "needs-information") throw new Error(JSON.stringify(result));
    assert.ok(result.questions.some(question => /접촉|이전 내용물/u.test(question)));
  });
}

test("hazard holds expose only blocking reasons and put field requirements in execution checks", async () => {
  const result = await createResourceDomain({ ...syntheticCase, hazardousContact: "yes" }).decide();
  assert.equal(result.state, "needs-review");
  if (result.state !== "needs-review") throw new Error(JSON.stringify(result));
  assert.ok(result.reasons.some(reason => reason.includes("유해물질")));
  assert.equal(result.reasons.some(reason => /현행 허가|승인 전|처리 공정·생산물|용도·방식/u.test(reason)), false);
  assert.ok(result.preExecutionChecks?.some(check => check.includes("허가")));
  assert.ok(result.preExecutionChecks?.some(check => check.includes("승인")));
  assert.deepEqual(parseDecision(result), result);
});

for (const [name, patch] of [
  ["hazardous contact", { hazardousContact: "yes" }],
  ["designated waste suspicion", { description: "지정폐기물 의심 자투리" }],
  ["contradictory label", { polymer: "PP (라벨 ABS와 불일치)" }],
  ["mixed resin", { polymer: "PP+PE" }],
  ["multilayer resin", { polymer: "PET/PE multilayer" }],
  ["suspected hazardous contact", { contamination: "유해물질 접촉 의심" }],
  ["conflicting labels reported outside an empty resin field",
    { description: "SYNTHETIC: conflicting labels for one lot, PP versus ABS.", polymer: null, massKg: null }],
] as const) {
  test(`${name} still blocks recommendations`, async () => {
    const result = await createResourceDomain({ ...syntheticCase, ...patch }).decide();
    assert.equal(result.state, "needs-review");
    assert.equal("recommendations" in result, false);
  });
}

test("a bound prohibited route review still blocks even with other public candidates", async () => {
  const resources = syntheticReviewed(syntheticCase, review => ({ ...review,
    checks: review.checks.map((check, index) => index === 0
      ? { ...check, state: "not-met", explanation: "해당 경로는 법령상 명백히 금지됨" } : check) }));
  const result = await createResourceDomain(syntheticCase, { routeReviews: resources.routeReviews }).decide();
  assert.equal(result.state, "needs-review");
  if (result.state === "needs-review") assert.ok(result.reasons.some(reason => reason.includes("금지")));
});

test("forged model citations remain blocked instead of downgraded to execution checks", async () => {
  const domain = createResourceDomain(syntheticCase);
  const result = await domain.decide();
  assert.equal(result.state, "compared");
  if (result.state !== "compared") throw new Error(JSON.stringify(result));
  const forged = { ...result, evidence: result.evidence.map(record => ({ ...record, sha256: "0".repeat(64) })) };
  const held = await domain.decide(forged);
  assert.equal(held.state, "needs-review");
  if (held.state === "needs-review") assert.ok(held.reasons.includes("proposal-evidence-conflict"));
});

test("missing essential mass remains a targeted question rather than an invented comparison", async () => {
  const result = await createResourceDomain({ ...syntheticCase, massKg: null }).decide();
  assert.equal(result.state, "needs-information");
  if (result.state === "needs-information") assert.deepEqual(result.questions, ["확인된 질량은 몇 kg인가요?"]);
});

test("empty structured facts stay answerable even though the resin question mentions labels", async () => {
  const result = await createResourceDomain({ ...syntheticCase, process: null, polymer: null,
    contamination: null, hazardousContact: "unknown", massKg: null, region: null }).decide();
  assert.equal(result.state, "needs-information");
  if (result.state === "needs-information") assert.equal(result.questions.length, 6);
});

test("a recommendation cannot claim an unknown or forbidden route or omit its checklist", async () => {
  const result = await createResourceDomain(syntheticCase).decide();
  assert.equal(result.state, "compared");
  if (result.state !== "compared") throw new Error(JSON.stringify(result));
  assert.throws(() => parseDecision({ ...result, preExecutionChecks: undefined }), /recommendation-checks-missing/);
  assert.throws(() => parseDecision({ ...result, recommendations: result.recommendations?.map(item => ({ ...item, routeId: "reuse" })) }),
    /recommendation-route-unresolved/);
});

test("reviewed calculation values remain labelled estimates rather than fabricated null or zero", async () => {
  const result = await createResourceDomain(syntheticCase, syntheticReviewed()).decide();
  assert.equal(result.state, "compared");
  if (result.state !== "compared") throw new Error(JSON.stringify(result));
  assert.equal(result.recommendations?.[0]?.cost.value, 240000);
  assert.equal(result.recommendations?.[0]?.carbon.value, 45);
  assert.equal(result.recommendations?.[0]?.cost.label, "assumption");
  assert.equal(result.recommendations?.[0]?.grade, "reviewed");
});

test("report consumes public grades, null reasons, citations and execution checks from server output", async () => {
  const result = await createResourceDomain(syntheticCase).decide();
  const html = renderReport(result, { mode: "offline" });
  assert.match(html, /공개 근거상 가능\(조건부\)/u);
  assert.match(html, /1순위 · 기계적 재활용/u);
  assert.match(html, /미산정 · 사례별 검증된 견적/u);
  assert.match(html, /미산정 · 동일 계산 경계/u);
  assert.match(html, /검증된 후보 없음/u);
  assert.doesNotMatch(html, /음의 순배출/u);
  assert.match(html, /실행 전 확인사항/u);
  assert.match(html, /href="#evidence-2"/u);
});
