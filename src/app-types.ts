import type { DecisionResult, CaseInput } from "./contracts.ts";
import type { ReportPresentation } from "./report.ts";
import type { createLocalAuth } from "./o-auth.ts";
import type { OCaseStore } from "./o-case-store.ts";
import type { createPhotoStore } from "./photos.ts";
import type { PhotoExecutionAuthority } from "./photo-execution.ts";
import type { ModelHostAudit } from "./o-model-audit.ts";
import type { VerificationPlan } from "./o-verification-plan.ts";
export interface AssessmentEnvelope {
  readonly decision: DecisionResult;
  readonly execution?: { readonly traceId: string; readonly usage?: string | null };
  readonly modelAudit?: ModelHostAudit;
  /** Optional advisory selection, separate from actual safety/eligibility and required checks. */
  readonly verificationPlan?: VerificationPlan;
}
export type StoredAssessment = AssessmentEnvelope;
/** Proposed H1/H4 handoff; not a senpi API. No provider is invoked by this module. */
export interface AssessmentAdapter {
  submit(raw: unknown, signal: AbortSignal): Promise<DecisionResult | AssessmentEnvelope>;
  answer(caseId: string, raw: unknown, signal: AbortSignal): Promise<DecisionResult | AssessmentEnvelope>;
}
export interface AppDependencies {
  readonly origin: string;
  readonly adapter?: AssessmentAdapter;
  readonly timeoutMs?: number;
  readonly maxBodyBytes?: number;
  readonly now?: () => number;
  /** Trusted server verification only; never read caller-supplied actor fields here. */
  readonly actorForRequest?: (request: Request, signal: AbortSignal) => Promise<string | { readonly actorId: string; readonly validUntil: number; readonly assertCurrent?: () => void } | null>;
  readonly localAuth?: ReturnType<typeof createLocalAuth>;
  readonly runtime?: ReportPresentation["runtime"];
  readonly presentationMode?: ReportPresentation["mode"];
  readonly preparer?: {
    prepareSubmit(raw: unknown, format: "json" | "form"): CaseInput;
    prepareAnswer(input: CaseInput, raw: unknown): CaseInput;
    evaluate(input: CaseInput, signal: AbortSignal): Promise<AssessmentEnvelope>;
  };
  readonly caseStore?: OCaseStore;
  readonly photoStore?: Awaited<ReturnType<typeof createPhotoStore>>;
  readonly photoPolicy?: { readonly retentionMs: number; readonly guardedModel?: { readonly provider: string; readonly purpose: string } };
  readonly photoExecution?: PhotoExecutionAuthority;
  readonly checkRequest?: () => void;
  readonly committed?: () => void;
}

export interface RouteServices {
  readonly dependencies: AppDependencies;
  readonly origin: string;
  readonly now: () => number;
  readonly caseStore: OCaseStore;
  readonly maxBodyBytes: number;
  readonly photoEnabled: boolean;
  readonly cancelLease: (lease: Parameters<OCaseStore["rollback"]>[0]) => void;
}
export interface RouteRequest {
  readonly request: Request;
  readonly url: URL;
  readonly signal: AbortSignal;
  readonly guard: (signal: AbortSignal) => void;
  readonly privateGuard: () => void;
  readonly actor: string | null;
  readonly owner: string;
  readonly sessionDeadline: number | undefined;
  readonly caseMatch: RegExpExecArray | null;
  readonly photoMatch: RegExpExecArray | null;
}
