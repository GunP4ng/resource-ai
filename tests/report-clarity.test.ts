import assert from "node:assert/strict";
import { test } from "node:test";
import { createResourceDomain } from "../src/domain.ts";
import { createAssessmentAdapter } from "../src/session.ts";
import { readCaseResearchCatalog } from "../src/o-case-research.ts";
import { buildPublicInputScenario } from "../src/o-input-public-scenario.ts";
import { buildCaseGuidance } from "../src/o-case-guidance.ts";
import { renderReport } from "../src/report.ts";
import { readableReasons } from "../src/report-evidence.ts";
import { canonical, revision } from "../src/o-validation.ts";
import type { CaseInput } from "../src/contracts.ts";

const catalog = readCaseResearchCatalog();

test("actual recommendation and public scenario values occupy separate labeled summaries without changing the decision", async () => {
  const data = await catalog, source = data.calculations.data.cases[0];
  assert.ok(source);
  const input = source.original, decision = await createResourceDomain(input).decide();
  const publicScenario = buildPublicInputScenario({ actorId: "clarity-owner", input, inputRevision: revision(input) }, data);
  assert.ok(publicScenario);
  const guidance = await buildCaseGuidance(input, decision, { publicScenario });
  const difference = guidance.scenario?.differences.find(row => row.routeId === guidance.scenario?.hypotheticalRunnerUpRouteId);
  assert.ok(difference && difference.costAdvantageKrw !== null && difference.carbonAdvantageKgCo2e !== null);
  const before = canonical({ decision, guidance, publicScenario });
  const text = { actual: "", hypothetical: "", stage: "" };
  await new HTMLRewriter()
    .on("#decision-summary", { text(chunk) { text.actual += chunk.text; } })
    .on("#hypothetical-summary", { text(chunk) { text.hypothetical += chunk.text; } })
    .on("#guidance-stage-6", { text(chunk) { text.stage += chunk.text; } })
    .transform(new Response(renderReport(decision, { mode: "offline" }, {
      audience: "authenticated-research", research: null, publicScenario, guidance,
    }))).text();
  const displayedCost = Math.round(difference.costAdvantageKrw).toLocaleString("ko-KR");
  assert.ok(text.actual.includes("기계적 재활용"));
  assert.equal(text.actual.includes(displayedCost), false);
  assert.ok(text.hypothetical.includes(displayedCost));
  assert.ok(text.hypothetical.includes(difference.carbonAdvantageKgCo2e.toLocaleString("ko-KR", { maximumFractionDigits: 2 })));
  assert.equal(text.stage.includes(String(difference.carbonAdvantageKgCo2e)), false);
  assert.equal(text.stage.includes("mechanical-recycling"), false);
  assert.equal(canonical({ decision, guidance, publicScenario }), before);
});

test("a held result retains every reason once while guidance and audit link to the canonical reasons", async () => {
  const data = await catalog, source = data.calculations.data.cases[0];
  assert.ok(source);
  const input: CaseInput = { ...source.original, hazardousContact: "yes" };
  const adapter = createAssessmentAdapter({ runner: async facts => ({ proposal: await createResourceDomain(facts).decide() }) });
  try {
    const output = await adapter.evaluate(input, new AbortController().signal);
    assert.ok(output.decision.state === "needs-review" && output.modelAudit);
    const guidance = await buildCaseGuidance(input, output.decision);
    let fullText = "", links = 0;
    await new HTMLRewriter().on("main", { text(chunk) { fullText += chunk.text; } })
      .on('a[href="#case-reasons"]', { element() { links++; } })
      .transform(new Response(renderReport(output.decision, { mode: "synthetic", modelAudit: output.modelAudit }, {
        audience: "authenticated-research", research: null, guidance,
      }))).text();
    for (const reason of readableReasons(output.decision.reasons)) {
      assert.equal(fullText.split(reason).length - 1, 1, reason);
    }
    assert.ok(links > 0);
    assert.equal(output.decision.state, "needs-review");
  } finally { adapter.dispose(); await adapter.settled(); }
});

test("different diagnostic source IDs retain their records but share one normalized display reason", () => {
  const reasons = ["근거 확인 상태: context-missing (legal-one). 채택한 인용과 별도로 확인하세요.",
    "근거 확인 상태: context-missing (legal-two). 채택한 인용과 별도로 확인하세요."];
  const before = [...reasons];
  const displayed = readableReasons(reasons);
  assert.equal(displayed.length, 1);
  assert.ok(displayed[0]?.includes("사례 조건이 부족합니다"));
  assert.deepEqual(reasons, before);
});
