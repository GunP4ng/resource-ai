import { Type } from "typebox";
import { Value } from "typebox/value";
import type { CaseInput, DecisionResult, EvidenceRecord, ResourceDomain, RouteAssessment } from "./contracts.ts";
import { lookupLegalEvidence, pendingLegalSources } from "./evidence.ts";
import type { EvidenceLookup, PendingLegalLookup } from "./evidence.ts";
import { collectMissingQuestions, parseCaseInput } from "./input.ts";
import type { InputIssue } from "./input.ts";
import { parseDecision } from "./o-decision.ts";
import { canonical, evidenceIssue, EvidenceSchema, requireValid, revision, RouteKindSchema, strings, text, unique as uniqueIds, validateDocuments, ValidationError } from "./o-validation.ts";
import type { EvidenceContext } from "./o-validation.ts";

const ReviewSchema = Type.Object({
  caseId: text, caseRevision: text, route: RouteKindSchema,
  legalEvidence: Type.Array(EvidenceSchema, { minItems: 1 }),
  checks: Type.Array(Type.Object({ requirement: text,
    state: Type.Union([Type.Literal("met"), Type.Literal("not-met"), Type.Literal("unknown")]),
    explanation: text }, { additionalProperties: false }), { minItems: 1 }),
  conditions: strings, evidenceIds: Type.Array(text, { minItems: 1 }),
}, { additionalProperties: false });

/** Server-reviewed supplement, never supplied by a model or submitted through the app. */
export type CaseRouteReview = Readonly<Type.Static<typeof ReviewSchema>>;
export interface RouteReviewContext extends EvidenceContext {
  readonly reviews: readonly CaseRouteReview[];
}

export interface AssessmentOptions {
  /** A separately supplied use, never inferred from the generating process or photo. */
  readonly intendedUse?: "general-resin" | "food-container";
}

/** H2 diagnostics for H3/H4. This is not a replacement for DecisionResult. */
export interface CaseAssessment {
  readonly caseId: string;
  readonly routes: readonly RouteAssessment[];
  readonly questions: readonly string[];
  /** Includes conditional code/type citations, issues and unresolved review requirements. */
  readonly legal: EvidenceLookup;
  readonly pendingLegal: PendingLegalLookup;
  readonly reviewReasons: readonly string[];
  /** Invalid server review data takes precedence over answerable missing case facts. */
  readonly reviewIssues: readonly string[];
  readonly requiredChecks: Readonly<Record<RouteAssessment["route"], readonly string[]>>;
  /** Validated derived review records; original J records retain their own IDs/locators. */
  readonly reviewEvidence: readonly EvidenceRecord[];
}

export class AssessmentInputError extends Error {
  constructor(readonly issues: readonly InputIssue[]) {
    super("경로 검토 입력이 CaseInput 계약에 맞지 않습니다.");
    this.name = "AssessmentInputError";
  }
}

// These identify missing case-level checks, not new legal eligibility rules.
const routeChecks: Readonly<Record<RouteAssessment["route"], string>> = {
  reuse: "재사용하려는 용도·방식과 해당 사례에 적용할 기준 및 충족 여부를 확인해야 합니다.",
  "mechanical-recycling": "실제 재활용 처리 공정·생산물 용도와 해당 사례에 적용할 유형·세부기준 및 충족 여부를 확인해야 합니다.",
  "other-recovery": "구체적인 회수 방식·생산물 용도와 해당 사례에 적용할 기준 및 충족 여부를 확인해야 합니다.",
  disposal: "구체적인 처분 방식과 해당 사례에 적용할 처리 기준 및 충족 여부를 확인해야 합니다.",
};
const routeKinds = ["reuse", "mechanical-recycling", "other-recovery", "disposal"] as const;
const unique = (values: readonly string[]): readonly string[] => [...new Set(values)];

/**
 * Re-evaluate explicit facts against J's bundled registry, with no model/network calls.
 * The optional server-owned supplement must bind explicit review findings to this
 * exact case revision and current legal records. Without it all routes remain unknown.
 * No absence of a match proves ineligibility; these checks do not invent legal rules.
 * H3 must consume the diagnostics as well as routes before producing DecisionResult.
 */
