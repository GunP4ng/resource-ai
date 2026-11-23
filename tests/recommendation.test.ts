import assert from "node:assert/strict";
import { test } from "node:test";
import { createResourceDomain } from "../src/domain.ts";
import { parseDecision } from "../src/o-decision.ts";
import { syntheticCase, syntheticReviewed } from "./h-fixtures.ts";
import { renderReport } from "../src/report.ts";
import { lookupLegalEvidence } from "../src/evidence.ts";
import { assessCase } from "../src/assessment.ts";
import { recommend, recommendationBlockers } from "../src/recommendation.ts";
import { safetyReasons } from "../src/o-safety-reasons.ts";
import { materialQuestions, materialStream } from "../src/material-context.ts";
import { createSyntheticResourceApp } from "./synthetic-runtime.ts";
import h008 from "../data/h-candidates/2026-11-12/inputs/HYEOB-20261112-008.json" with { type: "json" };

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

for (const polymer of ["PS", "ABS", "PC", "PA"] as const) {
  for (const [date, edition] of [["2026-11-10", "290881"], ["2026-11-25", "291947"]] as const) {
    test(`${polymer} unsoiled injection scrap receives conditional ${edition} public-law citations`, async () => {
      const input = { ...syntheticCase, polymer, assessmentDate: date };
      const result = await createResourceDomain(input).decide();
      assert.equal(result.state, "compared");
      if (result.state !== "compared") throw new Error(JSON.stringify(result));
      assert.equal(result.recommendations?.[0]?.routeId, "mechanical-recycling");
      assert.equal(result.recommendations?.[0]?.grade, "public-conditional");
      assert.deepEqual(result.recommendations?.[0]?.legalCitations.map(citation => citation.sourceId).sort(), [
        `legal-${edition}-annex4-2-r3-3`, `legal-${edition}-annex4-3-types`,
        `legal-${edition}-annex4-code`, `legal-${edition}-annex5-3-common`,
      ]);
      for (const citation of lookupLegalEvidence(input).citations
        .filter(item => item.sourceId.startsWith(`legal-${edition}`))) {
        assert.ok(citation.originalSha256 && citation.quote && citation.locator);
      }
    });
  }
}

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

for (const [name, patch, state] of [
  ["PVC exclusion", { polymer: "PVC" }, "needs-review"],
  ["metal with an unconfirmed origin", { polymer: "steel" }, "needs-information"],
  ["oil-contaminated material", { contamination: "폐유 혼합" }, "needs-review"],
  ["negated process", { process: "사출 아님" }, "needs-review"],
] as const) {
  for (const date of ["2026-11-10", "2026-11-13", "2026-11-25"] as const) {
    test(`${name} cannot borrow a plastics citation on ${date}`, async () => {
      const input = { ...syntheticCase, ...patch, assessmentDate: date };
      const evidence = lookupLegalEvidence(input, undefined, { includeWeakContext: true });
      assert.equal(evidence.citations.some(citation => citation.kind === "waste-code"), false);
      const result = await createResourceDomain(input).decide();
      assert.equal(result.state, state);
      if (result.state === "needs-information") {
        assert.ok(result.questions.some(question => question.includes("사업장일반폐기물")));
      }
      assert.equal("recommendations" in result, false);
    });
  }
}

