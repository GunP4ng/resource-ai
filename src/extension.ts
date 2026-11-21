import { defineTool, type ExtensionAPI } from "@code-yeongyu/senpi";
import { Type } from "typebox";
import type { CaseInput, DecisionResult } from "./contracts.ts";
import { createResourceDomain } from "./domain.ts";
import type { DomainResources } from "./domain.ts";
import type { DecisionReference } from "./decision-references.ts";
import { createVerificationCandidates, presentAssessmentDecision } from "./o-verification-plan-candidates.ts";
import { revision } from "./o-validation.ts";

/**
 * Registration diagnostics. Eligibility and live Azure verification remain incomplete.
 */
export const projectStatusTool = defineTool({
  name: "resource_project_status",
  label: "Re:Source AI project status",
  description: "Report implementation readiness. Does not classify waste or recommend treatment.",
  parameters: Type.Object({}),
  workspaceEffect: "read",
  async execute() {
    const details = {
      stage: "review-bound-host-comparison",
      decisionEngine: "server-reviewed-inputs-required",
      routeEligibility: "case-review-supplement-required",
      azureLiveVerified: false,
      nextDocument: "docs/delivery-plan.md",
    };
    return {
      content: [{ type: "text", text: JSON.stringify(details) }],
      details,
    };
  },
});

/** Only these case-bound read-only tools are exposed to the application session. */
export function createCaseTools(input: CaseInput, resources: DomainResources = {}, reference?: (decision: DecisionResult) => DecisionReference) {
  const domain = createResourceDomain(input, resources);
  const respond = (details: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(details) }], details });
  return [
    defineTool({
      name: "resource_assess_case", label: "사례 근거와 검토 상태", workspaceEffect: "read",
      description: "Read the host-owned case assessment, questions and conditional citations. Cannot change facts or approve treatment.",
      parameters: Type.Object({}, { additionalProperties: false }),
      async execute(_id, _params, signal) {
        signal?.throwIfAborted();
        const decision = await domain.decide();
        return respond({ assessment: domain.assess(), decision,
          verificationCandidates: createVerificationCandidates(revision(input), presentAssessmentDecision(decision)),
          ...(reference ? { decisionReference: reference(decision) } : {}) });
      },
    }),
    defineTool({
      name: "resource_find_processors", label: "업체 확인", workspaceEffect: "read",
      description: "Read processor candidates for a host route. Directory listing is not a permit or acceptance confirmation.",
      parameters: Type.Object({ routeId: Type.String() }, { additionalProperties: false }),
      async execute(_id, params, signal) {
        signal?.throwIfAborted();
        const route = domain.assess().routes.find((r) => r.routeId === params.routeId);
        if (route === undefined) return respond({ candidates: [], missing: ["unknown-route-id"] });
        if (route.eligibility.state !== "eligible") return respond({ candidates: [], missing: ["route-not-eligible"] });
        return respond({ candidates: await domain.findProcessors(input, route), readiness: domain.readiness() });
      },
    }),
    defineTool({
      name: "resource_compare", label: "비용·탄소 비교", workspaceEffect: "read",
      description: "Calculate using server-owned reviewed inputs only. Never invent quotes, factors or a baseline.",
      parameters: Type.Object({}, { additionalProperties: false }),
      async execute(_id, _params, signal) {
        signal?.throwIfAborted();
        const comparison = domain.comparison();
        const routes = domain.assess().routes;
        if (comparison === undefined || !domain.readiness().calculations) return respond({ state: "unavailable", missingInputs: ["reviewed-comparison-resources-missing"] });
        if (!routes.some((r) => r.eligibility.state === "eligible")) return respond({ state: "unavailable", missingInputs: ["eligible-route-unverified"] });
        const decision = await domain.decide();
        if (decision.state === "compared") return respond(reference ? { decision, decisionReference: reference(decision) } : decision);
        return respond({ state: "unavailable",
          missingInputs: decision.state === "needs-review" ? decision.reasons : decision.questions });
      },
    }),
  ];
}

// The official senpi loader requires a default extension factory.
export default function resourceExtension(pi: ExtensionAPI): void {
  pi.registerTool(projectStatusTool);
}
