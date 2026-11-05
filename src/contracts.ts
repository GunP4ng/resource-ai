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

export interface ScenarioComparison {
  readonly routeId: string;
  readonly functionalUnit: string;
  readonly boundary: string;
  readonly netCost: Estimate<"KRW">;
  readonly emissions: Estimate<"kgCO2e">;
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
  compare(input: CaseInput, routes: readonly RouteAssessment[]): Promise<readonly ScenarioComparison[]>;
}
