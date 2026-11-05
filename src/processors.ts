import { Type } from "typebox";
import { Value } from "typebox/value";
import type { CaseInput, ProcessorCandidate, ResourceDomain, RouteAssessment } from "./contracts.ts";
import type { ProcessorDirectoryRow } from "./sources.ts";
import { CaseSchema, RouteSchema } from "./o-decision.ts";
import { date, dateSchema, evidenceIssue, nullableText, period, requireValid, revision, strings, text, timestamp, unique, validateDocuments } from "./o-validation.ts";
import type { EvidenceContext } from "./o-validation.ts";

const ScopeSchema = Type.Object({ caseId: text, caseRevision: text, routeId: text, wasteCode: text,
  codeVersion: text, evidenceIds: strings });
const PermitSchema = Type.Object({ processorId: text, name: text, directorySourceId: text, directoryRow: Type.Integer({ minimum: 2 }),
  facilityId: text, identity: Type.Union([Type.Literal("facility"), Type.Literal("office"), Type.Literal("ambiguous")]),
  permitId: text, authority: text, codes: strings, codeVersion: text, operations: strings, regions: strings,
  regionLabel: text, status: Type.Union([Type.Literal("active"), Type.Literal("suspended"), Type.Literal("revoked")]),
  effectiveFrom: dateSchema, effectiveTo: nullableText, openEnded: Type.Boolean(), conditions: strings,
  observedOn: dateSchema, verifiedAt: text, maxAgeDays: Type.Integer({ minimum: 0 }), reviewer: text, evidenceIds: strings });
const AcceptanceSchema = Type.Object({ processorId: text, caseRevision: text, routeId: text, massKg: Type.Number({ minimum: 0 }),
  confirmedOn: dateSchema, expiresOn: dateSchema, conditions: strings, evidenceIds: strings });