export function assessCase(input: CaseInput, options: AssessmentOptions = {}, reviews?: RouteReviewContext): CaseAssessment {
  const parsed = parseCaseInput(input);
  if (!parsed.ok) throw new AssessmentInputError(parsed.issues);
  const intendedUse = options.intendedUse;
  if (intendedUse !== undefined && intendedUse !== "general-resin" && intendedUse !== "food-container") {
    throw new RangeError("intendedUse는 general-resin 또는 food-container여야 합니다.");
  }
  const facts = parsed.value;
  const questions = collectMissingQuestions(facts);
  // J returns references to its registry records. Do not expose mutable registry aliases.
  const legal = structuredClone(lookupLegalEvidence(facts, undefined, { intendedUse }));
  const pendingLegal = structuredClone(pendingLegalSources(facts));
  const reviewReasons = unique([
    ...(facts.hazardousContact === "yes"
      ? ["유해물질 접촉이 보고되었습니다. 접촉 물질·시험 자료와 지정폐기물 해당 여부를 별도 검토해야 합니다."] : []),
    ...legal.reviewRequirements,
    ...[...legal.issues, ...pendingLegal.issues].map((issue) =>
      `법령 근거 확인 필요: ${issue.kind}${issue.sourceId === null ? "" : ` (${issue.sourceId})`}`),
    ...pendingLegal.pending.flatMap((source) => [
      `법령 원문 확인 미완료: ${source.sourceId} (${source.version})`,
      ...source.missing.map((missing) => `${source.sourceId}: ${missing}`),
    ]),
    ...(legal.evidence.length === 0 ? ["이 평가일·사례 조건에 사용할 수 있는 검증된 법령 근거가 없습니다."] : []),
  ]);
  const requiredChecks = Object.fromEntries(routeKinds.map((route) =>
    [route, unique([...legal.reviewRequirements, routeChecks[route]])])) as Record<RouteAssessment["route"], readonly string[]>;
  const reviewEvidence: EvidenceRecord[] = [];
  const reviewIssues: string[] = [];
  let invalidContext: string | undefined;
  if (reviews !== undefined) {
    try {
      requireValid(Value.Check(Type.Array(ReviewSchema), reviews.reviews), "invalid-route-reviews");
      validateDocuments(reviews);
      uniqueIds(reviews.reviews.map((review) => review.route), "duplicate-route-review");
    } catch (error) {
      invalidContext = error instanceof ValidationError ? error.reason : "invalid-route-reviews";
      reviewIssues.push(invalidContext);
    }
  }
  const routes: readonly RouteAssessment[] = routeKinds.map((route) => {
    const hold = (issue?: string): RouteAssessment => ({
      routeId: route,
      route,
      eligibility: {
        state: "unknown",
        missingFacts: unique([...questions, ...reviewReasons, routeChecks[route], ...(issue ? [`route-review:${issue}`] : [])]),
      },
    });
    if (invalidContext !== undefined) return hold(invalidContext);
    const review = reviews?.reviews.find((item) => item.route === route);
    if (review === undefined || reviews === undefined) return hold();
    // A supplement cannot override incomplete facts, currentness failures or unsupported context.
    if (questions.length || facts.hazardousContact !== "no" || legal.issues.length
      || pendingLegal.issues.length || pendingLegal.pending.length || !legal.evidence.length) return hold("case-context-unresolved");
    try {
      requireValid(review.caseId === facts.caseId && review.caseRevision === revision(facts), "case-revision-mismatch");
      uniqueIds(review.legalEvidence.map((record) => record.sourceId));
      const byId = (records: readonly EvidenceRecord[]) => [...records].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
      requireValid(canonical(byId(review.legalEvidence)) === canonical(byId(legal.evidence)), "legal-evidence-mismatch");
      uniqueIds(review.checks.map((check) => check.requirement), "duplicate-review-check");
      requireValid(requiredChecks[route].every((requirement) => review.checks.some((check) => check.requirement === requirement)), "review-check-missing");
      requireValid(review.checks.every((check) => check.state !== "unknown"), "review-check-unresolved");
      uniqueIds(review.evidenceIds);
      const issue = evidenceIssue(reviews, review.evidenceIds, { key: `eligibility:${facts.caseId}:${route}`, value: review }, facts.assessmentDate);
      requireValid(issue === null, issue ?? "review-unbound");
      const records = review.evidenceIds.map((id) => reviews.documents.find((doc) => doc.record.sourceId === id)!);
      requireValid(records.every((doc) => doc.record.license?.trim() && doc.checkedAt.slice(0, 10) <= facts.assessmentDate
        && !legal.evidence.some((record) => record.sourceId === doc.record.sourceId)), "review-provenance-invalid");
      const failed = review.checks.filter((check) => check.state === "not-met");
      const assessed: RouteAssessment = { routeId: route, route, eligibility: failed.length
        ? { state: "ineligible", evidenceIds: [...review.evidenceIds], reasons: failed.map((check) => `${check.requirement}: ${check.explanation}`) }
        : { state: "eligible", evidenceIds: [...review.evidenceIds], conditions: [...review.conditions] } };
      // Share exactly the same reviewed route fact with O1; never manufacture a snapshot.
      const routeIssue = evidenceIssue(reviews, review.evidenceIds,
        { key: `route:${facts.caseId}:${route}`, value: { caseRevision: revision(facts), route: assessed } }, facts.assessmentDate);
      requireValid(routeIssue === null, routeIssue ?? "route-unbound");
      for (const doc of records) if (!reviewEvidence.some((record) => record.sourceId === doc.record.sourceId)) reviewEvidence.push(structuredClone(doc.record));
      return assessed;
    } catch (error) {
      const issue = error instanceof ValidationError ? error.reason : "invalid-route-review";
      reviewIssues.push(`${route}:${issue}`);
      return hold(issue);
    }
  });
  return { caseId: facts.caseId, routes, questions, legal, pendingLegal, reviewReasons, reviewIssues, requiredChecks, reviewEvidence };
}

