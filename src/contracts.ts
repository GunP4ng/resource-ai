/**
 * Design contracts only. Runtime parsing and domain operations are team work.
 * null means unknown, never zero. Units are encoded in property names.
 */
export interface CaseInput {
  readonly caseId: string;
  readonly description: string;
  readonly photoRefs: readonly string[];
  readonly process: string | null;
  readonly polymer: string | null;
  readonly contamination: string | null;
  readonly hazardousContact: "yes" | "no" | "unknown";
  readonly massKg: number | null;
  readonly region: string | null;
  readonly assessmentDate: string;
}

export interface EvidenceRecord {
  readonly sourceId: string;
  readonly title: string;
  readonly publisher: string;
  readonly url: string;
  readonly locator: string;
  readonly retrievedAt: string;
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
  readonly datasetVersion: string;
  readonly sha256: string;
  readonly license: string | null;
  readonly licenseVerified: boolean;
}

export type Eligibility =
  | { readonly state: "eligible"; readonly evidenceIds: readonly string[]; readonly conditions: readonly string[] }
  | { readonly state: "ineligible"; readonly evidenceIds: readonly string[]; readonly reasons: readonly string[] }
  | { readonly state: "unknown"; readonly missingFacts: readonly string[] };

export interface RouteAssessment {
  readonly routeId: string;
  readonly route: "reuse" | "mechanical-recycling" | "other-recovery" | "disposal";
  readonly eligibility: Eligibility;
}

export interface ProcessorCandidate {
  readonly processorId: string;
  readonly name: string;
  readonly region: string;
  readonly acceptedWasteCodes: readonly string[];
  readonly permitEvidenceIds: readonly string[];
  readonly verifiedAt: string | null;
  readonly acceptance: "unconfirmed" | "confirmed";
}

export type Estimate<Unit extends "KRW" | "kgCO2e"> =
  | {
      readonly state: "available";
      readonly low: number;
      readonly central: number;
      readonly high: number;
      readonly unit: Unit;
      readonly evidenceIds: readonly string[];
      readonly assumptions: readonly string[];
    }
  | { readonly state: "unavailable"; readonly missingInputs: readonly string[] };

export interface SourceQuantity<Unit extends string> {
  readonly value: number | null;
  readonly unit: Unit;
  readonly evidenceIds: readonly string[];
  readonly missingReason: string | null;
}

export type CostCategory = "transport" | "treatment" | "preprocessing" | "residue" | "other" | "sales";

export type QuoteBasis =
  | { readonly kind: "per-kg"; readonly rate: SourceQuantity<"KRW/kg">; readonly amount: SourceQuantity<"kg"> }
  | { readonly kind: "per-tonne"; readonly rate: SourceQuantity<"KRW/t">; readonly amount: SourceQuantity<"t"> }
  | { readonly kind: "per-trip"; readonly rate: SourceQuantity<"KRW/trip">; readonly amount: SourceQuantity<"trip"> }
  | { readonly kind: "total"; readonly amount: SourceQuantity<"KRW"> };

export interface QuoteInput {
  readonly quoteId: string;
  readonly category: CostCategory;
  readonly basis: QuoteBasis;
  readonly validThrough: string | null;
  readonly vat: "included" | "excluded" | "unknown";
  readonly includedInQuoteId: string | null;
  readonly revenueRecipient: "operator" | "processor" | "not-applicable";
}

export type ActivityUnit = "kWh" | "t-km" | "kg" | "t" | "L";
export type CarbonStage = "transport" | "preprocessing" | "treatment" | "residue" | "material-credit" | "energy-credit";

export interface FactorRecord {
  readonly factorId: string;
  readonly version: string;
  /** kgCO2e per one denominatorUnit; no untyped ratio string. */
  readonly kgCo2ePerUnit: SourceQuantity<"kgCO2e">;
  readonly denominatorUnit: ActivityUnit;
  readonly boundary: string;
  readonly period: string;
  readonly region: string;
  readonly gwpMethod: string;
  readonly includedStages: readonly CarbonStage[];
  readonly reusePermission: "verified" | "unverified";
}

export interface ActivityInput {
  readonly activityId: string;
  readonly stage: CarbonStage;
  readonly amount: SourceQuantity<ActivityUnit>;
  readonly factorId: string | null;
  readonly factorVersion: string | null;
}

export interface RouteCalculationInput {
  readonly routeId: string;
  readonly quotes: readonly QuoteInput[];
  readonly activities: readonly ActivityInput[];
  readonly missingInputs: readonly string[];
}

export interface ComparisonInput {
  readonly caseId: string;
  readonly assessmentDate: string;
  readonly functionalUnit: string;
  readonly boundary: string;
  readonly baselineRouteId: string | null;
  readonly routes: readonly RouteCalculationInput[];
  readonly factorRegistryVersion: string;
  readonly factors: readonly FactorRecord[];
  readonly evidence: readonly EvidenceRecord[];
}

export interface CostLineResult {
  readonly quoteId: string;
  readonly category: CostCategory;
  readonly amount: Estimate<"KRW">;
}

export interface CarbonLineResult {
  readonly activityId: string;
  readonly stage: CarbonStage;
  readonly factorId: string | null;
  readonly factorVersion: string | null;
  readonly amount: Estimate<"kgCO2e">;
}

export interface ScenarioComparison {
  readonly routeId: string;
  readonly functionalUnit: string;
  readonly boundary: string;
  readonly costLines: readonly CostLineResult[];
  readonly carbonLines: readonly CarbonLineResult[];
  readonly netCost: Estimate<"KRW">;
  readonly grossEmissions: Estimate<"kgCO2e">;
  readonly materialCredit: Estimate<"kgCO2e">;
  readonly energyCredit: Estimate<"kgCO2e">;
  readonly netEmissions: Estimate<"kgCO2e">;
  readonly avoidedEmissions:
    | { readonly state: "no-baseline" }
    | { readonly state: "baseline-provided"; readonly baselineRouteId: string; readonly amount: Estimate<"kgCO2e"> };
}

export type DecisionResult =
  | {
      readonly state: "needs-information";
      readonly caseId: string;
      readonly questions: readonly string[];
      readonly evidence: readonly EvidenceRecord[];
    }
  | {
      readonly state: "needs-review";
      readonly caseId: string;
      readonly reasons: readonly string[];
      readonly evidence: readonly EvidenceRecord[];
    }
  | {
      readonly state: "compared";
      readonly caseId: string;
      readonly routes: readonly RouteAssessment[];
      readonly processors: readonly ProcessorCandidate[];
      readonly scenarios: readonly ScenarioComparison[];
      readonly evidence: readonly EvidenceRecord[];
      readonly limitations: readonly string[];
      readonly humanApproval: "pending" | "approved";
    };

/** Proposed application boundaries, not senpi framework APIs. */
export interface ResourceDomain {
  assessRoutes(input: CaseInput): Promise<readonly RouteAssessment[]>;
  findProcessors(input: CaseInput, route: RouteAssessment): Promise<readonly ProcessorCandidate[]>;
  compare(input: ComparisonInput, routes: readonly RouteAssessment[]): Promise<readonly ScenarioComparison[]>;
}
