import assert from "node:assert/strict";
import { test } from "node:test";
import type { CaseInput } from "../src/contracts.ts";
import { createResourceDomain } from "../src/domain.ts";
import { buildCaseGuidance } from "../src/o-case-guidance.ts";
import { createModelHostAudit } from "../src/o-model-audit.ts";
import { revision } from "../src/o-validation.ts";
import { safetyReasons } from "../src/o-safety-reasons.ts";
import { displayGuidanceOutput, displayReason } from "../src/report-copy.ts";
import { readableReason } from "../src/report-evidence.ts";
import { renderModelHostAudit } from "../src/report-model-audit.ts";
import { renderReport } from "../src/report.ts";

const input: CaseInput = {
  caseId: "copy-boundary", description: "구리 절단편, 납 검출", photoRefs: [],
  polymer: "구리", process: "사업장일반폐기물 금속 절단", contamination: "없음",
  hazardousContact: "no", massKg: 180, region: "경기", assessmentDate: "2026-11-22",
};

test("copy projection matches complete host text and leaves raw fallbacks and input-like fragments intact", () => {
  const raw = safetyReasons.contaminationUnknown;
  assert.notEqual(displayReason(raw), raw);
  for (const text of [raw + " 추가 입력", "사용자 입력: " + raw, "<script>unknown strict</script>", "legal-source-1", "미확보"]) {
    assert.equal(displayReason(text), text);
  }
  assert.equal(displayReason("법령 원문 확인 미완료: legal-one (2026-11)"),
    "법령 원문 대조 필요: legal-one (2026-11)");
  assert.equal(displayGuidanceOutput("polymer에 명시된 PP이 단일 수지로 확인된다는 가설입니다. 혼합·층별 분리·라벨 문제는 확인 자료가 필요합니다."),
    "PP이 단일 수지로 확인된다고 가정했습니다. 혼합·층별 분리·라벨은 자료로 확인하세요.");
  assert.equal(displayGuidanceOutput("신고 재질: 미확보"), "신고 재질: 미확보");
  assert.equal(displayGuidanceOutput("가정별 안내: reuse (unavailable)"), "조건별 안내: reuse (unavailable)");
});

test("equal displayed reasons retain distinct raw identities and only the canonical hazard receives detected terms", async () => {
  const decision = await createResourceDomain(input).decide();
  assert.equal(decision.state, "needs-review");
  const raw = safetyReasons.materialTreatment;
  const projected = readableReason(raw);
  const result = { ...decision, reasons: [raw, projected, "<script>raw fallback</script>"] };
  const before = structuredClone({ input, result });
  const hash = revision(result);
  const reasons: string[] = [], terms: string[] = [], ids: string[] = [];
  await new HTMLRewriter()
    .on("#case-reasons > ul > li", {
      element(el) { ids.push(el.getAttribute("id") ?? ""); reasons.push(""); },
      text(chunk) { reasons[reasons.length - 1] += chunk.text; },
    })
    .on(".detected-hazard-terms", { text(chunk) { terms.push(chunk.text); } })
    .on("#case-reasons script", { element() { assert.fail("fallback must be escaped"); } })
    .transform(new Response(renderReport(result, { mode: "offline" }, { audience: "commercial" }, { evaluatedInput: input }))).text();
  assert.deepEqual(ids, ["case-reason-1", "case-reason-2", "case-reason-3"]);
  assert.ok(reasons[0]?.includes(projected));
  assert.equal(reasons[1], "사유 2. " + projected);
  assert.equal(reasons[2], "사유 3. &lt;script&gt;raw fallback&lt;/script&gt;");
  assert.deepEqual(terms.filter(Boolean), ["입력에서 찾은 표현: 납. 이 물질과 처리 이력의 확인 자료를 준비하세요."]);
  assert.equal(revision(result), hash);
  assert.deepEqual({ input, result }, before);
  const guidance = await buildCaseGuidance(input, result);
  const withNames = { ...guidance, stages: guidance.stages.map(stage => stage.stage === 4
    ? { ...stage, outputs: [raw, "가정별 안내: reuse (unavailable)"] } : stage) };
  let names = "";
  await new HTMLRewriter().on("#guidance-stage-4 > ul:first-of-type > li", { text(chunk) { names += chunk.text; } })
    .transform(new Response(renderReport(result, { mode: "offline" }, {
      audience: "authenticated-research", research: null, guidance: withNames,
    }))).text();
  assert.equal(names, raw + "가정별 안내: reuse (unavailable)");
});

test("audit check labels translate only display names and preserve canonical checks hashes and attributes", async () => {
  const decision = await createResourceDomain(input).decide();
  const audit = createModelHostAudit(input, {
    proposal: decision, decision, origin: "runner-output",
    observation: { status: "validation-rejected", passedChecks: ["syntax", "alternatives", "case-binding", "evidence"],
      failedCheck: "comparison", reasons: [], },
  });
  const before = structuredClone(audit), hash = revision(audit);
  const html = renderModelHostAudit(audit);
  let text = "", origin = "";
  await new HTMLRewriter().on("#model-host-audit", {
    element(el) { origin = el.getAttribute("data-model-audit-origin") ?? ""; },
    text(chunk) { text += chunk.text; },
  }).transform(new Response(html)).text();
  assert.equal(origin, "runner-output");
  assert.ok(text.includes("형식 검사, 대안 검사, 사례 연결 검사, 근거 검사"));
  assert.ok(text.includes("실패한 검사: 비교 검사"));
  assert.ok(text.includes(audit.inputRevision));
  assert.ok(text.includes(audit.decisionRevision));
  assert.equal(revision(audit), hash);
  assert.deepEqual(audit, before);
});
