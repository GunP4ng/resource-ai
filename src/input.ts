import type { CaseInput } from "./contracts.ts";
import { MAX_CASE_MASS_KG } from "./contracts.ts";
import { safetyReasons } from "./o-safety-reasons.ts";
import { canonicalMaterial, materialFamily } from "./material-context.ts";
import { isUnknownCaseText } from "./o-validation.ts";

export const massQuestion = "확인된 질량은 몇 kg인가요?";
export const resinQuestion = "확인된 수지 종류와 이를 확인한 자료(라벨·재질 명세 등)가 있나요?";

export interface InputIssue {
  readonly field: keyof CaseInput | "$";
  readonly code: "required" | "invalid";
  readonly message: string;
}

/** Input-boundary result only; success does not imply route eligibility. */
export type CaseInputParseResult =
  | { readonly ok: true; readonly value: CaseInput }
  | { readonly ok: false; readonly issues: readonly InputIssue[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

function isPhotoRefs(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(isString);
}

function isHazardousContact(value: unknown): value is CaseInput["hazardousContact"] {
  return value === "yes" || value === "no" || value === "unknown";
}

function isMassKg(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value > 0 && value <= MAX_CASE_MASS_KG);
}

function isAssessmentDate(value: unknown): value is string {
  if (!isString(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

/**
 * Validate structured input without coercion, inference, or mutation.
 * All CaseInput keys must be own properties, including nullable keys.
 * The returned value copies contract fields and photoRefs; extra keys are ignored.
 */
export function parseCaseInput(raw: unknown): CaseInputParseResult {
  if (!isRecord(raw)) {
    return { ok: false, issues: [{ field: "$", code: "invalid", message: "입력은 객체여야 합니다." }] };
  }
  const input = raw;
  const issues: InputIssue[] = [];
  function readField<Key extends keyof CaseInput>(
    field: Key,
    accepts: (value: unknown) => value is CaseInput[Key],
    message: string,
  ): CaseInput[Key] | undefined {
    if (!Object.hasOwn(input, field)) {
      issues.push({ field, code: "required", message: "필수 키가 없습니다." });
      return undefined;
    }
    const supplied = input[field];
    // Snapshot photos once; validate and return the same dense copy, including sparse slots.
    const value = field === "photoRefs" && Array.isArray(supplied) ? Array.from(supplied) : supplied;
    if (!accepts(value)) {
      issues.push({ field, code: "invalid", message });
      return undefined;
    }
    return value;
  }

  const caseId = readField("caseId", isString, "문자열이어야 합니다.");
  const description = readField("description", isString, "문자열이어야 합니다.");
  const photoRefs = readField("photoRefs", isPhotoRefs, "모든 항목이 문자열인 배열이어야 합니다. 빈 배열은 허용합니다.");
  const process = readField("process", isNullableString, "문자열 또는 null이어야 합니다.");
  const polymer = readField("polymer", isNullableString, "문자열 또는 null이어야 합니다.");
  const contamination = readField("contamination", isNullableString, "문자열 또는 null이어야 합니다.");
  const hazardousContact = readField("hazardousContact", isHazardousContact, "yes, no, unknown 중 하나여야 합니다.");
  const massKg = readField("massKg", isMassKg, `null 또는 0 < kg <= ${MAX_CASE_MASS_KG} 범위의 유한한 숫자여야 합니다.`);
  const region = readField("region", isNullableString, "문자열 또는 null이어야 합니다.");
  const assessmentDate = readField("assessmentDate", isAssessmentDate, "YYYY-MM-DD 형식의 실제 달력 날짜여야 합니다.");

  if (caseId === undefined || description === undefined || photoRefs === undefined || process === undefined
    || polymer === undefined || contamination === undefined || hazardousContact === undefined
    || massKg === undefined || region === undefined || assessmentDate === undefined) {
    return { ok: false, issues };
  }
  return { ok: true, value: {
    caseId, description, photoRefs, process, polymer, contamination,
    hazardousContact, massKg, region, assessmentDate,
  } };
}

/**
 * Call after parsing. Questions depend only on explicit structured facts.
 * Blank free text remains unchanged but needs clarification; no material is inferred.
 */
export function collectMissingQuestions(input: CaseInput): readonly string[] {
  const questions: string[] = [];
  const missingText = (value: string | null): boolean => value === null || value.trim() === "";
  const material = materialFamily(input);
  if (isUnknownCaseText(input.process)) questions.push(material ? "폐자원이 발생한 공정 또는 발생원은 무엇인가요?" : "폐플라스틱이 발생한 공정 또는 발생원은 무엇인가요?");
  if (isUnknownCaseText(input.polymer) || canonicalMaterial(input.polymer) === null) questions.push(material ? "확인된 재질·품목과 이를 확인한 자료(재질 명세·발생 이력 등)가 있나요?" : resinQuestion);
  if (missingText(input.contamination)) questions.push("오염이나 이물질이 있나요? 확인된 상태를 알려 주세요.");
  if (input.hazardousContact === "unknown") questions.push(safetyReasons.contactUnknown);
  if (input.massKg === null) questions.push(massQuestion);
  if (isUnknownCaseText(input.region)) questions.push(material ? "폐자원이 발생한 지역은 어디인가요?" : "폐플라스틱이 발생한 지역은 어디인가요?");
  return questions;
}