const originBindingCases = [
  ["late English denial with a determiner", "Industrial general waste, laser deburring, the classification is denied", "needs-review"],
  ["late English denial with a possessive", "Industrial general waste, laser deburring, its classification is denied", "needs-review"],
  ["late English denial of final classification", "Industrial general waste, laser deburring, its final classification is denied", "needs-review"],
  ["late English denial about a classification audit", "Industrial general waste, laser deburring, its final classification audit is denied", "compared"],
  ["late English pending classification with a determiner", "Industrial general waste, laser deburring, the classification is pending", "needs-information"],
  ["late English pending classification without a determiner", "Industrial general waste, laser deburring, classification is pending", "needs-information"],
  ["late Korean applicability with a temporal modifier", "사업장일반폐기물, 자력 연마, 아직 해당 여부는 미확인", "needs-information"],
  ["late Korean applicability with current framing", "사업장일반폐기물, 자력 연마, 현재 해당 여부는 미확인", "needs-information"],
  ["Korean pickup before applicability", "사업장일반폐기물 (수거 대기 및 해당 여부 미확인), 금속 절단", "needs-information"],
  ["Korean applicability before pickup", "사업장일반폐기물 (해당 여부 미확인 및 수거 대기), 금속 절단", "needs-information"],
  ["English pickup before classification", "Industrial general waste (pickup pending and the classification is denied), laser deburring", "needs-review"],
  ["English classification before pickup", "Industrial general waste (the classification is denied and pickup pending), laser deburring", "needs-review"],
  ["English denial after a pickup update", "Industrial general waste (pickup scheduled and the classification is denied), laser deburring", "needs-review"],
  ["English denial before unfamiliar logistics and independent confirmation", "Industrial general waste (its classification is denied and dispatch moves to Friday and pickup confirmed), laser deburring", "needs-review"],
  ["English confirmation beside unfamiliar logistics and independent uncertainty", "Industrial general waste (its classification is confirmed and dispatch moves to Friday and pickup pending), laser deburring", "compared"],
  ["English pickup update with no category answer", "Industrial general waste (pickup scheduled and shift unknown), laser deburring", "compared"],
  ["Korean uncertainty after a pickup update", "사업장일반폐기물 (수거 예정 및 해당 여부 미확인), 금속 절단", "needs-information"],
  ["Korean pickup update with no category answer", "사업장일반폐기물 (수거 예정 및 교대 미확인), 금속 절단", "compared"],
  ["Korean independent confirmation beside a framed denial", "사업장일반폐기물 (수거 확인 및 현재로서는 해당 여부는 비해당), 금속 절단", "needs-review"],
  ["compound answer to one category subject remains unresolved", "Industrial general waste (classification: confirmed and denied), laser deburring", "needs-information"],
  ["a classification mention inside another subject is not an answer", "Industrial general waste (pickup scheduled and optical classification sorting), laser deburring", "compared"],
  ["coordinated pickup and shift", "Industrial general waste (awaiting pickup and shift unknown), laser deburring", "compared"],
  ["coordinated origin pending and unconfirmed", "Industrial general waste (pickup scheduled and classification is pending and unconfirmed), laser deburring", "needs-information"],
  ["coordinated origin pending and unconfirmed without pickup", "Industrial general waste (classification pending and unconfirmed), laser deburring", "needs-information"],
  ["coordinated origin pending beside pickup", "Industrial general waste (pickup scheduled and classification pending), laser deburring", "needs-information"],
  ["coordinated origin denial before independent statuses", "Industrial general waste (pickup scheduled and classification is denied and shift pending and unconfirmed), laser deburring", "needs-review"],
  ["coordinated origin condition with only independent statuses", "Industrial general waste (awaiting pickup and unconfirmed and shift pending), laser deburring", "compared"],
  ["coordinated origin verified and pending contradiction", "Industrial general waste (pickup scheduled and classification is verified and pending), laser deburring", "needs-information"],
  ["coordinated origin incomplete category predicate", "Industrial general waste (pickup scheduled and classification is pending external review and shift confirmed), laser deburring", "needs-information"],
  ["coordinated origin unrelated classification work", "Industrial general waste (pickup scheduled and classification audit scheduled), laser deburring", "compared"],
  ["coordinated origin continuation ends at unrelated work", "Industrial general waste (pickup scheduled and classification is denied and dispatch moves to Friday and unconfirmed), laser deburring", "needs-review"],
  ["coordinated origin continuation before the declaration", "Classification is verified and pending, laser deburring, industrial general waste", "needs-information"],
  ["coordinated origin repeated confirmation before the declaration", "Classification is verified and confirmed, laser deburring, industrial general waste", "compared"],
  ["coordinated origin bare verified and pending answers", "Industrial general waste (verified and pending), laser deburring", "needs-information"],
  ["English source with required classification", "Steel scrap needs to be classified as industrial general waste", "needs-information"],
  ["English source with completed classification", "Steel scrap is classified as industrial general waste", "compared"],
  ["English obligation with an adverb before classification", "Steel scrap needs to be formally classified as industrial general waste", "needs-information"],
  ["English completed classification with the same adverb", "Steel scrap has been formally classified as industrial general waste", "compared"],
  ["English modal with adverbs around the passive perfect", "Steel scrap may already have been officially classified as industrial general waste", "needs-information"],
  ["English modal with never", "Steel scrap might never be classified as industrial general waste", "needs-information"],
  ["English passive obligation shared by coordinated predicates", "Steel scrap needs to be sorted and formally classified as industrial general waste", "needs-information"],
  ["English completed passive shared by coordinated predicates", "Steel scrap has been sorted and formally classified as industrial general waste", "compared"],
  ["English completed classification with its own auxiliary after a passive obligation", "Steel scrap needs to be sorted and has been formally classified as industrial general waste", "compared"],
  ["English completed classification with a modal elsewhere in the sentence", "Steel scrap that may need deburring has already been officially classified as industrial general waste", "compared"],
  ["English obligation with adverbs on both sides of the auxiliary", "Steel scrap must now be more formally classified as industrial general waste", "needs-information"],
  ["English completed classification with the same adverbs", "Steel scrap has now been more formally classified as industrial general waste", "compared"],
  ["English requirement in generating process", "Industrial general waste from steel scrap that needs to be deburred", "compared"],
  ["English modal in a standalone process", "Industrial general waste, steel scrap may need deburring", "compared"],
  ["English modal in the source of a completed classification", "Steel scrap that may need deburring is classified as industrial general waste", "compared"],
  ["English copular qualifier with an incomplete answer", "Industrial general waste is pending external review, laser deburring", "needs-information"],
  ["independent status awaiting pickup with a time", "Industrial general waste (status: awaiting pickup tomorrow), laser deburring", "compared"],
  ["category status awaiting verification", "Industrial general waste (status: awaiting verification tomorrow), laser deburring", "needs-information"],
  ["independent status pending pickup", "Industrial general waste (status: pending pickup), laser deburring", "compared"],
  ["Korean source with affirmative copula", "전해 연삭 공정에서 발생한 사업장일반폐기물입니다", "compared"],
  ["Korean source with completed classification", "전해 연삭 공정에서 발생한 사업장일반폐기물로 분류됨", "compared"],
  ["Korean source with completed confirmation", "전해 연삭 공정에서 발생한 사업장일반폐기물로 확인됨", "compared"],
  ["Korean source with confirmation still required", "전해 연삭 공정에서 발생한 사업장일반폐기물로 확인 필요", "needs-information"],
  ["Korean source with required classification", "전해 연삭 공정에서 발생한 사업장일반폐기물로 분류해야 합니다", "needs-information"],
  ["Korean requirement in generating process", "추가 연마가 필요한 전해 연삭 공정에서 발생한 사업장일반폐기물입니다", "compared"],
  ["English coordinated source with completed classification", "Steel scrap from cutting and grinding is classified as industrial general waste", "compared"],
  ["Korean coordinated source with affirmative copula", "절단 및 연삭 공정에서 발생한 사업장일반폐기물입니다", "compared"],
  ["Korean denial with an applicability particle", "사업장일반폐기물에 해당하지 않습니다, 금속 절단", "needs-review"],
  ["Korean denial without an applicability particle", "사업장일반폐기물 해당하지 않습니다, 금속 절단", "needs-review"],
  ["Korean denial with a compound applicability particle", "사업장일반폐기물에는 해당하지 않습니다, 금속 절단", "needs-review"],
  ["Korean affirmation with a compound classification particle", "사업장일반폐기물로는 분류되었습니다, 금속 절단", "compared"],
  ["Korean confirmation with stacked case particles", "사업장일반폐기물로서도 확인되었음, 금속 절단", "compared"],
  ["Korean uncertainty with a compound applicability particle", "사업장일반폐기물에도 해당 여부 미확인, 금속 절단", "needs-information"],
  ["English named qualifier before an intervening process", "The classification is pending, laser deburring, Industrial general waste", "needs-information"],
  ["Korean named qualifier before an intervening process", "아직 해당 여부는 미확인, 자력 연마, 사업장일반폐기물", "needs-information"],
  ["G034 aspect pending", "Industrial general waste (pickup scheduled and the classification remains pending), laser deburring", "needs-information"],
  ["G034 aspect pending without pickup", "Industrial general waste (the classification remains pending), laser deburring", "needs-information"],
  ["G034 perfect denial", "Industrial general waste (pickup scheduled and the classification has been denied), laser deburring", "needs-review"],
  ["G034 copular denial control", "Industrial general waste (pickup scheduled and the classification is denied), laser deburring", "needs-review"],
  ["G034 adversative denial", "Industrial general waste (pickup scheduled but the classification is denied), laser deburring", "needs-review"],
  ["G034 denial before independent shift", "Industrial general waste (the classification is denied but shift pending), laser deburring", "needs-review"],
  ["G034 adversative independent statuses", "Industrial general waste (pickup scheduled but shift unknown), laser deburring", "compared"],
  ["G034 Korean adversative uncertainty", "사업장일반폐기물 (수거 예정이나 해당 여부는 미확인), 금속 절단", "needs-information"],
  ["G034 Korean adversative independent statuses", "사업장일반폐기물 (수거 예정이나 교대 미확인), 금속 절단", "compared"],
  ["G034 shared passive obligation", "Steel scrap needs to be inspected and formally classified as industrial general waste", "needs-information"],
  ["G034 shared completed passive", "Steel scrap has been inspected and formally classified as industrial general waste", "compared"],
  ["G034 never classified", "Steel scrap has never been classified as industrial general waste", "needs-information"],
  ["G034 direct classification denial", "Steel scrap is not classified as industrial general waste", "needs-review"],
  ["G034 final classification with past perfect", "Industrial general waste (pickup scheduled and its final classification had already been denied), laser deburring", "needs-review"],
  ["G034 past aspect with an unfamiliar pending answer", "Industrial general waste (pickup scheduled and the classification remained with the reviewer), laser deburring", "needs-information"],
  ["G034 independent classification audit", "Industrial general waste (pickup scheduled but its final classification audit remains pending), laser deburring", "compared"],
  ["G034 shared auxiliary across several participles", "Steel scrap must be weighed and washed and formally classified as industrial general waste", "needs-information"],
  ["G034 local completed passive overrides a separate obligation", "Steel scrap needs to be weighed and has been formally classified as industrial general waste", "compared"],
  ["G034 local completed passive overrides an earlier prohibition", "Steel scrap must not be crushed and has already been formally classified as industrial general waste", "compared"],
  ["G034 never across a shared passive", "Steel scrap has never been weighed and formally classified as industrial general waste", "needs-information"],
  ["G034 not yet across a shared passive", "Steel scrap has not yet been weighed and formally classified as industrial general waste", "needs-information"],
  ["G034 not already in the perfect passive", "Steel scrap had not already been formally classified as industrial general waste", "needs-information"],
  ["G034 negative classification with a local completed auxiliary", "Steel scrap needs to be weighed and was not formally classified as industrial general waste", "needs-review"],
  ["G034 local completed passive after an unrelated source restriction", "Steel scrap that must not be crushed has been formally classified as industrial general waste", "compared"],
  ["G034 never classified in a shortened report", "Never been classified as industrial general waste", "needs-information"],
  ["G034 not yet classified in a shortened report", "Not yet been classified as industrial general waste", "needs-information"],
  ["G034 an alternative is not evidence of completed classification", "Steel scrap has been weighed or formally classified as industrial general waste", "needs-information"],
  ["G034 named classification has never been verified", "Industrial general waste (pickup scheduled but its final classification has never been verified), laser deburring", "needs-information"],
] as const;

