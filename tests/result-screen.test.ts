import assert from "node:assert/strict";
import { test } from "node:test";
import type { CaseInput } from "../src/contracts.ts";
import { createResourceDomain } from "../src/domain.ts";
import { buildCaseGuidance, buildPublicCaseProgress } from "../src/o-case-guidance.ts";
import { buildPublicInputScenario } from "../src/o-input-public-scenario.ts";
import { readCaseResearchCatalog } from "../src/o-case-research.ts";
import { revision } from "../src/o-validation.ts";
import { renderReport } from "../src/report.ts";

const input: CaseInput = {
  caseId: "result-screen", description: "구리 절단 스크랩", photoRefs: [],
  process: "사업장일반폐기물 금속 절단", polymer: "구리", contamination: "없음",
  hazardousContact: "no", massKg: 180, region: "경기", assessmentDate: "2026-11-22",
};

for (const contamination of ["없음", "오일 있음"]) {
  test(`primary result action targets the real next step for ${contamination}`, async () => {
    const evaluatedInput = { ...input, contamination };
    const decision = await createResourceDomain(evaluatedInput).decide();
    const actions: (string | null)[] = [], badges: (string | null)[] = [];
    const stages: (string | null)[] = [], ids: (string | null)[] = [];
    const html = renderReport(decision, { mode: "offline" }, { audience: "commercial" }, {
      evaluatedInput, progress: buildPublicCaseProgress(evaluatedInput, decision),
      answerTarget: "#answer-fields", caseReturnTarget: "/cases/result-screen",
      editing: '<form method="post"><input id="answer-fields" name="answers"><button>수정</button></form>',
    });
    await new HTMLRewriter()
      .on(".result-overview .primary-action", { element(el) { actions.push(el.getAttribute("href")); } })
      .on(".result-overview .state", { element(el) { badges.push(el.getAttribute("class")); } })
      .on("#case-progress [data-guidance-stage]", { element(el) { stages.push(el.getAttribute("data-guidance-stage")); } })
      .on("[id]", { element(el) { ids.push(el.getAttribute("id")); } })
      .transform(new Response(html)).text();
    assert.deepEqual(actions, [decision.state === "compared" ? "#checks" : "#answer-fields"]);
    assert.deepEqual(badges, [decision.state === "compared" ? "state recommended" : "state held"]);
    assert.deepEqual(stages, ["1", "2", "3", "4", "5", "6"]);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(html.indexOf('href="/cases/result-screen"') > html.indexOf('class="primary-action"'));
  });
}

test("metric cards preserve a supplied actual zero and hide all research numbers commercially", async () => {
  const decision = await createResourceDomain(input).decide();
  const guidance = await buildCaseGuidance(input, decision);
  // Deliberately distinct host display values: the renderer must not subtract scenarios.
  const supplied = { ...guidance, actualComparison: { ...guidance.actualComparison,
    actualSecondAvailable: true, firstRouteId: "mechanical-recycling", secondRouteId: "disposal",
    costAdvantageKrw: 0, carbonAdvantageKgCo2e: 12345.67,
  } };
  for (const audience of ["authenticated-research", "commercial"] as const) {
    const values: string[] = [];
    const context = { audience, research: null, guidance: supplied };
    await new HTMLRewriter().on("[data-result-metric] .metric-value", {
      element() { values.push(""); }, text(chunk) { values[values.length - 1] += chunk.text; },
    }).transform(new Response(renderReport(decision, { mode: "offline" }, context))).text();
    assert.equal(values.length, 3);
    if (audience === "authenticated-research") {
      assert.equal(values[0], "0 원");
      assert.equal(values[1], "12,345.67 kg CO₂ 환산");
    } else {
      assert.ok(values.every(value => !/\d/u.test(value)));
    }
  }
  assert.equal(supplied.actualComparison.costAdvantageKrw, 0);
});

test("reference-price card requires the same bound context and never substitutes a generic PE price for HDPE", async () => {
  const catalog = await readCaseResearchCatalog();
  for (const polymer of ["PET", "HDPE"]) {
    const evaluatedInput = { ...input, polymer, description: `${polymer} 사출 부산물`, process: "사출" };
    const decision = await createResourceDomain(evaluatedInput).decide();
    const publicScenario = buildPublicInputScenario({
      actorId: "screen-test", input: evaluatedInput, inputRevision: revision(evaluatedInput),
    }, catalog);
    assert.ok(publicScenario);
    const guidance = await buildCaseGuidance(evaluatedInput, decision, { publicScenario });
    for (const inputRevision of [guidance.inputRevision, "f".repeat(64)]) {
      let price = "", details = "";
      const context = { audience: "authenticated-research", research: null, publicScenario,
        guidance: { ...guidance, inputRevision } } as const;
      await new HTMLRewriter().on('[data-result-metric="price"] .metric-value', {
        text(chunk) { price += chunk.text; },
      }).on('[data-result-metric="price"] p:not(.metric-value)', { text(chunk) { details += chunk.text; } })
        .transform(new Response(renderReport(decision, { mode: "offline" }, context))).text();
      if (polymer === "PET" && inputRevision === guidance.inputRevision) {
        assert.equal(price, "616.8 원/kg");
        assert.match(details, /조사 10월 10일 · 공표 10월 26일/u);
        assert.doesNotMatch(details, /survey|published|unverified/u);
      }
      else assert.doesNotMatch(price, /\d/u);
    }
  }
});
