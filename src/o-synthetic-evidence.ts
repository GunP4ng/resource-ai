import { createHash } from "node:crypto";
import type { CaseInput, RouteAssessment } from "./contracts.ts";
import type { EvidenceContext } from "./o-validation.ts";
import { revision } from "./o-validation.ts";
import type { ProcessorContext, ProcessorPermit } from "./processors.ts";
export const sourceId = "synthetic-evidence";
export const caseInput: CaseInput = { caseId: "synthetic-case", description: "합성 시험용 폐플라스틱", photoRefs: [], process: "synthetic-process", polymer: "synthetic-polymer", contamination: "synthetic-dry", hazardousContact: "no", massKg: 2000, region: "synthetic-region", assessmentDate: "2026-11-05" };
export const route: RouteAssessment = { routeId: "synthetic-route", route: "mechanical-recycling", eligibility: { state: "eligible", evidenceIds: [sourceId], conditions: ["합성 조건 · 현장 적용 불가"] } };
export function documents(facts: Readonly<Record<string, unknown>>): EvidenceContext {
  const snapshot = JSON.stringify({ facts });
  return { documents: [{ snapshot, observedOn: "2026-11-01", reviewedBy: "synthetic-reviewer", checkedAt: "2026-11-05T00:00:00Z", maxAgeDays: 30,
    record: { sourceId, title: "합성 검증 문서", publisher: "합성 데모", url: "https://example.org/synthetic-evidence", locator: "/facts", retrievedAt: "2026-11-05T00:00:00Z", effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31", datasetVersion: "synthetic-v1", sha256: createHash("sha256").update(snapshot).digest("hex"), license: "synthetic-test-only", licenseVerified: true } }] };
}
export function processorFixture(change: Partial<ProcessorPermit> = {}, acceptance = false, acceptanceExpiry = "2026-10-31"): ProcessorContext {
  const scope = { caseId: caseInput.caseId, caseRevision: revision(caseInput), routeId: route.routeId, wasteCode: "synthetic-code", codeVersion: "synthetic-v1", evidenceIds: [sourceId] };
  const permit: ProcessorPermit = { processorId: "synthetic-facility", name: "합성 처리시설", directorySourceId: "synthetic-directory", directoryRow: 2, facilityId: "synthetic-site", identity: "facility", permitId: "synthetic-permit", authority: "합성 기관", codes: ["synthetic-code"], codeVersion: "synthetic-v1", operations: ["mechanical-recycling"], regions: ["synthetic-region"], regionLabel: "합성 권역", status: "active", effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31", openEnded: false, conditions: [], observedOn: "2026-11-01", verifiedAt: "2026-11-05T00:00:00Z", maxAgeDays: 30, reviewer: "synthetic-reviewer", evidenceIds: [sourceId], ...change };
  const a = { processorId: permit.processorId, caseRevision: revision(caseInput), routeId: route.routeId, massKg: 2000, confirmedOn: "2026-10-01", expiresOn: acceptanceExpiry, conditions: [], evidenceIds: [sourceId] };
  return { version: "synthetic-v1", ...documents({ [`scope:${caseInput.caseId}:${route.routeId}`]: scope, [`route:${caseInput.caseId}:${route.routeId}`]: { caseRevision: revision(caseInput), route }, [`permit:${permit.processorId}`]: permit, [`acceptance:${permit.processorId}:${caseInput.caseId}:${route.routeId}`]: a }), scopes: [scope], permits: [permit], acceptance: acceptance ? [a] : [], directory: [{ sourceId: "synthetic-directory", rowNumber: 2, name: permit.name, district: "합성", officeAddress: "합성 사무실", serviceArea: "합성", description: "합성", sourceDate: "2026-11-01", permitStatus: "unverified", acceptedWasteCodes: [] }] };
}
