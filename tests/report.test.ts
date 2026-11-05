import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReport, safeLink } from "../src/report.ts";
import { demo } from "../src/o-demo.ts";
import { documents } from "../src/o-synthetic-evidence.ts";
import { calculateRouteCost } from "../src/cost.ts";
import { bindSynthetic, calculationFixture, treatment, transport, sales } from "../src/o-synthetic.ts";
test("question and review states escape hostile text and disallow executable source URLs", () => {
  const evidence = documents({}).documents.map((d) => ({ ...d.record, title: '<img src=x onerror="alert(1)">', url: "javascript:alert(1)", locator: "<script>" }));
  const information = renderReport({ state: "needs-information", caseId: "<hostile>", questions: ["<script>attack</script>"], evidence }, { mode: "synthetic" });
  const review = renderReport({ state: "needs-review", caseId: "x", reasons: ["<img onerror=attack>"], evidence }, { mode: "recording" });
  assert.ok(information.includes("&lt;script&gt;attack&lt;/script&gt;"));
  assert.ok(!information.includes('<a href="javascript:'));
  assert.ok(!review.includes("<img"));
  assert.ok(review.includes("사전 녹화"));
  assert.equal(safeLink("data:text/html,hi"), null);
  assert.equal(safeLink("//example.org"), null);
  assert.equal(safeLink("https://user:pass@example.org"), null);
  assert.equal(safeLink('https://example.org/?a=1&b="'), "https://example.org/?a=1&amp;b=%22");
});
test("compared report reads function results and preserves pending approval and unavailable reasons", async () => {
  const fixture = await demo("normal");
  assert.ok(fixture && fixture.result.state === "compared");
  const html = renderReport(fixture.result, fixture.presentation);
  assert.ok(html.includes("240,000 KRW"));
  assert.ok(html.includes("230,000 KRW"));
  assert.ok(html.includes("45 kgCO2e"));
  assert.ok(html.includes("humanApproval: pending"));
  assert.ok(html.includes("합성 데모 · 모델 호출 없음"));
  assert.ok(html.includes("입력값 고정 계산"));
  const unavailable = renderReport({ ...fixture.result, scenarios: fixture.result.scenarios.map((s) => ({ ...s, netCost: { state: "unavailable", missingInputs: ["quote-missing<script>"] } })), humanApproval: "approved" }, { mode: "live", execution: { traceId: "<trace>", usage: null } });
  assert.ok(unavailable.includes("계산 불가"));
  assert.ok(unavailable.includes("quote-missing&lt;script&gt;"));
  assert.ok(unavailable.includes("humanApproval: approved"));
  assert.ok(unavailable.includes("&lt;trace&gt;"));
  assert.ok(unavailable.includes("사용량 미제공"));
});
test("externally supplied intervals render with their assumptions; invalid ordering is rejected", async () => {
  const fixture = await demo("normal");
  assert.ok(fixture && fixture.result.state === "compared");
  const result = { ...fixture.result, scenarios: fixture.result.scenarios.map((s) => ({ ...s, netEmissions: { state: "available", low: 25, central: 45, high: 65, unit: "kgCO2e", evidenceIds: ["synthetic-evidence"], assumptions: ["지원된 외부 공동 시나리오 범위 · 독립 확률분포 아님"] } as const })) };
  const html = renderReport(result, fixture.presentation);
  assert.ok(html.includes("45 kgCO2e (범위 25–65)"));
  assert.ok(html.includes("우열 불확실"));
  assert.throws(() => renderReport({ ...result, scenarios: result.scenarios.map((s) => ({ ...s, netEmissions: { ...s.netEmissions, low: 90 } })) }, fixture.presentation), /invalid-estimate-or-evidence/);
});

test("summary follows approval; disclosed and printable audits retain exact assumptions and evidence", async () => {
  const fixture = await demo("normal");
  assert.ok(fixture && fixture.result.state === "compared");
  const html = renderReport(fixture.result, fixture.presentation);
  assert.match(html, /humanApproval: pending<\/p>\s*<h2>대안 비교 요약<\/h2>/);
  assert.ok(html.indexOf("240,000 KRW") < html.indexOf("경로와 조건"));
  const screen = html.match(/<details class="screen-only"><summary>.*?<\/summary>([\s\S]*?)<\/details>/)?.[1];
  const print = html.match(/<div class="print-only">([\s\S]*?)<h2>제약과 다음 확보 항목/)?.[1];
  assert.ok(screen && print);
  assert.equal(print, `${screen}</div>\n        `);
  for (const scenario of fixture.result.scenarios) {
    for (const line of [...scenario.costLines, ...scenario.carbonLines]) {
      assert.equal(line.amount.state, "available");
      if (line.amount.state === "available") {
        for (const assumption of line.amount.assumptions) assert.ok(html.includes(assumption));
      }
    }
    for (const line of scenario.carbonLines) {
      assert.ok(screen.includes(line.factorId ?? "계수 없음"));
      assert.ok(screen.includes(line.factorVersion ?? "버전 없음"));
    }
  }
  // One shared condition per cost/carbon group, rather than per metric or line.
  const summary = html.split("<h2>경로와 조건</h2>")[0]!;
  assert.equal(summary.split("입력값 고정 계산 · 불확실성 범위 미제공").length - 1, 2);
  assert.equal(summary.split("VAT 포함").length - 1, 1);
  assert.ok(html.indexOf("VAT 포함") < html.indexOf('<details class="screen-only">'));
  assert.ok(html.includes('href="#evidence-1"'));
  assert.ok(html.includes('id="evidence-1"'));
  assert.ok(html.includes('rel="noreferrer"'));
});

test("sales excluded from net cost keep their amount and visible audit explanation", async () => {
  const fixture = await demo("normal");
  assert.ok(fixture && fixture.result.state === "compared");
  const processor = calculationFixture([treatment, transport, { ...sales, revenueRecipient: "processor" }]);
  const netted = calculationFixture();
  const nettedContext = bindSynthetic(netted.input, {
    ...netted.context,
    quotes: netted.context.quotes.map((quote) => quote.quoteId === sales.quoteId ? { ...quote, revenueNettedIn: treatment.quoteId } : quote),
  });
  const examples = [
    [calculateRouteCost(processor.input, processor.route, processor.context), "처리업체 귀속 · 사업자 수입 합산 제외"],
    [calculateRouteCost(nettedContext.input, netted.route, nettedContext.context), `견적 ${treatment.quoteId}에 이미 반영 · 추가 차감 제외`],
  ] as const;
  for (const [cost, explanation] of examples) {
    const result = { ...fixture.result, scenarios: fixture.result.scenarios.map((scenario) => ({ ...scenario, ...cost })) };
    const html = renderReport(result, fixture.presentation);
    const disclosure = html.match(/<details class="screen-only">([\s\S]*?)<\/details>/)?.[1];
    assert.ok(disclosure);
    assert.ok(disclosure.includes(explanation));
    assert.ok(disclosure.includes("20,000 KRW"));
  }
});
