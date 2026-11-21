import registryJson from "../data/sources/evidence-candidates.json" with { type: "json" };
import type { CaseInput, ConditionalAlternative, EvidenceRecord } from "./contracts.ts";
import { loadEvidenceRegistry, lookupLegalEvidence } from "./evidence.ts";
import type { EvidenceLookup } from "./evidence.ts";
import { maskExplicitHazardDenial } from "./o-safety-reasons.ts";
import { canonical, requireValid } from "./o-validation.ts";
import { canonicalMaterial } from "./material-context.ts";

const registry = loadEvidenceRegistry(registryJson);
const recyclingFamilies = ["waste-rule-annex4-code", "waste-rule-annex4-2-r3-3",
  "waste-rule-annex4-3-types", "waste-rule-annex5-3-common"] as const;
const generalFamilies = ["waste-rule-article4-2", "waste-rule-annex5-3-common"] as const;
const registered = registry.candidates.filter(candidate => candidate.originalVerified && candidate.claimVerified
  && candidate.provenance !== undefined && !registry.issues.some(issue => issue.sourceId === candidate.record.sourceId));

/** Shared by the two host gates. Counterfactual lookup never changes assessed facts or routes. */
export function conditionalAlternatives(facts: CaseInput, legal: EvidenceLookup): {
  readonly alternatives: readonly ConditionalAlternative[];
  readonly evidence: readonly EvidenceRecord[];
} {
  const general = registered.filter(candidate => generalFamilies.some(family => family === candidate.versionFamily)
    && legal.evidence.some(record => canonical(record) === canonical(candidate.record)));
  const cite = (candidates: typeof registered): ConditionalAlternative["citations"] => candidates.flatMap(candidate =>
    candidate.provenance === undefined ? [] : [{
      sourceId: candidate.record.sourceId, locator: candidate.record.locator,
      claim: candidate.claim, quote: candidate.provenance.quote,
      scope: generalFamilies.some(family => family === candidate.versionFamily) ? "general-requirement" : "route-specific",
    }]);
  const classification = general.filter(candidate => candidate.versionFamily === "waste-rule-article4-2");
  const recycling = general.filter(candidate => candidate.versionFamily === "waste-rule-annex5-3-common");
  const alternatives: ConditionalAlternative[] = [];
  const evidence = new Map(legal.evidence.map(record => [record.sourceId, record]));
  const hazard = facts.hazardousContact === "yes"
    || /지정폐기물\s*(?:의심|가능)|유해물질\s*접촉\s*의심|(?:suspected|confirmed)\s+hazardous/iu.test(
      [facts.description, facts.contamination].map(maskExplicitHazardDenial).join(" "));
  if (!hazard && recycling.length > 0) {
    // Only explicitly reported components are hypotheses; missing resin is never guessed.
    const reported = canonicalMaterial(facts.polymer);
    const materials = reported === null
      ? [...new Set((facts.polymer ?? "").normalize("NFKC").toUpperCase().match(/\b(?:HDPE|LDPE|PET|PP|PE)\b/gu) ?? [])]
      : [reported];
    const supported = materials.flatMap(polymer => {
      const hypothesis = lookupLegalEvidence({ ...facts, polymer, contamination: "없음", hazardousContact: "no" },
        undefined, { includeWeakContext: true });
      const candidates = registered.filter(candidate => recyclingFamilies.some(family => family === candidate.versionFamily)
        && hypothesis.evidence.some(record => canonical(record) === canonical(candidate.record)));
      return recyclingFamilies.every(family => candidates.some(candidate => candidate.versionFamily === family))
        ? [{ polymer, candidates }] : [];
    });
    const sources = [...new Map(supported.flatMap(item => item.candidates).map(candidate =>
      [candidate.record.sourceId, candidate])).values()];
    for (const source of sources) evidence.set(source.record.sourceId, source.record);
    const missing = supported.length ? [] : [
      "확인된 단일 수지·발생 공정 조건에 연결되는 분류·R-3-3 유형·유형별 기준 인용 묶음이 없습니다.",
    ];
    alternatives.push({
      routeId: "mechanical-recycling", title: "깨끗한 수지로 분리·확인되는 경우 원료 재활용 검토",
      state: "informational", executable: false,
      condition: { code: "clean-separated", description:
        `${supported.length ? supported.map(item => item.polymer).join(" 또는 ") : "재질이 확인된 단일 수지"}로 분리되고 오염·유해물질 접촉이 없다는 자료가 확보되는 경우의 가정입니다. 현재 사실로 확정하지 않았습니다.` },
      rationale: supported.length
        ? "등록된 분류·R-3-3 원료물질 제조·재활용 유형·공통기준의 조건부 연결입니다. 발생 공정은 처리 공정이 아니며 실제 적합성·허가·인수는 미확인입니다."
        : "등록된 일반 재활용 기준은 유형과 세부기준 확인을 요구합니다. 이 사례의 구체적인 원료 재활용 가능성을 증명하지 않습니다.",
      nextChecks: [
        "재질 명세·층별 구성과 수지별 분리 시험 결과를 확보하고 라벨 불일치를 해소하세요.",
        "이전 내용물·SDS·잔류물 시험·세척 검증 자료로 오염 및 유해물질 접촉 여부와 사업장일반폐기물 분류를 확인하세요.",
        "분리된 수지에 적용할 실제 처리 공정·산출물 용도·R-3-3 세부기준·현행 허가 범위·업체 인수 조건을 확인하세요.",
      ],
      support: { state: supported.length ? "route-supported" : "unavailable", missingEvidence: missing },
      citations: cite(supported.length ? sources : recycling),
    });
    alternatives.push({
      routeId: "other-recovery", title: "오염이 남거나 분리되지 않는 경우 다른 회수 방식 확인",
      state: "informational", executable: false,
      condition: { code: "contaminated-or-inseparable", description: "오염 제거 또는 층별·수지별 분리가 입증되지 않는 경우입니다." },
      rationale: "일반 재활용 기준만 등록되어 있으며 이 물질에 적용할 다른 회수 방식의 개별 근거는 없습니다.",
      nextChecks: ["오염 물질·함량과 분리 시험 결과를 확인한 뒤 구체적인 회수 방식·생산물·해당 유형 및 세부기준과 업체 허가를 확인하세요. 에너지 회수 가능성은 확인되지 않았습니다."],
      support: { state: "unavailable", missingEvidence: ["해당 물질·오염 상태의 다른 회수 방식과 허용 유형·시설 허가를 연결하는 등록 근거 없음"] },
      citations: cite(recycling),
    });
  }
  if (classification.length > 0) alternatives.push({
    routeId: "disposal", title: hazard ? "유해 접촉의 분류 확인 후 처분 경로 문의" : "재활용 조건을 충족하지 못하는 경우 처분 경로 문의",
    state: "informational", executable: false,
    condition: { code: hazard ? "hazard-classification" : "contaminated-or-inseparable", description: hazard
      ? "유해물질 접촉이 보고되거나 의심되어 분류·시험 검토가 먼저 필요한 경우입니다. 지정폐기물로 확정하지 않습니다."
      : "오염·분리·재활용 기준을 충족하는 경로가 확인되지 않는 경우입니다." },
    rationale: "등록 조문은 세부분류를 별표 4에 따르도록 할 뿐 이 사례의 지정폐기물 해당 여부나 특정 처분 방식·소각 허가를 입증하지 않습니다.",
    nextChecks: ["접촉 물질명·SDS·잔류량·시험 결과와 발생 공정을 제공하여 분류를 확인하고, 분류에 맞는 처분 방식의 개별 기준 및 업체 허가 범위·실제 인수 여부를 관할기관과 업체에 확인하세요."],
    support: { state: "unavailable", missingEvidence: ["사례별 유해성 분류와 처분 방식·시설 허가·인수 조건의 등록 근거 없음"] },
    citations: cite(classification),
  });
  return structuredClone({ alternatives, evidence: [...evidence.values()] });
}

