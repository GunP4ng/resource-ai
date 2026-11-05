import { defineTool, type ExtensionAPI } from "@code-yeongyu/senpi";
import { Type } from "typebox";

/**
 * Honest scaffold diagnostics. Domain decisions are deliberately not implemented.
 * Teams replace/add domain tools after agreeing on contracts and evidence gates.
 */
export const projectStatusTool = defineTool({
  name: "resource_project_status",
  label: "Re:Source AI project status",
  description: "Report implementation readiness. Does not classify waste or recommend treatment.",
  parameters: Type.Object({}),
  workspaceEffect: "read",
  async execute() {
    const details = {
      stage: "scaffold",
      decisionEngine: "not-implemented",
      nextDocument: "docs/delivery-plan.md",
    };
    return {
      content: [{ type: "text", text: JSON.stringify(details) }],
      details,
    };
  },
});

// The official senpi loader requires a default extension factory.
export default function resourceExtension(pi: ExtensionAPI): void {
  pi.registerTool(projectStatusTool);
}
