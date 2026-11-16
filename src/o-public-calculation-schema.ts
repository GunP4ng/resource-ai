import { Type } from "typebox";

export const strict = { additionalProperties: false } as const;
export const digest = Type.String({ pattern: "^[a-f0-9]{64}$" });
const caseText = Type.String();
const caseMaybe = Type.Union([caseText, Type.Null()]);
export const CaseInputSchema = Type.Object({
  caseId: caseText, description: caseText, photoRefs: Type.Array(caseText),
  process: caseMaybe, polymer: caseMaybe, contamination: caseMaybe,
  hazardousContact: Type.Union([Type.Literal("yes"), Type.Literal("no"), Type.Literal("unknown")]),
  massKg: Type.Union([Type.Number({ exclusiveMinimum: 0 }), Type.Null()]),
  region: caseMaybe, assessmentDate: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
}, strict);
export const CandidateProvenanceSchema = Type.Object({
  candidateId: caseText, path: caseText, sha256: digest, origin: Type.Literal("synthetic"),
  source: caseText, sourceUrl: Type.Null(), creationDate: caseText, collector: caseText,
  missingPhotos: Type.Boolean(), missingEvidence: Type.Boolean(), photoRefs: Type.Array(caseText),
  evidenceRefs: Type.Array(caseText), rightsStatus: caseText, license: Type.Null(),
  proposedStratum: caseText, duplicateGroup: caseText, scenarioProvenance: caseText,
  sourceGroupReview: Type.Null(), independentLabels: Type.Null(), reviewers: Type.Null(),
  split: Type.Null(), acceptance: Type.Null(),
}, strict);
const text = Type.String({ minLength: 1, pattern: "\\S" }), nullable = Type.Union([Type.Number(), Type.Null()]);
const strings = Type.Array(text), maybeText = Type.Union([text, Type.Null()]);
const rights = Type.Union([Type.Literal("allowed_with_conditions"), Type.Literal("unconfirmed"), Type.Literal("prohibited")]);
const cell = Type.Object({ cell_id: text, material: text, region: text, row: Type.Integer(), column: Type.Integer(), value: Type.Number() }, { additionalProperties: false });
const source = Type.Object({ source_id: text, agency: text, title: text, url: text, retrieved_at: text,
  published_or_period: text, locator: text, original_unit: text, rights_url: text, rights_notice_summary: text,
  commercial_use: rights, redistribution: rights, rights_checked_at: text, raw_sha256: digest,
  selected_cells: Type.Array(cell), limitations: strings, geography: text, gwp: text, boundary: text }, { additionalProperties: false });
const input = Type.Object({ input_id: text, value: nullable, unit: text,
  kind: Type.Union([Type.Literal("published_reference"), Type.Literal("assumed"), Type.Literal("derived")]),
  source_id: maybeText, source_value: nullable, source_unit: maybeText, transform: text, assumption_reason: maybeText,
  geography: text, period: text, quality_grade: text, tax_basis: text, depends_on_input_ids: strings,
  missing_reason: maybeText, cell_id: maybeText, gwp: text, boundary: text }, { additionalProperties: false });
const scenario = Type.Object({ case_id: text, material: text, mass_t: nullable, scenario_type: Type.Literal("synthetic"),
  label: text, calculation_label: text, input_ids: strings, material_mapping_assumption: text, facility_eligibility: text,
  commercial_ready: Type.Literal(false), model_version: text, original_path: text, original_sha256: digest,
  assessment_date: text, law_version: text, original: CaseInputSchema, provenance: CandidateProvenanceSchema }, { additionalProperties: false });
export const fixtureSchema = Type.Object({ schema_version: Type.Literal(1), model_version: text,
  sources: Type.Array(source), inputs: Type.Array(input), cases: Type.Array(scenario), limitations: strings }, { additionalProperties: false });
const filePin = Type.Object({ path: text, sha256: digest }, { additionalProperties: false });
export const manifestSchema = Type.Object({ schema_version: Type.Literal(1), fixture_sha256: digest,
  metadata_sha256: digest, upstream: Type.Array(filePin), private_evidence: Type.Array(filePin) }, { additionalProperties: false });
export type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export type Dataset = DeepReadonly<Type.Static<typeof fixtureSchema>>;
export type Input = Dataset["inputs"][number];

const missing = Type.Object({ cost: strings, carbon: strings }, strict);
const shared = {
  case_id: text, route_id: Type.Union([Type.Literal("recycling"), Type.Literal("landfill"), Type.Literal("energy_recovery")]),
  model_version: text, scenario_type: Type.Literal("synthetic"), label: text, calculation_label: text,
  facility_eligibility: text, commercial_ready: Type.Literal(false), carbon_boundary_id: text,
  embedded_transport: Type.Literal(true),
};
export const PublicCalculationRouteSchema = Type.Object({ ...shared,
  steps: strings, mass_flow: Type.Object({ input_t: nullable, recycling_t: nullable, residue_t: nullable }, strict),
  distance_legs: Type.Array(Type.Object({ mass_t: nullable, distance_input_id: text }, strict)),
  cost_formula: text, carbon_formula: text, missing_inputs: missing,
}, strict);
export const PublicCalculationResultSchema = Type.Object({ ...shared,
  input_ids: strings, source_ids: strings,
  cost_components_krw: Type.Union([Type.Object({ collection: Type.Number(), transport: Type.Number(),
    sorting: Type.Number(), treatment: Type.Number() }, strict), Type.Null()]),
  revenue_krw: nullable, net_cost_krw: nullable, net_carbon_kgco2e: nullable,
  baseline_id: text, cost_saving_krw: nullable, scenario_carbon_difference_kgco2e: nullable,
  transport_diagnostic_kgco2e: Type.Null(), transport_diagnostic_reason: text, rights_status: text,
  availability: Type.Object({ cost: text, carbon: text }, strict), missing_inputs: missing,
  per_tonne: Type.Object({ cost_krw: nullable, carbon_kgco2e: nullable }, strict),
  rounding: Type.Object({ internal: text, KRW_display: Type.Integer(), kgCO2e_display: Type.Integer(), mode: text }, strict),
  display: Type.Object({ net_cost_krw: maybeText, net_carbon_kgco2e: maybeText,
    cost_saving_krw: maybeText, scenario_carbon_difference_kgco2e: maybeText }, strict),
}, strict);
export type PublicCalculationRoute = DeepReadonly<Type.Static<typeof PublicCalculationRouteSchema>>;
export type PublicCalculationResult = DeepReadonly<Type.Static<typeof PublicCalculationResultSchema>>;
export type PublicCalculationCase = Dataset["cases"][number];