const originPolarityCases = [
  ["negated classification subject", "No steel scrap has been classified as industrial general waste", "needs-review"],
  ["affirmative classification subject", "Steel scrap has been classified as industrial general waste", "compared"],
  ["negated subject shared with a local auxiliary", "No steel scrap has been inspected and has been formally classified as industrial general waste", "needs-review"],
  ["earlier negative source with its own subject", "No crushing was required and steel scrap has been classified as industrial general waste", "compared"],
  ["earlier negative source in a separate clause", "No crushing was required, steel scrap has been classified as industrial general waste", "compared"],
  ["earlier named denial still qualifies the classification", "Classification is denied, steel scrap has been classified as industrial general waste", "needs-review"],
  ["named classification framed before the link verb", "Industrial general waste (pickup scheduled but its final classification still remains pending), laser deburring", "needs-information"],
  ["confirmed classification with the same framing", "Industrial general waste (pickup scheduled but its final classification still remains confirmed), laser deburring", "compared"],
  ["denied classification with the same framing", "Industrial general waste (pickup scheduled but its final classification still remains denied), laser deburring", "needs-review"],
  ["source audit pending with the same framing", "Industrial general waste (pickup scheduled but its final classification audit still remains pending), laser deburring", "compared"],
  ["shared passive obligation with a locative adjunct", "Steel scrap needs to be inspected on site and formally classified as industrial general waste", "needs-information"],
  ["shared completed passive with a locative adjunct", "Steel scrap has been inspected on site and formally classified as industrial general waste", "compared"],
  ["shared passive denial with a locative adjunct", "Steel scrap has not been inspected on site and formally classified as industrial general waste", "needs-review"],
  ["shared passive still incomplete with a different locative adjunct", "Steel scrap has not yet been inspected at the facility and formally classified as industrial general waste", "needs-information"],
  ["classification has its own completed auxiliary after a locative adjunct", "Steel scrap needs to be inspected on site and has been formally classified as industrial general waste", "compared"],
] as const;

