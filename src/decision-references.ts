import { randomUUID } from "node:crypto";
import type { DecisionResult } from "./contracts.ts";
import { parseDecision } from "./o-decision.ts";
import { revision } from "./o-validation.ts";

export interface DecisionReference {
  readonly caseId: string;
  readonly sha256: string;
  readonly token: string;
}

/** One isolated session's references to exact host results, not model-authored facts. */
export function createDecisionReferences(caseId: string) {
  const issued = new Map<string, { reference: DecisionReference; decision: DecisionResult }>();
  let closed = false;
  const invalid = (): never => { throw new Error("invalid-decision-reference"); };
  return {
    issue(value: DecisionResult): DecisionReference {
      if (closed) return invalid();
      const decision = structuredClone(parseDecision(value));
      if (decision.caseId !== caseId) return invalid();
      const reference = Object.freeze({ caseId, sha256: revision(decision), token: randomUUID() });
      issued.set(reference.token, { reference, decision });
      return reference;
    },
    resolve(value: unknown): DecisionResult {
      if (closed || typeof value !== "object" || value === null || Array.isArray(value)
        || Object.keys(value).length !== 1 || !Object.hasOwn(value, "decisionReference")) return invalid();
      const ref: unknown = (value as Record<string, unknown>)["decisionReference"];
      if (typeof ref !== "object" || ref === null || Array.isArray(ref)) return invalid();
      const keys = Object.keys(ref).sort();
      if (keys.join() !== "caseId,sha256,token") return invalid();
      const record = ref as Record<string, unknown>;
      if (typeof record["token"] !== "string") return invalid();
      const saved = issued.get(record["token"]);
      if (!saved || record["caseId"] !== caseId || record["sha256"] !== saved.reference.sha256) return invalid();
      return structuredClone(saved.decision);
    },
    close() { closed = true; issued.clear(); },
  };
}
