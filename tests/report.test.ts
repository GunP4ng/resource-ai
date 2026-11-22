import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReport, safeLink } from "../src/report.ts";
import { demo } from "../src/o-demo.ts";
import { route as assessment, documents } from "../src/o-synthetic-evidence.ts";
import { createComparisonCalculator, calculateRouteCost } from "../src/cost.ts";
import { bindSynthetic, carbonFixture, calculationFixture, treatment, transport, sales } from "../src/o-synthetic.ts";
import { createResourceDomain } from "../src/domain.ts";
test("unpriced recommendations expose the fee authority and notice without changing actual costs", async () => {
  const input = { caseId: "fee-reference", description: "깨끗한 철 스크랩", photoRefs: [],
    process: "사업장일반폐기물 금속 절단", polymer: "고철", contamination: "없음",
    hazardousContact: "no" as const, massKg: 1000, region: "대전", assessmentDate: "2026-11-22" };
  const result = await createResourceDomain(input).decide();
  assert.ok(result.state === "compared");
  const before = structuredClone(result);
  const html = renderReport(result, { mode: "offline" });
  const links: string[] = [];
  let quotes = 0;
  await new HTMLRewriter()
    .on("#fee-delegation a", { element(element) { links.push((element.getAttribute("href") ?? "").replaceAll("&amp;", "&")); } })
    .on("#fee-delegation blockquote[cite]", { element() { quotes++; } })
    .transform(new Response(html)).text();
  assert.equal(quotes, 1);
  assert.deepEqual(links, [
    "https://www.law.go.kr/LSW/ordinInfoP.do?ordinSeq=2165959",
    "https://www.daejeon.go.kr/drh/drhGosiView.do?conifmenddt=2025-12-31&conifmstdt=2025-01-01&gosigbn=N&menuSeq=1907&pageIndex=1&sno=53083&title=",
  ]);
  assert.equal(result.recommendations?.[0]?.cost.value, null);
  assert.deepEqual(result, before);
});
test("held alternatives stay informational and precede source and next-action sections", async () => {
  const decision = await createResourceDomain({ caseId: "held-alternatives", description: "합성 유해 접촉 사례",
    photoRefs: [], process: "사출", polymer: "HDPE", contamination: "용제 잔류 의심",
    hazardousContact: "yes", massKg: null, region: "인천", assessmentDate: "2026-11-10" }).decide();
  assert.equal(decision.state, "needs-review");
  if (decision.state !== "needs-review") assert.fail("hazard must retain review");
  assert.ok(decision.conditionalAlternatives?.length);
  const html = renderReport(decision, { mode: "offline" });
  const primaryTargets: (string | null)[] = [];
  const closedDetails: string[] = [];
  const leadingContent: string[] = [];
  await new HTMLRewriter()
    .on("#commercial-summary > .result-overview > #decision-summary, #commercial-summary > .result-overview > #next-action, #commercial-summary > .result-overview > .state.held", {
      element(element) { leadingContent.push(element.getAttribute("id") ?? "held"); },
    })
    .on("a.primary-action:not(.secondary-action)", { element(element) { primaryTargets.push(element.getAttribute("href")); } })
    .on("#result-context, #decision-detail", { element(element) {
      assert.equal(element.hasAttribute("open"), false);
      closedDetails.push(element.getAttribute("id") ?? "");
    } }).transform(new Response(html)).text();
  assert.deepEqual(leadingContent, ["held", "decision-summary", "next-action"]);
  assert.deepEqual(primaryTargets, ["#case-reasons"]);
  assert.match(html, /id="case-reasons"/);
  assert.deepEqual(closedDetails, ["result-context", "decision-detail"]);
  assert.match(html, /실행 보류는 그대로입니다/);
  assert.match(html, /이 처리 경로의 근거를 더 확보해야 합니다/);
  assert.match(html, /이 대안의 근거와 적용 범위/);
  assert.match(html, /먼저 확인할 것/);
  assert.doesNotMatch(html, /aria-label="추천 경로 순위"|1순위/);
  assert.ok(html.indexOf('id="alternatives"') < html.indexOf('id="evidence"'));
  assert.ok(html.indexOf('id="evidence"') < html.indexOf('id="checks"'));
});
test("reported string zero survives while missing usage stays unavailable; history keeps configured execution separate", () => {
  const decision = { state: "needs-information", caseId: "metadata-case", questions: ["질량 확인"], evidence: [] } as const;
  const zero = renderReport(decision, { mode: "live", runtime: { identity: "local-operator", storage: "sqlite", runner: "subscription" }, execution: { traceId: "senpi:trace", usage: "0" }, historical: true });
  const missing = renderReport(decision, { mode: "live", execution: { traceId: "senpi:trace", usage: null } });
  assert.match(zero, /사용량 0<\/p>/); assert.doesNotMatch(zero, /사용량 기록 없음/);
  assert.match(missing, /사용량 기록 없음/); assert.doesNotMatch(missing, /사용량 0/);
  assert.match(zero, /과거 평가입니다. 입력이 바뀌었으니/);
  assert.match(zero, /검토 방식 구독 모델 \(설정값\)/);
  assert.match(zero, /제공자 요청 ID라는 보장은 없습니다/); assert.match(zero, /청구 비용은 제공하지 않습니다/);
});
for (const [runner, label, missing] of [
  [undefined, null, "실행 성공 미검증"],
  ["unspecified", "미지정", "실행 성공 미검증"],
  ["subscription", "구독 모델", "구독 모델 성공 미검증"],
  ["azure", "Azure", "Azure 성공 미검증"],
  ["local", null, "외부 모델 호출 없음"],
] as const) test(`live report without execution uses saved runtime ${runner ?? "absent"} without claiming success`, () => {
  const html = renderReport({ state: "needs-information", caseId: "no-execution", questions: ["질량 확인"], evidence: [] }, {
    mode: "live", ...(runner ? { runtime: { identity: "local-operator", storage: "sqlite", runner } } : {}),
  });
  assert.match(html, /모델 실행 기록 없음/);
  assert.ok(html.includes(`<p>모델 실행 기록 없음 · ${missing}</p>`), `missing execution disclosure for ${runner ?? "absent"}`);
  if (label) assert.ok(html.includes(`검토 방식 ${label} (설정값)`), `configured label for ${runner}`);
  else if (runner === "local") {
    assert.match(html, /평가 당시: 운영자 · 저장소 보관/);
    assert.doesNotMatch(html, /구성된 실행기|로컬 실행|로컬 평가/);
  } else assert.match(html, /평가 당시 설정 기록 없음/);
  if (runner !== "azure") assert.ok(!html.includes("Azure"), "must not assume Azure");
  if (runner !== "local") assert.doesNotMatch(html, /모델 호출 없음/);
  assert.doesNotMatch(html, /추적 |SiWC|인증 성공/);
  assert.match(html, /<details id="advanced"><summary>/);
});
test("question and review states escape hostile text and disallow executable source URLs", () => {
  const evidence = documents({}).documents.map((d) => ({ ...d.record, title: '<img src=x onerror="alert(1)">', url: "javascript:alert(1)", locator: "<script>" }));
  const information = renderReport({ state: "needs-information", caseId: "<hostile>", questions: ["<script>attack</script>"], evidence }, { mode: "synthetic" });
  const review = renderReport({ state: "needs-review", caseId: "x", reasons: ["<img onerror=attack>"], evidence }, { mode: "recording" });
  assert.ok(information.includes("&lt;script&gt;attack&lt;/script&gt;"));
  assert.ok(!information.includes('<a href="javascript:'));
  assert.ok(!review.includes("<img"));
  assert.ok(review.includes("녹화 결과"));
  assert.equal(safeLink("data:text/html,hi"), null);
  assert.equal(safeLink("//example.org"), null);
  assert.equal(safeLink("https://user:pass@example.org"), null);
  assert.equal(safeLink('https://example.org/?a=1&b="'), "https://example.org/?a=1&amp;b=%22");
});
test("compared report reads function results and preserves pending approval and unavailable reasons", async () => {
  const fixture = await demo("normal");
  assert.ok(fixture && fixture.result.state === "compared");
  const html = renderReport(fixture.result, fixture.presentation);
  assert.ok(html.includes("240,000 원"));
  assert.ok(html.includes("230,000 원"));
  assert.ok(html.includes("45 kg CO₂ 환산"));
  assert.ok(html.includes("실행·반출·계약은 현장 담당자의 승인을 받은 뒤 진행하세요."));
  assert.ok(!html.includes("현장 담당자의 승인 기록이 있습니다."));
  assert.ok(!html.includes("humanApproval:"));
  assert.ok(html.includes("1순위군 · 견적 B · 일괄 청구"));
  assert.ok(html.includes("2순위군 · 견적 A · 항목별 청구"));
  assert.ok(html.includes("합성 예시 · 모델 호출 없음"));
  assert.ok(html.includes("입력값 고정 계산"));
  const unavailable = renderReport({ ...fixture.result, scenarios: fixture.result.scenarios.map((s) => ({ ...s, netCost: { state: "unavailable", missingInputs: ["quote-missing<script>"] } })), humanApproval: "approved" }, { mode: "live", execution: { traceId: "<trace>", usage: null } });
  assert.ok(unavailable.includes("계산 불가"));
  assert.ok(unavailable.includes("quote-missing&lt;script&gt;"));
  assert.ok(unavailable.includes("현장 담당자의 승인 기록이 있습니다."));
  assert.ok(!unavailable.includes("실행·반출·계약은 현장 담당자의 승인을 받은 뒤 진행하세요."));
  assert.ok(!unavailable.includes("humanApproval:"));
  assert.ok(unavailable.includes("&lt;trace&gt;"));
  assert.ok(unavailable.includes("사용량 기록 없음"));
  assert.ok(unavailable.includes("순비용 또는 순배출 자료 부족: 순위 보류"));
  assert.ok(!unavailable.includes("1순위군"));
});
test("externally supplied intervals render with their assumptions; invalid ordering is rejected", async () => {
  const fixture = await demo("normal");
  assert.ok(fixture && fixture.result.state === "compared");
  const result = { ...fixture.result, scenarios: fixture.result.scenarios.map((s) => ({ ...s, netEmissions: { state: "available", low: 25, central: 45, high: 65, unit: "kgCO2e", evidenceIds: ["synthetic-evidence"], assumptions: ["지원된 외부 공동 시나리오 범위 · 독립 확률분포 아님"] } as const })) };
  const html = renderReport(result, fixture.presentation);
  assert.ok(html.includes("45 kg CO₂ 환산 (범위 25–65)"));
  assert.ok(html.includes("우열 미정"));
  assert.throws(() => renderReport({ ...result, scenarios: result.scenarios.map((s) => ({ ...s, netEmissions: { ...s.netEmissions, low: 90 } })) }, fixture.presentation), /invalid-estimate-or-evidence/);
});