const originClauseCases = [
  ["coordinated source preserves the negative subject", "No steel scrap from cutting and grinding has been inspected and formally classified as industrial general waste", "needs-review"],
  ["coordinated source with an affirmative subject", "Steel scrap from cutting and grinding has been inspected and formally classified as industrial general waste", "compared"],
  ["coordinated source preserves the subject across a local auxiliary", "No steel scrap from cutting and grinding has been inspected and has been formally classified as industrial general waste", "needs-review"],
  ["a new subject ends the scope of the negated source", "No steel scrap from cutting and grinding has been inspected and other steel scrap has been formally classified as industrial general waste", "compared"],
  ["a gerund can begin a new subject after a complete predicate", "No steel scrap was removed from cutting and grinding waste has been formally classified as industrial general waste", "compared"],
  ["classification shares the embedded infinitive", "Steel scrap was sent to be inspected and formally classified as industrial general waste", "needs-information"],
  ["a locative adjunct ends before an embedded infinitive", "Steel scrap was sent from the facility to be inspected and formally classified as industrial general waste", "needs-information"],
  ["classification has its own finite passive after an infinitive", "Steel scrap was sent to be inspected and has been formally classified as industrial general waste", "compared"],
  ["classification shares a finite passive with a destination", "Steel scrap was sent to the facility and formally classified as industrial general waste", "compared"],
  ["named denial in the same clause as the declaration", "Classification is denied and steel scrap has been classified as industrial general waste", "needs-review"],
  ["unrelated denial in the same clause as the declaration", "Pickup is denied and steel scrap has been classified as industrial general waste", "compared"],
  ["classification audit denial does not qualify the declaration", "Classification audit is denied and steel scrap has been classified as industrial general waste", "compared"],
] as const;

type OriginCase = readonly [name: string, process: string, state: "compared" | "needs-information" | "needs-review"];

const originSubjectCases = [
  ["source noun under a negative subject", "No steel scrap from machining and assembly has been inspected and formally classified as industrial general waste", "needs-review"],
  ["source noun under an affirmative subject", "Steel scrap from machining and assembly has been inspected and formally classified as industrial general waste", "compared"],
  ["shared purpose with a complement", "Steel scrap was sent to be inspected for damage and formally classified as industrial general waste", "needs-information"],
  ["completed classification after a purpose with a complement", "Steel scrap was sent to be inspected for damage and has been formally classified as industrial general waste", "compared"],
  ["earlier coordinated answers conflict", "Classification is confirmed and denied and steel scrap has been classified as industrial general waste", "needs-information"],
  ["earlier coordinated affirmative answers", "Classification is confirmed and verified and steel scrap has been classified as industrial general waste", "compared"],
  ["punctuation after conflicting answers", "Classification is confirmed and denied, steel scrap has been classified as industrial general waste", "needs-information"],
  ["complete classification beside the declaration", "Classification is complete and steel scrap has been classified as industrial general waste", "compared"],
  ["confirmed classification beside the declaration", "Classification is confirmed and steel scrap has been classified as industrial general waste", "compared"],
  ["completed classification beside the declaration", "Classification is completed and steel scrap has been classified as industrial general waste", "compared"],
  ["new subject with a noun after a finished passive", "No steel scrap from machining and assembly has been inspected and salvage from the annex was classified as industrial general waste", "compared"],
  ["new negative subject after a finished passive", "Steel scrap from machining and assembly has been inspected but no salvage from the annex was classified as industrial general waste", "needs-review"],
  ["modifier on an intervening predicate leaves the subject unchanged", "No steel scrap from machining and assembly has been inspected and visually checked and has been formally classified as industrial general waste", "needs-review"],
  ["modifier before a local auxiliary leaves the subject unchanged", "No steel scrap from machining and assembly has been inspected and then has been formally classified as industrial general waste", "needs-review"],
  ["a status noun can also name a source", "No steel scrap from machining and collection and assembly has been inspected and formally classified as industrial general waste", "needs-review"],
  ["a noun spelled like a modal can also name a source", "No steel scrap from machining and can production and assembly has been inspected and formally classified as industrial general waste", "needs-review"],
  ["independent subject ends inherited classification status", "Classification is complete and pickup is confirmed and denied and steel scrap has been classified as industrial general waste", "compared"],
  ["earlier answer inherits through multiple predicates", "The classification has already been verified and still remains confirmed and was denied and steel scrap has been classified as industrial general waste", "needs-information"],
  ["adversative answer inherits classification subject", "Classification is complete but was denied and steel scrap has been classified as industrial general waste", "needs-information"],
] as const satisfies readonly OriginCase[];

const originSubjectMatrix: OriginCase[] = [];
for (const source of ["from fabrication and dispatch and quality control", "from stamping or assembly"]) {
  for (const complement of ["for hidden defects", "with a calibrated gauge"]) {
    for (const modifier of ["formally", "then independently"]) {
      const subject = `steel scrap ${source}`;
      const inspected = `been inspected ${complement}`;
      const classified = `${modifier} classified as industrial general waste`;
      const label = `${source}, ${complement}, ${modifier}`;
      originSubjectMatrix.push(
        [`negative shared subject (${label})`, `No ${subject} has ${inspected} and ${classified}`, "needs-review"],
        [`shared purpose (${label})`, `The ${subject} was brought in to be inspected ${complement} and ${classified}`, "needs-information"],
        [`local completion (${label})`, `The ${subject} was brought in to be inspected ${complement} but has been ${classified}`, "compared"],
      );
    }
  }
}

const originSteel = { ...syntheticCase, description: "합성 QA 강철 절단 스크랩", polymer: "철 스크랩",
  massKg: 180, region: "경기", assessmentDate: "2026-11-15" };

