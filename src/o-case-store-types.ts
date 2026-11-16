import type { CaseInput } from "./contracts.ts";
import type { AssessmentEnvelope } from "./app.ts";
import type { ReportPresentation } from "./report.ts";
import type { PhotoReceipt } from "./photos.ts";
import type { PhotoExecutionTicket } from "./photo-execution.ts";
import type { CaseArtifact } from "./o-case-artifact.ts";
import type { CaseResearchReport } from "./o-case-research-schema.ts";

export class CaseConflict extends Error {}
export interface CaseSnapshot {
  readonly owner: string;
  readonly input: CaseInput;
  readonly assessment: AssessmentEnvelope;
  readonly version: number;
  readonly expires: number;
  readonly editUntil: number;
  readonly photos: readonly PhotoReceipt[];
  readonly denied: readonly string[];
  readonly pendingCleanup: readonly string[];
  readonly permissionChanged: boolean;
  readonly evaluated: { readonly revision: string; readonly version: number; readonly committedAt: number };
  readonly review: { readonly hash: string; readonly origin: CaseArtifact["record"]["dataOrigin"]; readonly caseRevision: string } | null;
  readonly presentation?: ReportPresentation;
}
export interface CleanupCursor {
  readonly queuedAt: number;
  readonly caseId: string;
  readonly photoRef: string;
}
export interface CaseRow { case_id: string; owner: string; version: number; row_revision: number; notice_generation: number; expires: number; edit_until: number; snapshot: string; review_hash: string | null }
export interface LeaseRow { case_id: string; token: string; owner: string; expected_version: number | null; notice_generation: number; created_at: number; expires: number }
export interface Lease {
  readonly owner: string; readonly caseId: string; readonly base: number | null; readonly token: string; readonly notices: number;
  readonly controller: AbortController; identityGuard?: () => void; input?: CaseInput; ticket?: PhotoExecutionTicket; artifact?: CaseArtifact | null; presentation?: ReportPresentation; open: boolean;
}
export interface OperationBinding {
  readonly leaseToken: string;
  readonly actorId: string;
  readonly caseId: string;
  readonly inputRevision: string;
  readonly artifact: Readonly<{ hash: string; origin: "synthetic" | "field" }> | null;
}
export interface CaseReport {
  readonly snapshot: CaseSnapshot;
  readonly research: CaseResearchReport | null;
}
export interface StoredReviewTarget {
  readonly owner: string;
  readonly caseId: string;
  readonly inputRevision: string;
}
export interface StoredReview {
  readonly provenance: NonNullable<CaseSnapshot["review"]>;
  readonly input: CaseInput;
  readonly research: CaseResearchReport | null;
}
export const maxSnapshot = 1048576, maxArtifact = 67108864, maxArtifacts = 536870912;
export const CASE_LEASE_MS = 65000;
