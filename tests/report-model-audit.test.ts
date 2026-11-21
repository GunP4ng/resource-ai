import assert from "node:assert/strict";
import { test } from "node:test";
import { createAssessmentAdapter } from "../src/session.ts";
import { createResourceDomain } from "../src/domain.ts";
import { buildCaseGuidance } from "../src/o-case-guidance.ts";
import { renderReport } from "../src/report.ts";
import type { CaseInput } from "../src/contracts.ts";

const input: CaseInput = { caseId: "audit-view-case", description: "합성 PET 자투리", photoRefs: [],
  polymer: "PET", process: "PET 성형 후 분리 수거", contamination: "없음", hazardousContact: "no",
  massKg: 24, region: "경기도", assessmentDate: "2026-11-20" };

for (const mismatch of [false, true]) test(`stored ${mismatch ? "rejected" : "validated"} proposal renders stages privately without promoting model contribution`, async () => {
  const adapter = createAssessmentAdapter({ runner: async value => {
    const proposal = await createResourceDomain(value).decide();
    return { proposal: mismatch ? { ...proposal, caseId: "other-case" } : proposal };
  } });
  try {
    const output = await adapter.evaluate(input, new AbortController().signal);
    assert.ok(output.modelAudit);
    const guidance = await buildCaseGuidance(input, output.decision);
    const presentation = { mode: "synthetic" as const, modelAudit: output.modelAudit };
    let origin: string | null = null, privateStages: string[] = [], rejected: string[] = [], commercialAudits = 0;
    await new HTMLRewriter().on("[data-model-audit-origin]", { element(node) { origin = node.getAttribute("data-model-audit-origin"); } })
      .on("[data-model-audit-stage]", { element(node) {
        privateStages.push(node.getAttribute("data-model-audit-stage") ?? "");
        if (node.getAttribute("data-validation-status") === "validation-rejected") rejected.push(node.getAttribute("data-model-audit-stage") ?? "");
      } }).transform(new Response(renderReport(output.decision, presentation, {
        audience: "authenticated-research", research: null, guidance,
      }))).text();
    await new HTMLRewriter().on("[data-model-audit-origin]", { element() { commercialAudits++; } })
      .transform(new Response(renderReport(output.decision, presentation))).text();
    assert.equal(origin, "runner-output");
    assert.deepEqual(privateStages, ["1", "2", "3", "4", "5", "6"]);
    assert.equal(commercialAudits, 0);
    assert.equal(output.modelAudit.independentContribution, "not-established");
    assert.equal(output.modelAudit.validation.status, mismatch ? "validation-rejected" : "validation-passed");
    assert.deepEqual(rejected, mismatch ? ["2", "3", "6"] : []);
    assert.equal(output.decision.state, mismatch ? "needs-review" : "compared");
  } finally { adapter.dispose(); await adapter.settled(); }
});
