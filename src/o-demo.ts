import { Type } from "typebox";
import { Value } from "typebox/value";
import type { DecisionResult } from "./contracts.ts";
import { createComparisonCalculator } from "./cost.ts";
import { findProcessorsWithDiagnostics } from "./processors.ts";
import { bindSynthetic, carbonFixture, sales, sq } from "./o-synthetic.ts";
import { caseInput, documents, processorFixture, route } from "./o-synthetic-evidence.ts";
import type { ReportPresentation } from "./report.ts";
import type { ReviewedDocument } from "./o-validation.ts";
export interface DemoOutput { readonly result: DecisionResult; readonly presentation: ReportPresentation; readonly documents?: readonly ReviewedDocument[]; }
export async function demo(fixtureId: string, origin = "http://localhost:3000"): Promise<DemoOutput | null> {
  const presentation: ReportPresentation = { mode: "synthetic", sourceVersion: "synthetic-v1", calculationVersion: "O-deterministic-v1 / synthetic-calculation-v1 / synthetic-registry-v1", scenarioLabels: ["견적 A · 항목별 청구", "견적 B · 일괄 청구"] };
  if (fixtureId === "held") return { presentation, result: { state: "needs-information", caseId: "synthetic-held", questions: ["합성 보류 예시: 발생 공정과 오염 상태를 확인해 주세요.", "실측 질량과 유해물질 접촉 이력을 알려 주세요."], evidence: [] } };
  if (fixtureId === "review") return { presentation, result: { state: "needs-review", caseId: "synthetic-review", reasons: ["합성 검토 예시: 유해 접촉 이력과 자료가 충돌합니다.", "허가 원문과 별표의 적용 행 확인 전 처리·계약을 진행할 수 없습니다."], evidence: [] } };
  if (fixtureId !== "normal") return null;
  const a = carbonFixture(), processors = processorFixture();
  const allIn = { ...sales, quoteId: "synthetic-all-in-B", category: "treatment", basis: { kind: "total", amount: sq(250000, "KRW") }, revenueRecipient: "not-applicable" } as const;
  const treatmentReview = a.context.quotes.find((q) => q.quoteId === "synthetic-treatment");
  if (treatmentReview === undefined) return null;
  const b = bindSynthetic({ ...a.input, routes: [{ ...a.route, quotes: [allIn, sales] }] }, { ...a.context, quotes: [{ ...treatmentReview, quoteId: allIn.quoteId, components: ["transport", "preprocessing", "treatment"] }, ...a.context.quotes.filter((q) => q.quoteId === sales.quoteId)] });
  const facts: Record<string, unknown> = {};
  const Facts = Type.Object({ facts: Type.Record(Type.String(), Type.Unknown()) });
  for (const d of [...a.context.documents, ...b.context.documents, ...processors.documents]) {
    const parsed: unknown = JSON.parse(d.snapshot);
    if (Value.Check(Facts, parsed)) Object.assign(facts, parsed.facts);
  }
  const generated = documents(facts);
  const shared = { documents: generated.documents.map((d) => ({ ...d, record: { ...d.record, url: `${origin}/demo/evidence` } })) };
  const evidence = shared.documents.map((d) => d.record);
  const found = findProcessorsWithDiagnostics(caseInput, route, { ...processors, ...shared });
  const first = await createComparisonCalculator({ ...a.context, ...shared })({ ...a.input, evidence }, [route]);
  const second = await createComparisonCalculator({ ...b.context, ...shared })({ ...b.input, evidence }, [route]);
  return { presentation, documents: shared.documents, result: { state: "compared", caseId: caseInput.caseId, routes: [route], processors: found.candidates,
    scenarios: [...first, ...second], evidence, humanApproval: "pending", limitations: ["전부 합성 입력·허가·견적·계수입니다. 실제 업체·법적 판정·시장가격이 아닙니다.", "정보 부족·검토 예시는 작성된 고정 fixture이며 H1/H3 또는 모델의 판정이 아닙니다.", "실제 허가·견적·배출계수와 H1/H4·Azure 통합은 미연결입니다.", "VAT 포함 합성 견적이며, 고정 입력 계산은 불확실성 범위를 제공하지 않습니다."] } };
}
