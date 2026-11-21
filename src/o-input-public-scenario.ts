import type { ResearchTarget, VerifiedResearchCatalog } from "./o-case-research.ts";
import type { CaseResearchAttachment } from "./o-case-research-schema.ts";
import type { ImplementationReceipt } from "./o-public-calculation-data.ts";
import { buildPublicCalculations } from "./o-public-calculation-engine.ts";
import type { PublicCalculationBundle } from "./o-public-calculation-engine.ts";
import { requireData, required } from "./o-public-calculation-validation.ts";
import { date, revision } from "./o-validation.ts";
import type { CaseInput } from "./contracts.ts";

export interface PublicInputScenario {
  readonly version: 1;
  readonly purpose: "input-public-scenario";
  readonly label: "공개 자료 기반 계산값(관측값 아님)";
  readonly status: "시나리오 추정, 현장 미검증";
  readonly binding: CaseResearchAttachment["binding"];
  readonly material: "PET" | "HDPE";
  readonly userMassKg: number;
  readonly sourceCaseId: "OYS-20261110-001" | "OYS-20261110-002";
  readonly provenance: {
    readonly parentFixtureSha256: string;
    readonly parentManifestSha256: string;
    readonly parentOriginalSha256: string;
    readonly parentProvenanceSha256: string;
    readonly derivedDatasetSha256: string;
    readonly derivedProvenanceSha256: string;
    readonly implementation: ImplementationReceipt;
  };
  readonly assumptions: readonly string[];
  readonly calculations: Pick<PublicCalculationBundle,
    "model_version" | "sources" | "inputs" | "cases" | "routes" | "results" | "limitations">;
  readonly use: CaseResearchAttachment["use"];
}

/** Calculation coverage only; this does not assess route eligibility or safety. */
export function publicScenarioEligibility(input: CaseInput):
  | { readonly status: "available"; readonly material: "PET" | "HDPE"; readonly massKg: number }
  | { readonly status: "unavailable"; readonly reasons: readonly string[] } {
  const material = input.polymer?.trim().toUpperCase();
  const mass = input.massKg;
  const reasons = [
    ...(material !== "PET" && material !== "HDPE"
      ? [material ? `신고 수지 ${input.polymer}에 대응하는 공개 가격·탄소 계산 묶음이 없습니다. 현재 계산은 단일 PET·HDPE만 지원하며 다른 수지의 계수를 대신 넣지 않습니다.`
        : "수지가 미확인이라 공개 가격·탄소 계산 묶음을 연결하지 않았습니다. 재질을 추정하지 않습니다."] : []),
    ...(mass === null ? ["입력 질량이 없어 비용·탄소의 기능단위를 정할 수 없습니다. 정성 추천과 수치 비교는 별개입니다."]
      : !Number.isFinite(mass) || mass <= 0 ? ["공개 비교에는 0보다 큰 유한 질량(kg)이 필요합니다."] : []),
  ];
  if ((material !== "PET" && material !== "HDPE") || mass === null || !Number.isFinite(mass) || mass <= 0) {
    return { status: "unavailable", reasons };
  }
  return { status: "available", material, massKg: mass };
}

/** GET-only display projection; parent originals remain references, never target evidence. */
export function buildPublicInputScenario(target: ResearchTarget, catalog: VerifiedResearchCatalog): PublicInputScenario | null {
  const eligibility = publicScenarioEligibility(target.input);
  if (eligibility.status === "unavailable") return null;
  const { material, massKg: mass } = eligibility;
  requireData(target.actorId.trim().length > 0 && target.input.caseId.trim().length > 0
    && target.inputRevision === revision(target.input), "E_RESEARCH_BINDING");
  date(target.input.assessmentDate);
  const verified = catalog.calculations;
  const sourceCaseId = material === "PET" ? "OYS-20261110-001" : "OYS-20261110-002";
  const parent = required(verified.data.cases.find(item => item.case_id === sourceCaseId));
  const binding = { actorId: target.actorId, caseId: target.input.caseId, inputRevision: target.inputRevision,
    assessmentDate: target.input.assessmentDate };
  const assumptions = [
    "사용자 입력 질량은 현장 미검증이며 kg/1000으로 환산했습니다.",
    "수지와 질량만 공개 시나리오에 대응했습니다. 오염·위험 접촉·공정·지역·평가일의 현장 적합성은 검증하지 않았습니다.",
    "부모 시나리오의 수율·가격·거리·처리비·미확보값과 미국 WARM 경계를 유지했습니다. 실제 견적·실측값·실행 승인이 아닙니다.",
  ];
  const derivedCaseId = `input-public-scenario:${target.input.caseId}:${target.inputRevision}`;
  const copied = structuredClone(verified.data);
  const data = { ...copied,
    cases: copied.cases.filter(item => item.case_id === sourceCaseId)
      .map(item => ({ ...item, case_id: derivedCaseId, mass_t: mass / 1000 })),
    inputs: copied.inputs.map(item => item.input_id === `${material}.mass`
      ? { ...item, value: mass / 1000, transform: "user_kg_divide_1000",
        assumption_reason: assumptions[0] ?? null, quality_grade: "user_input_unverified" } : item),
  };
  const parentHashes = { parentFixtureSha256: verified.fixture_sha256, parentManifestSha256: verified.manifest_sha256,
    parentOriginalSha256: parent.original_sha256, parentProvenanceSha256: revision(parent.provenance) };
  const derivedDatasetSha256 = revision(data);
  // This receipt describes the derivation, without claiming the derived data is a pinned fixture.
  const derivedProvenanceSha256 = revision({ binding, sourceCaseId, material, userMassKg: mass,
    ...parentHashes, derivedDatasetSha256, assumptions });
  const bundle = buildPublicCalculations({ ...verified, data,
    fixture_sha256: derivedDatasetSha256, manifest_sha256: derivedProvenanceSha256 });
  const results = bundle.results;
  const inputIds = new Set(results.flatMap(item => item.input_ids));
  const inputs = bundle.inputs.filter(item => inputIds.has(item.input_id));
  const sourceIds = new Set(inputs.flatMap(item => item.source_id === null ? [] : [item.source_id]));
  return structuredClone({
    version: 1, purpose: "input-public-scenario", label: "공개 자료 기반 계산값(관측값 아님)",
    status: "시나리오 추정, 현장 미검증", binding, material, userMassKg: mass, sourceCaseId,
    provenance: { ...parentHashes, derivedDatasetSha256, derivedProvenanceSha256, implementation: verified.implementation },
    assumptions,
    calculations: { model_version: bundle.model_version, sources: bundle.sources.filter(item => sourceIds.has(item.source_id)),
      inputs, cases: bundle.cases, routes: bundle.routes, results, limitations: bundle.limitations },
    use: { display: "authenticated-research", storage: "private-runtime", redistribution: "not-authorized-by-package",
      commercialExport: "excluded", modelTransmission: "excluded" },
  });
}