for (const [name, process, state] of [
  ["affirmed", "사업장일반폐기물, 금속 절단", "compared"],
  ["ordinary origin only", "공장 강철 절단 공정", "needs-information"],
  ["explicit negation", "사업장일반폐기물 아님, 공장 강철 절단 공정", "needs-review"],
  ["explicit unknown", "사업장일반폐기물 여부 미확인, 공장 강철 절단 공정", "needs-information"],
  ["conditional", "사업장일반폐기물인 경우, 공장 강철 절단 공정", "needs-information"],
  ["question", "공장 강철 절단 공정, 사업장일반폐기물인지 확인 중", "needs-information"],
  ["estimate", "공장 강철 절단 공정, 사업장일반폐기물로 추정", "needs-information"],
  ["structured unknown", "폐기물 분류 미상 (사업장일반폐기물 또는 생활폐기물), 공장 강철 절단", "needs-information"],
  ["English unknown", "industrial general waste classification unknown, steel cutting", "needs-information"],
  ["irrelevant context", "사업장 일반 안전교육을 실시한 뒤 강철 절단", "needs-information"],
  ["historical wording without comma", "사업장일반폐기물 금속 절단", "compared"],
  ["unrelated Korean uncertainty", "사업장 일반 폐기물 금속 절단, 작업 시간 미확인", "compared"],
  ["unrelated English uncertainty", "Industrial General Waste from steel cutting (shift unknown)", "compared"],
  ["affirmative Korean classification", "금속 절단 공정에서 발생한 사업장일반폐기물로 분류됨", "compared"],
  ["affirmative English classification", "Steel cutting scrap classified as industrial general waste", "compared"],
  ["English partial category", "Industrial general safety training before steel cutting", "needs-information"],
  ["English category inside another word", "industrial general wastewater from steel cutting", "needs-information"],
  ["Korean category inside another word", "비사업장일반폐기물 금속 절단", "needs-information"],
  ["Korean category with an attached qualifier", "사업장일반폐기물여부 미확인, 금속 절단", "needs-information"],
  ["Korean category with an attached denial", "사업장일반폐기물이아님, 금속 절단", "needs-review"],
  ["Korean verification pending", "금속 절단, 사업장일반폐기물 해당 여부 확인 필요", "needs-information"],
  ["Korean question about denial", "사업장일반폐기물이 아닌지 확인 중, 금속 절단", "needs-information"],
  ["Korean question punctuation", "금속 절단, 사업장일반폐기물?", "needs-information"],
  ["Korean alternative before the category", "생활폐기물 또는 사업장일반폐기물, 금속 절단", "needs-information"],
  ["English conditional prefix", "If classified as industrial general waste, steel cutting", "needs-information"],
  ["English uncertain prefix", "Possibly industrial general waste, steel cutting", "needs-information"],
  ["English parenthetical uncertainty", "Industrial general waste (unconfirmed), steel cutting", "needs-information"],
  ["English confirmation pending", "Industrial general waste classification is not confirmed, steel cutting", "needs-information"],
  ["English explicit denial", "Not classified as industrial general waste, steel cutting", "needs-review"],
  ["legacy process-wide negation", "Industrial general waste, not steel cutting", "needs-review"],
  ["parenthesized before confirmation", "사업장일반폐기물 (확인 전), 금속 절단", "needs-information"],
  ["comma-separated origin uncertainty", "사업장일반폐기물, 여부 미확인", "needs-information"],
  ["Korean conditional prefix", "만약 사업장일반폐기물, 금속 절단", "needs-information"],
  ["before confirmation", "사업장일반폐기물 확인 전, 금속 절단", "needs-information"],
  ["Korean assumption", "사업장일반폐기물이라고 가정, 금속 절단", "needs-information"],
  ["punctuation and newline before the qualifier", "사업장일반폐기물; \n(확인 전)\n금속 절단", "needs-information"],
  ["punctuation and newline after the conditional prefix", "만약, \r\n사업장일반폐기물, 금속 절단", "needs-information"],
  ["Korean alternative after the category", "사업장일반폐기물 또는 생활폐기물", "needs-information"],
  ["independently named job-time uncertainty", "사업장일반폐기물, 금속 절단 시간 미확인", "compared"],
  ["job-time uncertainty on a later line", "사업장일반폐기물, 금속 절단 시간:\n미확인", "compared"],
  ["polite Korean denial", "사업장일반폐기물이 아닙니다, 금속 절단", "needs-review"],
  ["reported Korean denial", "사업장일반폐기물이 아니라고 확인됨, 금속 절단", "needs-review"],
  ["adjacent Korean applicability uncertainty", "사업장일반폐기물, 해당 여부 미확인, 금속 절단", "needs-information"],
  ["adjacent Korean classification pending", "사업장일반폐기물, 분류 확인 전, 금속 절단", "needs-information"],
  ["adjacent English classification unknown", "industrial general waste, classification unknown, steel cutting", "needs-information"],
  ["English classification reported as unknown", "industrial general waste classified as unknown, metal cutting", "needs-information"],
  ["Korean confirmation missing", "사업장일반폐기물 확인되지 않음, 금속 절단", "needs-information"],
  ["adjacent English confirmation missing", "industrial general waste, not yet confirmed, steel cutting", "needs-information"],
  ["independent pending pickup", "Industrial general waste (pending pickup), steel cutting", "compared"],
  ["independent pickup pending", "Industrial general waste (pickup pending), steel cutting", "compared"],
  ["separate unknown classification", "사업장일반폐기물, 분류 미상, 금속 절단", "needs-information"],
  ["separate undetermined classification", "사업장일반폐기물, 분류 불명, 금속 절단", "needs-information"],
  ["separate estimate", "사업장일반폐기물, 추정, 금속 절단", "needs-information"],
  ["particle before a parenthesized estimate", "사업장일반폐기물로 (추정), 금속 절단", "needs-information"],
  ["adjacent unconfirmed classification", "사업장일반폐기물 분류 미확인, 금속 절단", "needs-information"],
  ["adjacent unknown classification", "사업장일반폐기물 분류 미상, 금속 절단", "needs-information"],
  ["particle before a separate applicability qualifier", "사업장일반폐기물로, 여부 미확인, 금속 절단", "needs-information"],
  ["separate classification verification required", "사업장일반폐기물, 분류 확인 필요, 금속 절단", "needs-information"],
  ["independent Korean pickup pending", "산출 품목: 사업장일반폐기물(수거 대기), 금속 절단", "compared"],
  ["independent English pickup pending in the next clause", "Industrial general waste, pending pickup, steel cutting", "compared"],
  ["particle before independently named job-time uncertainty", "사업장일반폐기물은, 작업 시간 미상, 금속 절단", "compared"],
  ["round two Korean topic particle", "사업장일반폐기물, 해당 여부는 미확인, 금속 절단", "needs-information"],
  ["round two Korean polite uncertainty", "사업장일반폐기물, 분류 미상입니다, 금속 절단", "needs-information"],
  ["round two English answer before subject", "Industrial general waste (pending classification), steel cutting", "needs-information"],
  ["round two named status with answer first", "Industrial general waste (status: pending pickup), steel cutting", "compared"],
  ["round two named status with subject first", "Industrial general waste (status: pickup pending), steel cutting", "compared"],
  ["round two positive applicability answer", "사업장일반폐기물 해당 여부: 해당, 금속 절단", "compared"],
  ["unfamiliar English process", "industrial general waste, laser deburring", "compared"],
  ["unfamiliar Korean process in a separate clause", "사업장일반폐기물, 자력 연마", "compared"],
  ["unfamiliar Korean process in the declaration", "사업장일반폐기물 자력 연마", "compared"],
  ["named work time with polite uncertainty", "사업장일반폐기물, 작업 시간 미상입니다, 자력 연마", "compared"],
  ["normalized punctuation and continued answer", "사업장일반폐기물（해당 여부：\r\n 해당입니다），자력 연마", "compared"],
  ["negative applicability answer", "사업장일반폐기물 해당 여부: 비해당, 금속 절단", "needs-review"],
  ["negative English applicability answer", "industrial general waste (applicability: no), steel cutting", "needs-review"],
  ["positive English applicability answer", "industrial general waste (applicability: yes), steel cutting", "compared"],
  ["mixed applicability answer", "사업장일반폐기물 해당 여부: 해당 / 비해당, 금속 절단", "needs-information"],
  ["conflicting labeled answers", "industrial general waste (applicability: yes), applicability: no, steel cutting", "needs-information"],
  ["unknown wording in a category-linked answer", "사업장일반폐기물 해당 여부: 담당자 검토로 넘김, 자력 연마", "needs-information"],
  ["direct mention without declaration", "Discussed industrial general waste during training, laser deburring", "needs-information"],
  ["named pickup does not answer category status", "Industrial general waste (classification: pickup pending), steel cutting", "needs-information"],
  ["named work time ends bare qualifier attachment", "사업장일반폐기물, 작업 시간: 미상, 확인 전, 자력 연마", "compared"],
  ["affirmative English classification with a copula", "Steel cutting scrap is classified as industrial general waste", "compared"],
  ["uncertain attribution in a classification declaration", "Steel cutting scrap may be classified as industrial general waste", "needs-information"],
  ["late explicit category qualifier", "industrial general waste, laser deburring, classification status: deferred to inspector", "needs-information"],
  ["unanswered category qualifier", "사업장일반폐기물, 해당 여부:, 자력 연마", "needs-information"],
  ["attached Korean polite copula", "사업장일반폐기물입니다, 자력 연마", "compared"],
  ["explicit English denial with a copula", "Steel cutting scrap is not classified as industrial general waste", "needs-review"],
  ["independent Korean work time label", "사업장일반폐기물, 작업 시간: 추가 확인 대기, 자력 연마", "compared"],
  ["ambiguous English status without an independent subject", "industrial general waste (status: needs supervisor signoff), laser deburring", "needs-information"],
  ["Korean uncertainty with a predicate modifier", "사업장일반폐기물 아직 미확인, 자력 연마", "needs-information"],
  ["Korean indirect category question", "사업장일반폐기물 맞는지 확인 중, 자력 연마", "needs-information"],
  ["unresolved answer about pickup alone", "Industrial general waste (pickup awaiting supervisor), laser deburring", "compared"],
  ["English copular denial conflicts with a positive answer", "industrial general waste is not applicable, applicability: yes, laser deburring", "needs-information"],
  ["the category itself as an answer label", "industrial general waste: no, laser deburring", "needs-review"],
  ["unfamiliar process with an incidental classification noun", "industrial general waste, optical classification sorting", "compared"],
  ["G034 shared obligation across a hyphenated participle", "Steel scrap must be re-weighed and formally classified as industrial general waste", "needs-information"],
  ["G034 shared obligation with a trailing participle modifier", "Steel scrap must be washed thoroughly and then formally classified as industrial general waste", "needs-information"],
  ["G034 explicit adversative denial beside the category", "Industrial general waste but the classification is denied, laser deburring", "needs-review"],
  ["G034 Korean explicit adversative denial beside the category", "사업장일반폐기물이나 해당 여부는 비해당, 금속 절단", "needs-review"],
  ["G034 punctuation leaves an independent Korean status independent", "사업장일반폐기물 (수거 예정, 미확인), 금속 절단", "compared"],
  ...originBindingCases,
  ...originPolarityCases,
  ...originClauseCases,
  ...originSubjectCases,
  ...originSubjectMatrix,
] as const) {
  test(`reported process category: ${name}`, async () => {
    const input = { ...originSteel, process };
    const original = structuredClone(input);
    const confirmed = state === "compared";
    const asksOrigin = (questions: readonly string[]) =>
      questions.some(question => question.startsWith("발생 공정 입력란에 사업장일반폐기물"));
    assert.equal(asksOrigin(materialQuestions(input)), state === "needs-information", "origin question");
    assert.equal(materialStream(input), confirmed ? "ferrous" : null);

    for (const includeWeakContext of [false, true]) {
      const lookup = lookupLegalEvidence(input, undefined, { includeWeakContext });
      const ferrousCitations = lookup.citations.filter(citation => citation.sourceId.startsWith("legal-291947-metal-iron-"));
      assert.equal(ferrousCitations.length > 0, confirmed, `ferrous citations (weak context: ${includeWeakContext})`);
      const wasteCodes = lookup.citations.filter(citation => citation.kind === "waste-code").map(citation => citation.locator);
      assert.deepEqual(wasteCodes, confirmed ? ["별표4 제2호 51-29-01, PDF 10쪽"] : []);
    }

    const domain = createResourceDomain(input);
    const result = await domain.decide();
    assert.equal(result.state, state);
    assert.deepEqual(input, original);
    assert.equal((await domain.assessRoutes(input)).find(route => route.route === "mechanical-recycling")?.eligibility.state, "unknown");
    if (result.state === "compared") {
      assert.equal(result.humanApproval, "pending");
      assert.deepEqual(result.recommendations?.map(({ routeId, rank, grade }) => ({ routeId, rank, grade })),
        [{ routeId: "mechanical-recycling", rank: 1, grade: "public-conditional" }]);
    } else {
      assert.equal("recommendations" in result, false);
      assert.ok(result.evidence.every(record => !record.sourceId.startsWith("legal-291947-metal-iron-")));
      if (result.state === "needs-information") assert.ok(asksOrigin(result.questions));
      assert.ok(result.conditionalAlternatives?.some(alternative => alternative.routeId === "disposal"));
      for (const alternative of result.conditionalAlternatives ?? []) {
        assert.equal(alternative.state, "informational");
        assert.equal(alternative.executable, false);
        assert.equal("rank" in alternative, false);
        assert.ok(alternative.citations.every(citation => citation.scope === "general-requirement"));
      }
    }
  });
}

