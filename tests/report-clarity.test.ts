import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createResourceDomain } from "../src/domain.ts";
import { createAssessmentAdapter } from "../src/session.ts";
import { readCaseResearchCatalog } from "../src/o-case-research.ts";
import { buildPublicInputScenario } from "../src/o-input-public-scenario.ts";
import { buildCaseGuidance } from "../src/o-case-guidance.ts";
import { renderReport } from "../src/report.ts";
import { readableReason, readableReasons } from "../src/report-evidence.ts";
import { parseInput } from "../src/o-case-record-validation.ts";
import { presentAssessmentDecision } from "../src/o-verification-plan-candidates.ts";
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

test("held reports retain canonical reasons and guidance with or without a model audit", async () => {
  const data = await catalog, source = data.calculations.data.cases[0];
  assert.ok(source);
  const adapter = createAssessmentAdapter({ runner: async facts => ({ proposal: await createResourceDomain(facts).decide() }) });
  try {
    for (const { input, audited } of [
      { input: { ...source.original, hazardousContact: "yes" }, audited: false },
      { input: { ...source.original, description: `${source.original.description}, 재질 표기 불일치` }, audited: true },
    ] satisfies readonly { readonly input: CaseInput; readonly audited: boolean }[]) {
      const output = await adapter.evaluate(input, new AbortController().signal);
      assert.equal(output.modelAudit !== undefined, audited);
      assert.ok(output.decision.state === "needs-review");
      const guidance = await buildCaseGuidance(input, output.decision);
      let fullText = "", links = 0;
      await new HTMLRewriter().on("main", { text(chunk) { fullText += chunk.text; } })
        .on('a[href="#case-reasons"]', { element() { links++; } })
        .transform(new Response(renderReport(output.decision, { mode: "synthetic", ...(output.modelAudit ? { modelAudit: output.modelAudit } : {}) }, {
          audience: "authenticated-research", research: null, guidance,
        }))).text();
      for (const reason of readableReasons(output.decision.reasons)) {
        assert.equal(fullText.split(reason).length - 1, 1, reason);
      }
      assert.ok(links > 0);
    }
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

test("every original held case shows canonical reasons once even across priority and hypothesis disclosures", async () => {
  const manifestUrl = new URL("../data/evaluation/development.json", import.meta.url);
  const manifest: unknown = JSON.parse(await readFile(manifestUrl, "utf8"));
  assert.ok(manifest && typeof manifest === "object" && "cases" in manifest && Array.isArray(manifest.cases));
  const entries: readonly unknown[] = manifest.cases;
  let held = 0, priority = 0, probes = 0;
  for (const entry of entries) {
    assert.ok(entry && typeof entry === "object" && "inputRef" in entry && typeof entry.inputRef === "string");
    const raw: unknown = JSON.parse(await readFile(new URL(entry.inputRef, manifestUrl), "utf8"));
    assert.ok(raw && typeof raw === "object" && !Array.isArray(raw));
    const input = parseInput({ ...raw, photoRefs: [] });
    const decision = presentAssessmentDecision(await createResourceDomain(input).decide());
    if (decision.state === "compared") continue;
    held++;
    const guidance = await buildCaseGuidance(input, decision);
    if (guidance.oneFactPriority.priorityFactId !== null) priority++;
    probes += guidance.oneFactPriority.probes.length;
    const expected = [...new Set((decision.state === "needs-review" ? decision.reasons : decision.questions)
      .filter(reason => !reason.startsWith("추가 답변은 필드별 JSON")).map(readableReason))];
    assert.ok(expected.length > 0);
    let body = "";
    const ids = new Set<string>(), targets: string[] = [];
    await new HTMLRewriter().on("main", { text(chunk) { body += chunk.text; } })
      .on("#case-reasons li", { element(node) { const id = node.getAttribute("id"); if (id) ids.add("#" + id); } })
      .on('#one-fact-priority a[href^="#case-reason-"]', { element(node) { targets.push(node.getAttribute("href") ?? ""); } })
      .transform(new Response(renderReport(decision, { mode: "offline" }, {
        audience: "authenticated-research", research: null, guidance,
      }))).text();
    for (const reason of expected) assert.equal(body.split(reason).length - 1, 1, input.caseId + ": " + reason);
    assert.ok(targets.every(target => ids.has(target)), input.caseId + ": numbered target");
    const first = guidance.oneFactPriority.probes.find(probe => probe.id === guidance.oneFactPriority.priorityFactId);
    const hypothesisLists = [...(first ? [first.remainingUnknowns] : []),
      ...guidance.oneFactPriority.probes.map(probe => probe.remainingUnknowns)];
    const expectedTargets = hypothesisLists.flatMap(items => [...new Set(items.map(readableReason))]
      .map(reason => expected.indexOf(reason)).filter(index => index >= 0).map(index => "#case-reason-" + (index + 1)));
    assert.deepEqual(targets, expectedTargets, input.caseId + ": referenced reason identity");
  }
  assert.ok(held > 0 && priority > 0 && probes > 0);
});
