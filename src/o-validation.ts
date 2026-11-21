import { createHash } from "node:crypto";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { EvidenceRecord, Estimate, SourceQuantity } from "./contracts.ts";

export class ValidationError extends Error {
  constructor(readonly reason: string) { super(reason); this.name = "ValidationError"; }
}
export function requireValid(condition: boolean, reason: string): asserts condition {
  if (!condition) throw new ValidationError(reason);
}
/** Interpret explicit unknown answers without changing the stored input. */
export function isUnknownCaseText(value: string | null | undefined): boolean {
  return /^(?:미상|미확인|불명|모름|모른다|알수없음|알수없다|알수없습니다|unknown)?$/iu.test((value ?? "").normalize("NFKC").replace(/\s+/gu, ""));
}
export const text = Type.String({ minLength: 1, pattern: "\\S" });
export const strings = Type.Array(text);
export const nullableText = Type.Union([text, Type.Null()]);
export const RouteKindSchema = Type.Union([Type.Literal("reuse"), Type.Literal("mechanical-recycling"), Type.Literal("other-recovery"), Type.Literal("disposal")]);
export const CategorySchema = Type.Union([Type.Literal("transport"), Type.Literal("treatment"), Type.Literal("preprocessing"), Type.Literal("residue"), Type.Literal("other"), Type.Literal("sales")]);
export const StageSchema = Type.Union([Type.Literal("transport"), Type.Literal("preprocessing"), Type.Literal("treatment"), Type.Literal("residue"), Type.Literal("material-credit"), Type.Literal("energy-credit")]);
export const UnitSchema = Type.Union([Type.Literal("kWh"), Type.Literal("t-km"), Type.Literal("kg"), Type.Literal("t"), Type.Literal("L")]);
export const dateSchema = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" });
export function date(value: string): number {
  const time = Date.parse(`${value}T00:00:00Z`);
  requireValid(/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value, "invalid-date");
  return time;
}
export function timestamp(value: string): number {
  const time = Date.parse(value);
  requireValid(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) && Number.isFinite(time) && new Date(time).toISOString() === value.replace("Z", ".000Z"), "invalid-timestamp");
  return time;
}
export function period(start: string, end: string | null, on: string): boolean {
  const from = date(start), at = date(on), to = end === null ? Infinity : date(end);
  requireValid(from <= to, "reversed-period");
  return from <= at && at <= to;
}
export function unique(values: readonly string[], reason = "duplicate-id"): void {
  requireValid(values.every((v) => v.trim().length > 0) && new Set(values).size === values.length, reason);
}
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}
export function revision(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
export const EvidenceSchema = Type.Object({ sourceId: text, title: text, publisher: text, url: text, locator: text,
  retrievedAt: text, effectiveFrom: nullableText, effectiveTo: nullableText, datasetVersion: text, sha256: text,
  license: nullableText, licenseVerified: Type.Boolean() });
export interface ReviewedDocument {
  readonly record: EvidenceRecord;
  /** Actual immutable snapshot bytes, encoded as UTF-8 JSON {facts:{key:value}}. */
  readonly snapshot: string;
  readonly observedOn: string;
  readonly reviewedBy: string;
  readonly checkedAt: string;
  readonly maxAgeDays: number;
}
export const DocumentSchema = Type.Object({ record: EvidenceSchema, snapshot: text, observedOn: dateSchema,
  reviewedBy: text, checkedAt: text, maxAgeDays: Type.Integer({ minimum: 0 }) });
export interface EvidenceContext { readonly documents: readonly ReviewedDocument[]; }
const FactsSchema = Type.Object({ facts: Type.Record(Type.String(), Type.Unknown()) });
export function validateDocuments(context: EvidenceContext): void {
  requireValid(Value.Check(Type.Array(DocumentSchema), context.documents), "invalid-documents");
  unique(context.documents.map((d) => d.record.sourceId), "duplicate-source");
  for (const d of context.documents) {
    requireValid(createHash("sha256").update(d.snapshot).digest("hex") === d.record.sha256, "snapshot-hash-mismatch");
    timestamp(d.record.retrievedAt); timestamp(d.checkedAt); date(d.observedOn);
    requireValid(date(d.observedOn) <= timestamp(d.checkedAt), "observation-after-check");
    requireValid(date(d.observedOn) <= timestamp(d.record.retrievedAt) && timestamp(d.record.retrievedAt) <= timestamp(d.checkedAt), "invalid-observation-retrieval-check-order");
    if (d.record.effectiveFrom !== null) date(d.record.effectiveFrom);
    if (d.record.effectiveTo !== null) date(d.record.effectiveTo);
    if (d.record.effectiveFrom !== null && d.record.effectiveTo !== null) requireValid(d.record.effectiveFrom <= d.record.effectiveTo, "reversed-period");
    let snapshot: unknown;
    try { snapshot = JSON.parse(d.snapshot); } catch (error) { if (error instanceof SyntaxError) throw new ValidationError("invalid-snapshot-json"); throw error; }
    requireValid(Value.Check(FactsSchema, snapshot), "invalid-snapshot-facts");
  }
}
/** Binding locators are exact JSON-pointer prefixes followed by an escaped fact key. */
export function evidenceIssue(context: EvidenceContext, ids: readonly string[], fact: { readonly key: string; readonly value: unknown }, on: string): string | null {
  if (ids.length === 0) return "evidence-missing";
  for (const id of ids) {
    const d = context.documents.find((item) => item.record.sourceId === id);
    if (d === undefined) return "source-unresolved";
    if (!d.record.licenseVerified || d.record.license === null) return "reuse-unverified";
    if (!period(d.record.effectiveFrom ?? "0001-01-01", d.record.effectiveTo, on)) return "source-out-of-period";
    const age = (date(on) - date(d.observedOn)) / 86400000;
    if (age < 0 || age > d.maxAgeDays) return "source-stale";
    const raw: unknown = JSON.parse(d.snapshot);
    if (!Value.Check(FactsSchema, raw)) return "invalid-snapshot-facts";
    const locator = `/facts/${fact.key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
    if (d.record.locator !== "/facts" || !Object.hasOwn(raw.facts, fact.key) || canonical(raw.facts[fact.key]) !== canonical(fact.value)) return `fact-unbound:${locator}`;
  }
  return null;
}
export function unavailable(reason: string | readonly string[]): { readonly state: "unavailable"; readonly missingInputs: readonly string[] } {
  return { state: "unavailable", missingInputs: typeof reason === "string" ? [reason] : [...new Set(reason)] };
}
export function point<U extends "KRW" | "kgCO2e">(value: number, unit: U, evidenceIds: readonly string[]): Estimate<U> {
  requireValid(Number.isFinite(value), "arithmetic-overflow");
  return { state: "available", low: value, central: value, high: value, unit, evidenceIds: [...new Set(evidenceIds)], assumptions: ["입력값 고정 계산 · 불확실성 범위 미제공"] };
}
export function quantity(value: SourceQuantity<string>): number | null {
  requireValid(typeof value.unit === "string" && Array.isArray(value.evidenceIds), "invalid-quantity");
  if (value.value === null) return null;
  requireValid(Number.isFinite(value.value) && value.value >= 0, "invalid-number");
  return value.value;
}
export function sum<U extends "KRW" | "kgCO2e">(lines: readonly Estimate<U>[], unit: U): Estimate<U> {
  if (lines.length === 0) return unavailable("coverage-missing");
  const missing = lines.flatMap((v) => v.state === "unavailable" ? v.missingInputs : []);
  if (missing.length) return unavailable(missing);
  const available = lines.filter((v) => v.state === "available");
  const central = available.reduce((s, v) => s + v.central, 0), low = available.reduce((s, v) => s + v.low, 0), high = available.reduce((s, v) => s + v.high, 0);
  const result = point(central, unit, available.flatMap((v) => v.evidenceIds));
  requireValid(Number.isFinite(low) && Number.isFinite(high) && low <= central && central <= high, "invalid-interval-or-overflow");
  return result.state === "available" ? { ...result, low, high, assumptions: low === high ? result.assumptions : ["근거 제공 보수적 범위 · 신뢰구간 아님"] } : result;
}
export function subtract<U extends "KRW" | "kgCO2e">(gross: Estimate<U>, credits: readonly Estimate<U>[], unit: U): Estimate<U> {
  const all = [gross, ...credits];
  const missing = all.flatMap((v) => v.state === "unavailable" ? v.missingInputs : []);
  if (missing.length) return unavailable(missing);
  if (gross.state === "unavailable") return gross;
  const available = credits.filter((v) => v.state === "available");
  const central = gross.central - available.reduce((s, v) => s + v.central, 0);
  const low = gross.low - available.reduce((s, v) => s + v.high, 0), high = gross.high - available.reduce((s, v) => s + v.low, 0);
  const result = point(central, unit, [...gross.evidenceIds, ...available.flatMap((v) => v.evidenceIds)]);
  requireValid(Number.isFinite(low) && Number.isFinite(high) && low <= central && central <= high, "invalid-interval-or-overflow");
  return result.state === "available" ? { ...result, low, high, assumptions: low === high ? result.assumptions : ["근거 제공 보수적 범위 · 신뢰구간 아님"] } : result;
}