test("summary follows approval; disclosed and printable audits retain exact assumptions and evidence", async () => {
  const fixture = await demo("normal");
  assert.ok(fixture && fixture.result.state === "compared");
  const html = renderReport(fixture.result, fixture.presentation);
  const approval = html.indexOf("실행·반출·계약은 현장 담당자의 승인을 받은 뒤 진행하세요.");
  assert.ok(approval >= 0 && approval < html.indexOf("대안 비교 요약"));
  const amountPosition = html.indexOf("240,000 원");
  assert.ok(amountPosition >= 0 && amountPosition < html.indexOf("경로와 조건"));
  const screen = html.match(/<details class="screen-only"><summary>.*?<\/summary>([\s\S]*?)<\/details>/)?.[1];
  const print = html.match(/<div class="print-only">([\s\S]*?)<\/div>\s*<details id="advanced"/)?.[1];
  assert.ok(screen && print);
  assert.equal(print, screen);
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
    assert.ok(disclosure.includes("20,000 원"));
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
      assert.ok(html.match(/<div class="print-only">([\s\S]*?)<\/div>\s*<details id="advanced"/)?.[1]?.includes(`${label} 대체효과 제외 경계`));
    }
  }
  if (mode === "both-unavailable") {
    assert.equal(scenarios[0]?.netEmissions.state, "unavailable");
    assert.match(row("순배출"), /계산 불가/);
    assert.match(row("순배출"), /완전한 순탄소 비교 아님/);
  }
});
