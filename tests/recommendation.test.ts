import assert from "node:assert/strict";
import { test } from "node:test";
import { createResourceDomain } from "../src/domain.ts";
import { parseDecision } from "../src/o-decision.ts";
import { syntheticCase, syntheticReviewed } from "./h-fixtures.ts";
import { renderReport } from "../src/report.ts";

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

for (const [name, patch] of [
  ["hazardous contact", { hazardousContact: "yes" }],
  ["designated waste suspicion", { description: "지정폐기물 의심 자투리" }],
  ["contradictory label", { polymer: "PP (라벨 ABS와 불일치)" }],
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
  assert.match(html, /미산정 \(null\)/u);
  assert.match(html, /실행 전 확인사항/u);
  assert.match(html, /href="#evidence-2"/u);
});
