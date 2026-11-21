import type { CalculationContext } from "./o-calculation-variant.ts";

export interface ReplyAmountOption {
  readonly inputId: string;
  readonly label: string;
  readonly unit: string;
}
export interface InquiryReply {
  readonly companyName: string;
  readonly acceptance: "unknown" | "yes" | "conditional" | "no";
  readonly permitCheckDate: string;
  readonly sourceNote: string;
  readonly amounts: readonly (ReplyAmountOption & { readonly amount: number | null })[];
}
export class InquiryReplyInputError extends Error {
  constructor(readonly field: string) { super(`문의 답변 입력을 확인해 주세요: ${field}`); }
}
export function replyAmountOptions(context: { readonly calculations: Pick<CalculationContext["calculations"], "inputs"> }, material: string | null): readonly ReplyAmountOption[] {
  const labels = new Map([["f_inc", "소각 처리비"], ["f_rec", "재활용 처리비"],
    [`${material}.price`, "재활용 매각 가격"]]);
  return context.calculations.inputs.flatMap(input => {
    const label = labels.get(input.input_id);
    return label === undefined ? [] : [{ inputId: input.input_id, label, unit: input.unit }];
  });
}
/** Reported metadata and explicit model-unit hypotheses only; legacy single-amount bodies remain valid. */
export function parseInquiryReply(raw: unknown, options: readonly ReplyAmountOption[]): InquiryReply {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new InquiryReplyInputError("본문");
  const fields: Record<string, unknown> = Object.fromEntries(Object.entries(raw));
  const allowed = ["baseVersion", "inputRevision", "companyName", "acceptance", "permitCheckDate", "sourceNote",
    "inputId", "unit", "amount", "hypotheticalAcknowledgement",
    ...options.flatMap(option => [`amount_${option.inputId}`, `unit_${option.inputId}`])];
  if (Object.keys(fields).some(key => !allowed.includes(key))) throw new InquiryReplyInputError("필드");
  const text = (key: string, max: number, optional = false) => {
    const value = fields[key];
    if (value === undefined && optional) return "";
    if (typeof value !== "string" || value.length > max) throw new InquiryReplyInputError(key);
    return value.trim();
  };
  const companyName = text("companyName", 200), sourceNote = text("sourceNote", 2000, true);
  if (!companyName) throw new InquiryReplyInputError("업체명");
  const acceptance = fields["acceptance"];
  if (acceptance !== "unknown" && acceptance !== "yes" && acceptance !== "conditional" && acceptance !== "no") {
    throw new InquiryReplyInputError("반입 수락 신고");
  }
  const permitCheckDate = text("permitCheckDate", 10, true);
  if (permitCheckDate && (!/^\d{4}-\d{2}-\d{2}$/.test(permitCheckDate)
    || !Number.isFinite(Date.parse(permitCheckDate)) || new Date(permitCheckDate).toISOString().slice(0, 10) !== permitCheckDate)) {
    throw new InquiryReplyInputError("허가 확인일 신고");
  }
  if (fields["hypotheticalAcknowledgement"] !== "yes") throw new InquiryReplyInputError("가정 비교 동의");
  const amountOf = (rawAmount: unknown): number | null => {
    if (typeof rawAmount !== "string" && typeof rawAmount !== "number") throw new InquiryReplyInputError("금액");
    const empty = typeof rawAmount === "string" && rawAmount.trim() === "";
    if (!empty && typeof rawAmount === "string" && !/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(rawAmount.trim())) {
      throw new InquiryReplyInputError("금액");
    }
    const amount = empty ? null : Number(rawAmount);
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) throw new InquiryReplyInputError("금액");
    return amount;
  };
  const legacy = ["inputId", "unit", "amount"].some(key => Object.hasOwn(fields, key));
  const multiple = options.some(option => Object.hasOwn(fields, `amount_${option.inputId}`) || Object.hasOwn(fields, `unit_${option.inputId}`));
  if (legacy && multiple) throw new InquiryReplyInputError("금액 입력 방식");
  const amounts = options.flatMap(option => {
    const key = `amount_${option.inputId}`, unitKey = `unit_${option.inputId}`;
    if (!Object.hasOwn(fields, key) && !Object.hasOwn(fields, unitKey)) return [];
    if (text(unitKey, 100) !== option.unit) throw new InquiryReplyInputError("계산 항목·단위");
    return [{ ...option, amount: amountOf(fields[key]) }];
  });
  if (legacy) {
    const inputId = text("inputId", 100), unit = text("unit", 100);
    const option = options.find(option => option.inputId === inputId && option.unit === unit);
    if (!option) throw new InquiryReplyInputError("계산 항목·단위");
    amounts.push({ ...option, amount: amountOf(fields["amount"]) });
  }
  return { companyName, acceptance, permitCheckDate, sourceNote, amounts };
}

/** The optional second reply uses the same boundary; no reply can override another reply. */
export function parseInquiryReplies(raw: unknown, options: readonly ReplyAmountOption[]): readonly InquiryReply[] {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new InquiryReplyInputError("본문");
  const entries = Object.entries(raw);
  const primary = Object.fromEntries(entries.filter(([key]) => !key.startsWith("second_")));
  const secondary = Object.fromEntries(entries.filter(([key]) => key.startsWith("second_"))
    .map(([key, value]) => [key.slice(7), value]));
  const first = parseInquiryReply(primary, options);
  if (Object.keys(secondary).length === 0) return [first];
  // A native optional group posts blank fields. Check even unused fields for hostile keys/types/units.
  const blank = Object.entries(secondary).every(([key, value]) =>
    (["companyName", "permitCheckDate", "sourceNote"].includes(key) && value === "")
    || (key === "acceptance" && value === "unknown")
    || options.some(option => (key === `amount_${option.inputId}` && value === "")
      || (key === `unit_${option.inputId}` && value === option.unit)));
  if (blank) return [first];
  if (["baseVersion", "inputRevision", "hypotheticalAcknowledgement"].some(key => Object.hasOwn(secondary, key))) {
    throw new InquiryReplyInputError("두 번째 회신 필드");
  }
  return [first, parseInquiryReply({ ...secondary, hypotheticalAcknowledgement: primary["hypotheticalAcknowledgement"] }, options)];
}
