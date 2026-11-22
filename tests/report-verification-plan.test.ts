import assert from "node:assert/strict";
import { test } from "node:test";
import { createResourceDomain } from "../src/domain.ts";
import { createVerificationPlan } from "../src/o-verification-plan.ts";
import { createVerificationCandidates, presentAssessmentDecision } from "../src/o-verification-plan-candidates.ts";
import { buildCaseGuidance } from "../src/o-case-guidance.ts";
import { renderReport } from "../src/report.ts";
import { readableReason, readableReasons } from "../src/report-evidence.ts";
import { revision } from "../src/o-validation.ts";
import type { CaseInput } from "../src/contracts.ts";

const input: CaseInput = { caseId: "plan-view-case", description: "합성 PET", photoRefs: [],
  polymer: "PET", process: "성형", contamination: "미확인", hazardousContact: "yes",
  massKg: 24, region: "경기도", assessmentDate: "2026-11-20" };

test("a previously audited safety hold preserves advisory order through reason links without replacing the full checks", async () => {
    const decision = presentAssessmentDecision(await createResourceDomain(input).decide());
    const candidates = createVerificationCandidates(revision(input), decision);
    const output = { decision, verificationPlan: createVerificationPlan(input, decision, {
      raw: { selectedIds: candidates.items.slice(0, 2).reverse().map(item => item.id) }, origin: "runner-output", baseMatches: true,
    }) };
    assert.ok(output.decision.state === "needs-review");
    const guidance = await buildCaseGuidance(input, output.decision);
    const presentation = { mode: "synthetic" as const, verificationPlan: output.verificationPlan };
    let body = "", rejected = 0, origin: string | null = null;
    const links: string[] = [], originalLinks: string[] = [], checks: string[] = [];
    await new HTMLRewriter().on("main", { text(chunk) { body += chunk.text; } })
      .on("#verification-plan", { element(node) {
        origin = node.getAttribute("data-plan-origin");
        if (node.getAttribute("data-plan-status") === "rejected") rejected++;
      } }).on("[data-effective-verification-order] a", { element(node) { links.push(node.getAttribute("href") ?? ""); } })
      .on("[data-model-original-order] a", { element(node) { originalLinks.push(node.getAttribute("href") ?? ""); } })
      .on("#checks li", { element() { checks.push(""); }, text(chunk) { checks[checks.length - 1] += chunk.text; } })
      .transform(new Response(renderReport(output.decision, presentation, {
        audience: "authenticated-research", research: null, guidance,
      }))).text();
    assert.equal(origin, "runner-output");
    assert.equal(rejected, 0);
    assert.deepEqual(links, ["#case-reason-1", "#case-reason-2"]);
    assert.deepEqual(originalLinks, ["#case-reason-2", "#case-reason-1"]);
    assert.deepEqual(checks, (output.decision.preExecutionChecks ?? []).map(readableReason));
    for (const reason of readableReasons(output.decision.reasons)) assert.equal(body.split(reason).length - 1, 1);
    for (const context of [{ audience: "commercial" as const }, { audience: "authenticated-research" as const, research: null }]) {
      let plans = 0;
      await new HTMLRewriter().on("#verification-plan", { element() { plans++; } })
        .transform(new Response(renderReport(output.decision, presentation, context))).text();
      assert.equal(plans, 0);
    }
});

test("a previously audited safety hold with an out-of-scope selection retains host instructions", async () => {
    const decision = presentAssessmentDecision(await createResourceDomain(input).decide());
    const output = { decision, verificationPlan: createVerificationPlan(input, decision, {
      raw: { selectedIds: ["outside-current-case"] }, origin: "runner-output", baseMatches: true,
    }) };
    assert.ok(output.decision.state === "needs-review");
    const guidance = await buildCaseGuidance(input, output.decision);
    let status: string | null = null, proposedItems = 0, reasons = 0, safetyGroups = 0;
    await new HTMLRewriter().on("#verification-plan", { element(node) { status = node.getAttribute("data-plan-status"); } })
      .on('[data-effective-verification-order] [data-plan-source="model"]', { element() { proposedItems++; } })
      .on('[data-effective-verification-order] > li:first-child[data-plan-source="host-safety"]', { element() { safetyGroups++; } })
      .on("#case-reasons li", { element() { reasons++; } })
      .transform(new Response(renderReport(output.decision, { mode: "synthetic", verificationPlan: output.verificationPlan }, {
        audience: "authenticated-research", research: null, guidance,
      }))).text();
    assert.equal(status, "rejected");
    assert.equal(proposedItems, 0);
    assert.equal(safetyGroups, 1);
    assert.equal(reasons, readableReasons(output.decision.reasons).length);
});
