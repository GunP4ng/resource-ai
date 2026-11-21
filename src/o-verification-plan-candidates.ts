import type { DecisionResult } from "./contracts.ts";
import { revision } from "./o-validation.ts";
import { verificationLimits, type VerificationCandidates } from "./o-verification-plan-schema.ts";

const answerInstruction = '추가 답변은 필드별 JSON으로 입력해 주세요. 예: {"massKg":100,"process":"사출"}. 숫자에는 따옴표를 붙이지 않습니다.';

/** Existing adapter presentation, shared so tool candidate IDs bind the final displayed decision. */
export function presentAssessmentDecision(decision: DecisionResult): DecisionResult {
  return decision.state === "needs-information"
    ? { ...decision, questions: [...decision.questions, answerInstruction] } : decision;
}

/** Only current host fields. Overlong items are omitted, never silently rewritten or truncated. */
export function createVerificationCandidates(inputRevision: string, decision: DecisionResult): VerificationCandidates {
  const binding = { caseId: decision.caseId, inputRevision, decisionRevision: revision(decision) };
  const entries: { source: VerificationCandidates["items"][number]["source"]; text: string }[] = [];
  switch (decision.state) {
    case "needs-information":
      entries.push(...decision.questions.map(text => ({ source: "question" as const, text })));
      break;
    case "needs-review":
      entries.push(...decision.reasons.map(text => ({ source: "reason" as const, text })),
        ...(decision.preExecutionChecks ?? []).map(text => ({ source: "pre-execution-check" as const, text })));
      break;
    case "compared":
      entries.push(...(decision.preExecutionChecks ?? []).map(text => ({ source: "pre-execution-check" as const, text })));
      break;
  }
  const unique = new Map<string, typeof entries[number]>();
  for (const entry of entries) {
    if (entry.text !== answerInstruction && !unique.has(entry.text)) unique.set(entry.text, entry);
  }
  const items = [...unique.values()].filter(item => item.text.length <= verificationLimits.text)
    .slice(0, verificationLimits.candidates).map(item => ({ id: `vp_${revision({ ...binding, ...item })}`, ...item }));
  return { ...binding, items, candidateCount: unique.size, offeredCount: items.length, omittedCount: unique.size - items.length,
    candidateLimit: verificationLimits.candidates, textLimit: verificationLimits.text, selectionLimit: verificationLimits.selections };
}
