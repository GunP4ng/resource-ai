import { Value } from "typebox/value";
import { HistorySdkUsageSchema } from "./o-history-schema.ts";
import type { HistoryCase, HistoryEvidence } from "./o-history-schema.ts";
import { canonical, requireValid } from "./o-validation.ts";
import { parseHistoryJson } from "./o-history-validation.ts";

/** API input includes cached input. SDK input excludes cacheRead. Never add these two views. */
export function historySum(values: readonly number[]): number {
  return values.reduce((sum, value) => {
    const next = sum + value;
    requireValid(Number.isSafeInteger(value) && value >= 0 && Number.isSafeInteger(next), "history-overflow");
    return next;
  }, 0);
}
export function historyCaseUsage(c: HistoryCase) {
  for (const r of c.requests) requireValid(r.usage.cached_input_tokens <= r.usage.input_tokens
    && r.usage.total_tokens === historySum([r.usage.input_tokens, r.usage.output_tokens]), "history-request-usage");
  const api = { input: historySum(c.requests.map(r => r.usage.input_tokens)),
    output: historySum(c.requests.map(r => r.usage.output_tokens)),
    cachedInput: historySum(c.requests.map(r => r.usage.cached_input_tokens)),
    total: historySum(c.requests.map(r => r.usage.total_tokens)) };
  const sdk: unknown = parseHistoryJson(c.execution.usage);
  requireValid(Value.Check(HistorySdkUsageSchema, sdk), "history-sdk-schema");
  requireValid(historySum([sdk.input, sdk.cacheRead]) === api.input && sdk.output === api.output
    && sdk.cacheRead === api.cachedInput && sdk.total === api.total
    && sdk.total === historySum([sdk.input, sdk.cacheRead, sdk.output]), "history-sdk-usage");
  requireValid(sdk.imageSha256[0] === c.modelImageSha256
    && c.requests.every(r => r.imageSha256 === c.modelImageSha256), "history-image-lineage");
  requireValid(c.execution.traceId === sdk.provider + ":" + c.requests[1].requestId, "history-trace");
  return { api, sdk };
}
export function historyUsage(e: HistoryEvidence) {
  const cases = e.cases.map(historyCaseUsage);
  const api = { input: historySum(cases.map(c => c.api.input)), output: historySum(cases.map(c => c.api.output)),
    cachedInput: historySum(cases.map(c => c.api.cachedInput)), total: historySum(cases.map(c => c.api.total)) };
  requireValid(canonical(api) === canonical(e.aggregate.usage), "history-aggregate-usage");
  return { api, sdk: { input: historySum(cases.map(c => c.sdk.input)), output: api.output,
    cacheRead: api.cachedInput, cacheWrite: 0, total: api.total },
    cases: e.cases.length, requests: historySum(e.cases.map(c => c.requests.length)),
    distinctModelImageHashes: new Set(e.cases.map(c => c.modelImageSha256)).size,
    repeatedModelImageHashes: e.cases.length - new Set(e.cases.map(c => c.modelImageSha256)).size };
}
