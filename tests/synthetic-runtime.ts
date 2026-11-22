import { createAssessmentAdapter, createResourceApp } from "../src/session.ts";
import type { CaseRunner } from "../src/session.ts";
import { createOperationalApp } from "../src/operations.ts";

/** Test-only input to the real host engine. No model proposal, execution or usage is fabricated. */
export const syntheticRunner: CaseRunner = async (_input, signal) => {
  signal.throwIfAborted();
  return {};
};

export function createSyntheticAssessmentAdapter(options: Parameters<typeof createAssessmentAdapter>[0] = {}) {
  return createAssessmentAdapter({ ...options, runner: options.runner ?? syntheticRunner });
}

export function createSyntheticResourceApp(options: Parameters<typeof createResourceApp>[0]) {
  return createResourceApp({ presentationMode: "synthetic", ...options, runner: options.runner ?? syntheticRunner });
}

export function createSyntheticOperationalApp(options: Parameters<typeof createOperationalApp>[0],
  open?: Parameters<typeof createOperationalApp>[1]) {
  return createOperationalApp({ presentationMode: "synthetic", ...options,
    ...(!options.operations ? { runner: options.runner ?? syntheticRunner } : {}) }, open);
}