/** Persistence boundary: embedded evidence alone cannot mint a registered citation. */
export function assertAlternativeCitations(alternatives: readonly ConditionalAlternative[], evidence: readonly EvidenceRecord[]): void {
  for (const alternative of alternatives) {
    const expectedCondition = alternative.routeId === "mechanical-recycling" ? ["clean-separated"]
      : alternative.routeId === "other-recovery" ? ["contaminated-or-inseparable"]
        : alternative.routeId === "reuse" ? ["reuse-purpose"] : ["hazard-classification", "contaminated-or-inseparable"];
    requireValid(expectedCondition.includes(alternative.condition.code), "alternative-condition-route-mismatch");
    const bound = alternative.citations.map(citation => {
      const candidate = registered.find(item => item.record.sourceId === citation.sourceId
        && item.record.locator === citation.locator && item.claim === citation.claim && item.provenance?.quote === citation.quote);
      requireValid(candidate !== undefined && evidence.some(record => canonical(record) === canonical(candidate.record)),
        "alternative-citation-unregistered");
      const general = generalFamilies.some(family => family === candidate.versionFamily);
      requireValid(citation.scope === (general ? "general-requirement" : "route-specific"), "alternative-citation-scope");
      requireValid(general || (alternative.routeId === "mechanical-recycling"
        && recyclingFamilies.some(family => family === candidate.versionFamily)), "alternative-citation-route-mismatch");
      requireValid(alternative.routeId !== "disposal" || candidate.versionFamily === "waste-rule-article4-2",
        "alternative-disposal-classification-only");
      return candidate;
    });
    const routeSupported = alternative.routeId === "mechanical-recycling"
      && recyclingFamilies.every(family => bound.some(candidate => candidate.versionFamily === family));
    requireValid(alternative.support.state === (routeSupported ? "route-supported" : "unavailable"), "alternative-support-mismatch");
    requireValid(routeSupported ? alternative.support.missingEvidence.length === 0 : alternative.support.missingEvidence.length > 0,
      "alternative-missing-evidence");
  }
}
