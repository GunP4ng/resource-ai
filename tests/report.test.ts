import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReport, safeLink } from "../src/report.ts";
import { demo } from "../src/o-demo.ts";
import { route as assessment, documents } from "../src/o-synthetic-evidence.ts";
import { createComparisonCalculator, calculateRouteCost } from "../src/cost.ts";
import { bindSynthetic, carbonFixture, calculationFixture, treatment, transport, sales } from "../src/o-synthetic.ts";
test("live reports without execution metadata explicitly leave Azure success unverified", () => {
  const html = renderReport({ state: "needs-information", caseId: "no-execution", questions: ["질량 확인"], evidence: [] }, { mode: "live" });
  assert.match(html, /모델 실행 정보 미제공/);
  assert.match(html, /Azure 성공 미검증/);
  assert.doesNotMatch(html, /모델 호출 없음|추적 /);
});
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

test("P2: excluded credits retain boundary meaning in public estimates and the visible compact summary", async () => {
  const f = carbonFixture();
  const route = { ...f.route, activities: f.route.activities.filter((a) => !a.stage.endsWith("credit")) };
  const factorIds = new Set(route.activities.map((a) => a.factorId));
  const activityIds = new Set(route.activities.map((a) => a.activityId));
  const bound = bindSynthetic({ ...f.input, routes: [route], factors: f.input.factors.filter((v) => factorIds.has(v.factorId)) }, {
    ...f.context,
    routes: f.context.routes.map((v) => ({ ...v, materialCreditExcluded: true, energyCreditExcluded: true })),
    activities: f.context.activities.filter((v) => activityIds.has(v.activityId)),
    factors: f.context.factors.filter((v) => factorIds.has(v.factorId)),
  });
  const scenarios = await createComparisonCalculator(bound.context)(bound.input, [assessment]);
  const scenario = scenarios[0];
  assert.ok(scenario);
  const fixture = await demo("normal");
  assert.ok(fixture && fixture.result.state === "compared");
  const html = renderReport({ ...fixture.result, caseId: bound.input.caseId, routes: [assessment], scenarios, evidence: bound.input.evidence }, { mode: "synthetic" });
  // Inspect only the always-visible comparison area, excluding both audit copies.
  const summary = html.split("<h2>대안 비교 요약</h2>")[1]?.split("<h2>경로와 조건</h2>")[0];
  assert.ok(summary);
  const visible = summary.replace(/<[^>]*>/g, " ");
  const exclusions = /제외|excluded|outside/i;
  const boundary = /경계|boundary|scope/i;
  const material = /원료|물질|material/i;
  const energy = /에너지|energy/i;
  const failures: string[] = [];
  for (const [name, value, expected, kinds] of [
    ["materialCredit", scenario.materialCredit, 0, [material]],
    ["energyCredit", scenario.energyCredit, 0, [energy]],
    ["netEmissions", scenario.netEmissions, 100, [material, energy]],
  ] as const) {
    assert.ok(value.state === "available");
    assert.deepEqual([value.low, value.central, value.high], [expected, expected, expected]);
    for (const kind of kinds) {
      if (!value.assumptions.some((a) => exclusions.test(a) && boundary.test(a) && kind.test(a))) failures.push(`${name}: missing credit boundary exclusion assumption`);
    }
  }
  assert.ok(scenario.grossEmissions.state === "available");
  assert.equal(scenario.grossEmissions.central, 100);
  for (const kind of [material, energy]) {
    // A credit name elsewhere in the table must not satisfy an unrelated note.
    const notes = [...summary.matchAll(/<(?:p|li|td)\b[^>]*>([\s\S]*?)<\/(?:p|li|td)>/g)].map((match) => match[1]?.replace(/<[^>]*>/g, " ") ?? "");
    if (!notes.some((note) => kind.test(note) && exclusions.test(note) && boundary.test(note))) failures.push(`visible summary: missing ${kind.source} boundary exclusion`);
  }
  assert.deepEqual(failures, [], JSON.stringify({ failures, materialCredit: scenario.materialCredit, energyCredit: scenario.energyCredit, netEmissions: scenario.netEmissions, visibleSummary: visible }));
});

for (const mode of ["material", "energy", "both-unavailable", "supported-zero"] as const) test(`P2 visible metric policy and audit: ${mode}`, async () => {
  const f = carbonFixture();
  const material = mode === "material" || mode === "both-unavailable";
  const energy = mode === "energy" || mode === "both-unavailable";
  const route = { ...f.route, missingInputs: mode === "both-unavailable" ? ["missing-gross-input"] : [], activities: f.route.activities
    .filter((a) => !(material && a.stage === "material-credit") && !(energy && a.stage === "energy-credit"))
    .map((a) => mode === "supported-zero" && a.stage.endsWith("credit") ? { ...a, amount: { ...a.amount, value: 0 } } : a) };
  const bound = bindSynthetic({ ...f.input, routes: [route] }, {
    ...f.context, routes: f.context.routes.map((r) => ({ ...r, materialCreditExcluded: material, energyCreditExcluded: energy })),
    activities: f.context.activities.map((a) => mode === "supported-zero" && a.activityId.endsWith("credit") ? { ...a, outputQuantity: 0 } : a),
  });
  const scenarios = await createComparisonCalculator(bound.context)(bound.input, [assessment]);
  const fixture = await demo("normal");
  assert.ok(fixture?.result.state === "compared");
  const html = renderReport({ ...fixture.result, routes: [assessment], scenarios, evidence: bound.input.evidence }, { mode: "synthetic" });
  const summary = html.split("<h2>대안 비교 요약</h2>")[1]?.split("<h2>경로와 조건</h2>")[0];
  assert.ok(summary && !summary.includes("<details"));
  const row = (name: string) => summary.match(new RegExp(`<th scope="row">${name}</th>([\\s\\S]*?)</tr>`))?.[1] ?? "";
  assert.doesNotMatch(row("총배출"), /대체효과 제외/);
  for (const [label, excluded] of [["원료", material], ["에너지", energy]] as const) {
    assert.equal(row(`${label} 크레딧`).includes(`${label} 대체효과 제외 경계`), excluded);
    assert.equal(row("순배출").includes(`${label} 대체효과 제외 경계`), excluded);
    if (excluded) {
      assert.ok(html.match(/<div class="print-only">([\s\S]*?)<h2>제약과 다음 확보 항목/)?.[1]?.includes(`${label} 대체효과 제외 경계`));
    }
  }
  if (mode === "both-unavailable") {
    assert.equal(scenarios[0]?.netEmissions.state, "unavailable");
    assert.match(row("순배출"), /계산 불가/);
    assert.match(row("순배출"), /완전한 순탄소 비교 아님/);
  }
});
