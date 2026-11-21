import type { CaseResearchAttachment } from "./o-case-research-schema.ts";
import type { PublicInputScenario } from "./o-input-public-scenario.ts";
import type { ImplementationReceipt } from "./o-public-calculation-data.ts";
import { buildPublicCalculations } from "./o-public-calculation-engine.ts";
import type { PublicCalculationBundle } from "./o-public-calculation-engine.ts";
import { revision } from "./o-validation.ts";

export type CalculationContext = CaseResearchAttachment | PublicInputScenario | CalculationVariant;
export interface CalculationVariant {
  readonly version: 1;
  readonly purpose: "hypothetical-calculation";
  readonly binding: CaseResearchAttachment["binding"];
  readonly calculations: Pick<PublicCalculationBundle,
    "model_version" | "sources" | "inputs" | "cases" | "routes" | "results" | "limitations">;
  readonly provenance: {
    readonly parentFixtureSha256: string;
    readonly parentManifestSha256: string;
    readonly derivedDatasetSha256: string;
    readonly derivedProvenanceSha256: string;
    readonly implementation: ImplementationReceipt;
  };
  readonly assumptions: readonly string[];
  readonly overrides: readonly { readonly inputId: string; readonly value: number; readonly unit: string }[];
  readonly use: CaseResearchAttachment["use"];
}
export class CalculationVariantError extends Error {
  constructor(readonly code: "invalid-override" | "invalid-reason") { super(code); }
}

/** Ephemeral derivation receipt, never a pinned fixture or an update to actual evidence. */
export function buildCalculationVariant(context: CalculationContext,
  overrides: readonly { readonly inputId: string; readonly value: number }[], reason: string): CalculationVariant {
  if (!reason.trim()) throw new CalculationVariantError("invalid-reason");
  const seen = new Set<string>();
  for (const item of overrides) {
    if (seen.has(item.inputId) || !Number.isFinite(item.value)
      || !context.calculations.inputs.some(input => input.input_id === item.inputId)) {
      throw new CalculationVariantError("invalid-override");
    }
    seen.add(item.inputId);
  }
  const parent = context.purpose === "research-display"
    ? { parentFixtureSha256: context.calculations.fixtureSha256,
      parentManifestSha256: context.calculations.manifestSha256, implementation: context.calculations.implementation }
    : { parentFixtureSha256: context.provenance.derivedDatasetSha256,
      parentManifestSha256: context.provenance.derivedProvenanceSha256, implementation: context.provenance.implementation };
  const copied = structuredClone(context.calculations);
  const inputs = copied.inputs.map(input => {
    const override = overrides.find(item => item.inputId === input.input_id);
    return override === undefined ? input : { ...input, value: override.value, kind: "assumed" as const,
      source_id: null, source_value: null, source_unit: null, cell_id: null, missing_reason: null,
      transform: "hypothesis_same_model_unit", assumption_reason: reason,
      depends_on_input_ids: [], quality_grade: "hypothesis_unverified",
      geography: "hypothesis_unverified", period: "hypothesis_unverified",
      tax_basis: "unverified_no_tax_conversion" };
  });
  const details = copied.inputs.flatMap(input => {
    const override = overrides.find(item => item.inputId === input.input_id);
    return override === undefined ? [] : [{ ...override, unit: input.unit }];
  });
  const assumptions = [...(context.purpose === "research-display"
    ? copied.inputs.flatMap(input => input.assumption_reason === null ? [] : [input.assumption_reason]) : context.assumptions),
    reason, ...details.map(item => `${item.inputId} = ${item.value} ${item.unit} (가설 · 미검증)`) ];
  const data = { schema_version: 1 as const, model_version: copied.model_version,
    sources: copied.sources, inputs, cases: copied.cases, limitations: copied.limitations };
  const derivedDatasetSha256 = revision(data);
  const derivedProvenanceSha256 = revision({ binding: context.binding, ...parent,
    derivedDatasetSha256, assumptions, overrides: details });
  const bundle = buildPublicCalculations({ data, fixture_sha256: derivedDatasetSha256,
    manifest_sha256: derivedProvenanceSha256, calculator_sha256: parent.implementation.sha256,
    implementation: parent.implementation });
  return structuredClone({ version: 1, purpose: "hypothetical-calculation", binding: context.binding,
    calculations: { model_version: bundle.model_version, sources: bundle.sources, inputs: bundle.inputs,
      cases: bundle.cases, routes: bundle.routes, results: bundle.results, limitations: bundle.limitations },
    provenance: { ...parent, derivedDatasetSha256, derivedProvenanceSha256 },
    assumptions, overrides: details, use: context.use });
}