async function assertNativeOriginBinding(cases: readonly OriginCase[]) {
  const origin = "http://localhost:3000";
  const app = createSyntheticResourceApp({ origin });
  try {
    const cookie = (await app.fetch(new Request(origin))).headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    for (const [name, process, state] of cases) {
      const input = { ...originSteel, process };
      const fields = { description: input.description, polymer: input.polymer!, process,
        contamination: input.contamination!, hazardousContact: input.hazardousContact, massKg: String(input.massKg),
        region: input.region!, assessmentDate: input.assessmentDate! };
      const submitted = await app.fetch(new Request(origin + "/cases", { method: "POST",
        headers: { cookie, origin, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields) }));
      assert.equal(submitted.status, 303, name);
      const location = submitted.headers.get("location");
      assert.ok(location, name);
      const exported = await app.fetch(new Request(origin + location + "/input", { headers: { cookie } }));
      assert.equal(exported.status, 200, name);
      assert.deepEqual(await exported.json(), { ...input, caseId: location.split("/").at(-1) }, name);
      const page = await app.fetch(new Request(origin + location, { headers: { cookie } }));
      assert.equal(page.status, 200, name);
      const html = await page.text();
      assert.equal(html.includes("<h3>1순위 · 기계적 재활용</h3>"), state === "compared", name);
      if (state === "needs-information") assert.match(html, /<h1>추가 정보 필요<\/h1>/u, name);
      if (state === "needs-review") assert.match(html, /<h1>검토 필요<\/h1>/u, name);
    }
  } finally {
    await app.close();
  }
}