/** ResourceDomain-compatible projection; use assessCase when collecting H3 diagnostics. */
export const assessRoutes: ResourceDomain["assessRoutes"] = async (input) => assessCase(input).routes;

/**
 * H3 host gate. Recompute from the current case and the bundled registry each time.
 * A model/tool proposal cannot supply its own trust store, facts or human approval.
 * This synchronous fallback never authorizes comparison. createResourceDomain.decide
 * also validates the server comparison supplements and runs O's async operations.
 */
export function decideCase(input: CaseInput, proposal?: unknown, options: AssessmentOptions = {}, reviews?: RouteReviewContext): DecisionResult {
  const parsed = parseCaseInput(input);
  if (!parsed.ok) throw new AssessmentInputError(parsed.issues);
  const facts = parsed.value;
  const assessment = assessCase(facts, options, reviews);
  const evidence = [...assessment.legal.evidence, ...assessment.reviewEvidence];
  const rejected: string[] = [];
  if (proposal !== undefined) {
    try {
      const candidate = parseDecision(proposal);
      if (candidate.caseId !== assessment.caseId) rejected.push("proposal-case-mismatch");
      for (const record of candidate.evidence) {
        if (!record.licenseVerified || record.license === null || record.license.trim() === "") rejected.push("proposal-reuse-unverified");
        const trusted = evidence.find((item) => item.sourceId === record.sourceId);
        if (trusted === undefined) rejected.push("proposal-source-unresolved");
        else if (canonical(trusted) !== canonical(record)) rejected.push("proposal-evidence-conflict");
      }
      if (candidate.state === "compared") {
        if (candidate.humanApproval !== "pending") rejected.push("proposal-human-approval-forbidden");
        // Even a genuine citation does not prove a case-specific route or calculation.
        rejected.push("proposal-compared-not-authorized");
      }
    } catch (error) {
      rejected.push(error instanceof ValidationError ? `proposal-${error.reason}` : "proposal-invalid");
    }
  }
  // Missing context is answerable. Known risk, ambiguous/unrelated context and source
  // failures take precedence, while the missing questions remain visible in reasons.
  const needsReview = facts.hazardousContact === "yes" || rejected.length > 0 || assessment.reviewIssues.length > 0
    || assessment.pendingLegal.pending.length > 0 || assessment.pendingLegal.issues.length > 0
    || assessment.legal.issues.some((issue) => issue.kind !== "context-missing"
      && !(issue.kind === "hazardous-contact-unconfirmed" && facts.hazardousContact === "unknown"));
  if (!needsReview && assessment.questions.length > 0) {
    return { state: "needs-information", caseId: assessment.caseId,
      questions: assessment.questions, evidence };
  }
  return {
    state: "needs-review", caseId: assessment.caseId, evidence,
    reasons: unique([
      ...rejected, ...assessment.reviewReasons, ...assessment.reviewIssues, ...assessment.questions,
      ...assessment.routes.flatMap((route) => route.eligibility.state === "unknown" ? route.eligibility.missingFacts
        : route.eligibility.state === "ineligible" ? route.eligibility.reasons : []),
      "현장 담당자의 검토와 승인 전에는 반출·계약·처리를 실행할 수 없습니다.",
    ]),
  };
}