const DirectorySchema = Type.Object({ sourceId: text, rowNumber: Type.Integer({ minimum: 2 }), name: text, district: Type.String(), officeAddress: Type.String(), serviceArea: Type.String(), description: Type.String(), sourceDate: dateSchema, permitStatus: Type.Literal("unverified"), acceptedWasteCodes: strings });
export type ProcessorScope = Readonly<Type.Static<typeof ScopeSchema>>;
export type ProcessorPermit = Readonly<Type.Static<typeof PermitSchema>>;
export type AcceptanceConfirmation = Readonly<Type.Static<typeof AcceptanceSchema>>;
export interface ProcessorContext extends EvidenceContext {
  readonly version: string;
  readonly directory: readonly ProcessorDirectoryRow[];
  readonly scopes: readonly ProcessorScope[];
  readonly permits: readonly ProcessorPermit[];
  readonly acceptance: readonly AcceptanceConfirmation[];
}
export interface ProcessorDiagnostic { readonly processorId: string | null; readonly reason: string; }
export function findProcessorsWithDiagnostics(input: CaseInput, route: RouteAssessment, context: ProcessorContext): {
  readonly candidates: readonly ProcessorCandidate[]; readonly diagnostics: readonly ProcessorDiagnostic[];
} {
  requireValid(Value.Check(CaseSchema, input) && Value.Check(RouteSchema, route), "invalid-case-or-route");
  const assessmentDate = date(input.assessmentDate);
  validateDocuments(context);
  requireValid(context.version.trim().length > 0, "context-version-missing");
  requireValid(Value.Check(Type.Array(ScopeSchema), context.scopes) && Value.Check(Type.Array(PermitSchema), context.permits) && Value.Check(Type.Array(AcceptanceSchema), context.acceptance) && Value.Check(Type.Array(DirectorySchema), context.directory), "invalid-processor-metadata");
  unique(context.scopes.map((s) => `${s.caseId}:${s.routeId}`)); unique(context.permits.map((p) => p.processorId));
  unique(context.acceptance.map((a) => `${a.processorId}:${a.caseRevision}:${a.routeId}`));
  unique(context.directory.map((r) => `${r.sourceId}:${r.rowNumber}`));
  unique(context.permits.map((p) => `${p.authority}:${p.permitId}`), "duplicate-permit");
  unique(context.permits.map((p) => p.facilityId), "duplicate-facility");
  // Validate every record before scope/eligibility filtering, including inactive permits.
  const validatedPermits = context.permits.map((permit) => {
    const inPeriod = period(permit.effectiveFrom, permit.effectiveTo, input.assessmentDate);
    const verifiedAt = timestamp(permit.verifiedAt);
    const observedOn = date(permit.observedOn);
    return { permit, inPeriod, verifiedAt, observedOn };
  });
  for (const a of context.acceptance) period(a.confirmedOn, a.expiresOn, input.assessmentDate);
  for (const r of context.directory) date(r.sourceDate);
  const diagnostics: ProcessorDiagnostic[] = [];
  const stop = (reason: string) => ({ candidates: [], diagnostics: [{ processorId: null, reason }] });
  const scope = context.scopes.find((s) => s.caseId === input.caseId && s.routeId === route.routeId && s.caseRevision === revision(input));
  if (scope === undefined) return stop("waste-code-unverified");
  const scopeIssue = evidenceIssue(context, scope.evidenceIds, { key: `scope:${scope.caseId}:${scope.routeId}`, value: scope }, input.assessmentDate);
  if (scopeIssue !== null) return stop(scopeIssue);
  if (route.eligibility.state !== "eligible") return stop("route-not-eligible");
  const routeIssue = evidenceIssue(context, route.eligibility.evidenceIds, { key: `route:${input.caseId}:${route.routeId}`, value: { caseRevision: revision(input), route } }, input.assessmentDate);
  if (routeIssue !== null) return stop(routeIssue);
  const candidates: ProcessorCandidate[] = [];
  for (const { permit: p, inPeriod, verifiedAt, observedOn } of validatedPermits) {
    const row = context.directory.find((r) => r.sourceId === p.directorySourceId && r.rowNumber === p.directoryRow);
    const age = (assessmentDate - observedOn) / 86400000;
    const issue = evidenceIssue(context, p.evidenceIds, { key: `permit:${p.processorId}`, value: p }, input.assessmentDate)
      ?? (row === undefined || row.name !== p.name || p.identity !== "facility" ? "facility-identity-unverified" : null)
      ?? (!p.codes.includes(scope.wasteCode) || p.codeVersion !== scope.codeVersion ? "waste-code-mismatch" : null)
      ?? (!p.operations.includes(route.route) ? "operation-mismatch" : null)
      ?? (p.status !== "active" || (p.effectiveTo === null && !p.openEnded) || !inPeriod ? "permit-invalid" : null)
      ?? (input.region === null || p.regions.length === 0 ? "region-unverified" : !p.regions.includes(input.region) ? "region-mismatch" : null)
      ?? (age < 0 || age > p.maxAgeDays || verifiedAt < observedOn ? "permit-stale" : null)
      ?? (p.conditions.length > 0 ? "permit-conditions-unresolved" : null);
    if (issue !== null) { diagnostics.push({ processorId: p.processorId, reason: issue }); continue; }
    const a = context.acceptance.find((v) => v.processorId === p.processorId && v.caseRevision === revision(input) && v.routeId === route.routeId);
    const confirmed = a !== undefined && a.massKg === input.massKg && a.conditions.length === 0 && period(a.confirmedOn, a.expiresOn, input.assessmentDate)
      && evidenceIssue(context, a.evidenceIds, { key: `acceptance:${p.processorId}:${input.caseId}:${route.routeId}`, value: a }, input.assessmentDate) === null;
    if (a !== undefined && !confirmed) diagnostics.push({ processorId: p.processorId, reason: "acceptance-unverified-or-expired" });
    candidates.push({ processorId: p.processorId, name: p.name, region: p.regionLabel, acceptedWasteCodes: [...p.codes], permitEvidenceIds: [...p.evidenceIds], verifiedAt: p.verifiedAt, acceptance: confirmed ? "confirmed" : "unconfirmed" });
  }
  if (context.permits.length === 0) diagnostics.push({ processorId: null, reason: "permits-unverified" });
  return { candidates, diagnostics };
}
export function createProcessorFinder(context: ProcessorContext): ResourceDomain["findProcessors"] {
  const frozen = structuredClone(context);
  return async (input, route) => findProcessorsWithDiagnostics(input, route, frozen).candidates;
}