test("native origin binding preserves raw input and gates the ranked route", async () => {
  await assertNativeOriginBinding(originBindingCases);
});

for (const originCase of [...originPolarityCases, ...originClauseCases, ...originSubjectCases]) {
  test(`native origin polarity: ${originCase[0]}`, async () => {
    await assertNativeOriginBinding([originCase]);
  });
}

test("separately reported contamination uncertainty preserves the confirmed process category", async () => {
  const input = { ...originSteel, process: "사업장일반폐기물, 오염 여부 미확인" };
  assert.deepEqual(materialQuestions(input), [safetyReasons.contaminationUnknown]);
  assert.equal(materialStream(input), "ferrous");
  const result = await createResourceDomain(input).decide();
  assert.equal(result.state, "needs-information");
  if (result.state !== "needs-information") throw new Error(JSON.stringify(result));
  assert.deepEqual(result.questions, [safetyReasons.contaminationUnknown]);
  assert.equal("recommendations" in result, false);
});

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

for (const massKg of [100, null]) {
  test(`exact and padded 미상 ask the same contamination question as 모름 with mass ${massKg}`, async () => {
    const input = { ...syntheticCase, assessmentDate: "2026-11-25", massKg };
    const control = await createResourceDomain({ ...input, contamination: "모름" }).decide();
    assert.equal(control.state, "needs-information");
    assert.ok(control.questions.includes(safetyReasons.contaminationUnknown));
    for (const contamination of ["미상", " 미상 "]) {
      const result = await createResourceDomain({ ...input, contamination }).decide();
      assert.equal(result.state, "needs-information", contamination);
      assert.deepEqual(result.questions, control.questions);
    }
  });
}

test("blank contamination, resolved prose and unsupported dates keep their own decision behavior", async () => {
  const input = { ...syntheticCase, assessmentDate: "2026-11-25", massKg: 100 };
  const blank = await createResourceDomain({ ...input, contamination: null }).decide();
  assert.equal(blank.state, "needs-information");
  assert.ok(blank.questions.some(question => question.includes("오염")));
  assert.ok(!blank.questions.includes(safetyReasons.contaminationUnknown));
  const resolved = await createResourceDomain({ ...input, contamination: "없음" }).decide();
  assert.equal(resolved.state, "compared");
  const prose = assessCase({ ...input, contamination: "초기 기록은 미상. 오염 없음 확인." });
  assert.ok(!prose.questions.includes(safetyReasons.contaminationUnknown));
  const unsupported = await createResourceDomain({ ...input, contamination: "미상", assessmentDate: "2026-09-30" }).decide();
  assert.equal(unsupported.state, "needs-review");
  assert.deepEqual(unsupported.conditionalAlternatives, []);
});

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

test("missing mass permits a qualitative route without invented numerical metrics", async () => {
  const result = await createResourceDomain({ ...syntheticCase, massKg: null }).decide();
  assert.ok(result.state === "compared");
  assert.ok(result.recommendations?.length);
  assert.ok(result.recommendations?.every(route => route.cost.value === null && route.carbon.value === null));
  assert.deepEqual(result.scenarios, []);
});

test("empty structured facts stay answerable even though the resin question mentions labels", async () => {
  const result = await createResourceDomain({ ...syntheticCase, process: null, polymer: null,
    contamination: null, hazardousContact: "unknown", massKg: null, region: null }).decide();
  assert.equal(result.state, "needs-information");
  if (result.state === "needs-information") assert.equal(result.questions.length, 5);
});

