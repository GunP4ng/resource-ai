/** Exact host-produced messages. These are not inferred from model wording. */
export const safetyReasons = {
  contactUnknown: "유해물질과 접촉했는지 확인할 수 있나요?",
  contaminationUnknown: "오염·접촉 이력에 미확인 내용이 있습니다. 이전 내용물·접촉 물질명과 SDS 등 확인 자료, 잔류물·세척 확인 자료가 있나요? 확인 전에는 세척 여부만으로 유해물질 접촉이 없었다고 확정하지 않습니다.",
  contactReported: "유해물질 접촉이 보고되었습니다. 접촉 물질·시험 자료와 지정폐기물 해당 여부를 별도 검토해야 합니다.",
  contactClassification: "유해물질 접촉·지정폐기물 해당 여부 검토 필요",
  designatedSuspected: "지정폐기물 의심 입력",
  contactSuspected: "유해물질 접촉 의심 입력",
} as const;

// Mask only a complete terminal clause in one field. The comma keeps adjacent text separated.
export function maskExplicitHazardDenial(field: string | null): string {
  return (field ?? "").replace(/(?:^|,)[\p{Zs}\t]*(?:지정폐기물[\p{Zs}\t]*(?:해당[\p{Zs}\t]*사항|가능성|의심)|유해물질[\p{Zs}\t]*접촉[\p{Zs}\t]*의심)[\p{Zs}\t]*없음\s*\.?\s*$/u, ",");
}

export function isProhibitedReviewExplanation(text: string): boolean {
  return /(?:법령|법률)상.*금지|명백히\s*금지|\bprohibited\b|\billegal\b/iu.test(text);
}

const messages = new Set<string>(Object.values(safetyReasons));

/** Only call on the current host decision's held reasons/questions. */
export function isHostSafetyReason(text: string): boolean {
  return messages.has(text)
    || text.startsWith("법령 근거 확인 필요: hazardous-contact-unconfirmed")
    || text.includes("지정폐기물 제외")
    || isProhibitedReviewExplanation(text);
}
