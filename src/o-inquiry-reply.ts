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
  readonly inputId: string;
  readonly unit: string;
  readonly amount: number | null;
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
/** Only reported metadata and one explicit model-unit hypothesis cross this boundary. */
export function parseInquiryReply(raw: unknown, options: readonly ReplyAmountOption[]): InquiryReply {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new InquiryReplyInputError("본문");
  const fields: Record<string, unknown> = Object.fromEntries(Object.entries(raw));
  const allowed = ["baseVersion", "inputRevision", "companyName", "acceptance", "permitCheckDate", "sourceNote",
    "inputId", "unit", "amount", "hypotheticalAcknowledgement"];
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
  const inputId = text("inputId", 100), unit = text("unit", 100);
  if (!options.some(option => option.inputId === inputId && option.unit === unit)) throw new InquiryReplyInputError("계산 항목·단위");
  if (fields["hypotheticalAcknowledgement"] !== "yes") throw new InquiryReplyInputError("가정 비교 동의");
  const rawAmount = fields["amount"];
  if (typeof rawAmount !== "string" && typeof rawAmount !== "number") throw new InquiryReplyInputError("금액");
  const empty = typeof rawAmount === "string" && rawAmount.trim() === "";
  if (!empty && typeof rawAmount === "string" && !/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(rawAmount.trim())) {
    throw new InquiryReplyInputError("금액");
  }
  const amount = empty ? null : Number(rawAmount);
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) throw new InquiryReplyInputError("금액");
  return { companyName, acceptance, permitCheckDate, sourceNote, inputId, unit, amount };
}