for (const [name, patch, state, routes] of [
  ["missing information", { polymer: null, contamination: null, hazardousContact: "unknown" }, "needs-information",
    ["mechanical-recycling", "other-recovery", "disposal"]],
  ["missing contamination", { contamination: null, hazardousContact: "unknown" }, "needs-information",
    ["mechanical-recycling", "other-recovery", "disposal"]],
  ["hazardous contact", { hazardousContact: "yes" }, "needs-review", ["disposal"]],
  ["mixed material", { polymer: "PP/PE 다층" }, "needs-review",
    ["mechanical-recycling", "other-recovery", "disposal"]],
  ["H008 oil residue unknown", { ...h008, hazardousContact: "no" }, "needs-information",
    ["mechanical-recycling", "other-recovery", "disposal"]],
] as const) {
  test(`conditional alternatives preserve ${name} hold and expose source-bounded route questions`, async () => {
    const input = { ...syntheticCase, ...patch };
    const original = structuredClone(input);
    const domain = createResourceDomain(input);
    const result = await domain.decide();
    assert.equal(result.state, state);
    assert.equal(result.caseId, input.caseId);
    assert.deepEqual(input, original);
    assert.equal("recommendations" in result, false);
    assert.deepEqual(result.conditionalAlternatives?.map(item => item.routeId), routes);
    for (const alternative of result.conditionalAlternatives ?? []) {
      assert.equal(alternative.state, "informational");
      assert.equal(alternative.executable, false);
      const supported = (name === "mixed material" || name === "missing contamination" || name === "H008 oil residue unknown")
        && alternative.routeId === "mechanical-recycling";
      assert.equal(alternative.support.state, supported ? "route-supported" : "unavailable");
      assert.equal(alternative.support.missingEvidence.length === 0, supported);
      assert.notDeepEqual(alternative.nextChecks, []);
      assert.equal("rank" in alternative || "eligibility" in alternative, false);
      assert.ok(alternative.citations.every(citation =>
        result.evidence.some(record => record.sourceId === citation.sourceId && record.locator === citation.locator)));
      if (!supported) assert.ok(alternative.citations.every(citation => citation.scope === "general-requirement"));
      if (name === "H008 oil residue unknown" && supported) {
        assert.equal(alternative.condition.code, "clean-separated");
        assert.deepEqual(alternative.citations.map(citation => citation.sourceId).sort(), [
          "legal-291947-annex4-2-r3-3", "legal-291947-annex4-3-types",
          "legal-291947-annex4-code", "legal-291947-annex5-3-common",
        ]);
      }
    }
    assert.deepEqual(parseDecision(result), result);
    assert.ok((await domain.assessRoutes(input)).every(route => route.eligibility.state === "unknown"));
  });
}

test("alternative parser preserves historical holds and rejects fabricated evidence, scope and execution", async () => {
  const result = await createResourceDomain({ ...syntheticCase, polymer: null }).decide();
  if (result.state === "compared") throw new Error("expected information hold");
  const { conditionalAlternatives, ...historical } = result;
  assert.deepEqual(parseDecision(historical), historical);
  assert.doesNotThrow(() => renderReport(historical, { mode: "offline" }));
  const alternative = conditionalAlternatives?.[0];
  assert.ok(alternative);
  for (const patch of [
    { executable: true }, { state: "eligible" }, { routeId: "incineration" }, { rank: 1 },
    { condition: { code: "hazard-classification", description: "forged route condition" } },
    { support: { state: "route-supported", missingEvidence: [] } },
    { citations: [] },
    { citations: alternative.citations.map(citation => ({ ...citation, sourceId: "forged" })) },
    { citations: alternative.citations.map(citation => ({ ...citation, locator: "invented locator" })) },
    { citations: alternative.citations.map(citation => ({ ...citation, claim: "incineration licensed" })) },
    { citations: alternative.citations.map(citation => ({ ...citation, quote: "invented quotation" })) },
    { citations: alternative.citations.map(citation => ({ ...citation, scope: "route-specific" })) },
  ]) assert.throws(() => parseDecision({ ...result, conditionalAlternatives: [{ ...alternative, ...patch }] }));
  assert.throws(() => parseDecision({ ...result, evidence: result.evidence.map(record => ({ ...record, sha256: "0".repeat(64) })) }));
});

test("model alternative text cannot replace host route questions even with genuine registered citations", async () => {
  const domain = createResourceDomain({ ...syntheticCase, polymer: null });
  const expected = await domain.decide();
  if (expected.state === "compared") throw new Error("expected information hold");
  assert.ok(expected.conditionalAlternatives?.length);
  for (const proposal of [
    { ...expected, conditionalAlternatives: expected.conditionalAlternatives.map(item => ({ ...item, rationale: "execute invented route" })) },
    { ...expected, conditionalAlternatives: expected.conditionalAlternatives.map(item => ({ ...item, routeId: "disposal" })) },
    { ...expected, conditionalAlternatives: expected.conditionalAlternatives.map(item => ({ ...item, executable: true })) },
    { ...expected, conditionalAlternatives: expected.conditionalAlternatives.map(item => ({ ...item,
      citations: item.citations.map(citation => ({ ...citation, claim: "execute invented route" })) })) },
    { ...expected, caseId: "forged-case" },
    { ...expected, state: "compared", routes: [], processors: [], scenarios: [], limitations: [], humanApproval: "approved" },
  ]) {
    const actual = await domain.decide(proposal);
    assert.equal(actual.state, "needs-review");
    assert.equal(actual.caseId, expected.caseId);
    assert.deepEqual(actual.conditionalAlternatives, expected.conditionalAlternatives);
    assert.equal(JSON.stringify(actual).includes("execute invented route"), false);
  }
});

test("unsupported assessment period cannot fabricate a conditional alternative source", async () => {
  const result = await createResourceDomain({ ...syntheticCase, assessmentDate: "2026-09-30", polymer: null }).decide();
  assert.equal(result.state, "needs-review");
  assert.deepEqual(result.conditionalAlternatives, []);
});

for (const [name, patch, expected] of [
  ["unknown contact", { hazardousContact: "unknown" }, "needs-information"],
  ["unknown residue history", { contamination: "세척 완료, 이전 내용물·잔류물은 미확인" }, "needs-information"],
  ["mixed resin", { polymer: "PP/PE 다층" }, "needs-review"],
  ["conflicting label", { polymer: "PP (라벨 ABS와 불일치)" }, "needs-review"],
  ["hazardous contact", { hazardousContact: "yes" }, "needs-review"],
  ["unrecognized material needs confirmation", { polymer: "POM" }, "needs-information"],
] as const) {
  test(`optional mass does not bypass ${name}`, async () => {
    const result = await createResourceDomain({ ...syntheticCase, massKg: null, ...patch }).decide();
    assert.equal(result.state, expected);
  });
}

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
