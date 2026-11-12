import { SUBSCRIPTION_ENDPOINT } from "../src/subscription-configuration.ts";

export function configuration(authPath = "/synthetic/auth.json") {
  return { approvalId: "synthetic-grant", validFrom: Date.now() - 1000, validUntil: Date.now() + 600000,
    grants: [{ actorId: "operator", caseId: "case", inputRevision: "a".repeat(64), artifactSha256: null }],
    target: { provider: "chatgpt-subscription", endpoint: SUBSCRIPTION_ENDPOINT, modelId: "gpt-6-sol", accountIdSha256: "b".repeat(64), authPath },
    purpose: "synthetic component verification", photos: { enabled: false, mappings: [] },
    requestAllowance: 1, concurrentRuns: 1, permitLifetimeMs: 5000, runnerTimeoutMs: 5000, requestTimeoutMs: 7000,
    maxTurns: 1, maxOutputTokens: 128, journalCapacity: 100, shutdownGraceMs: 9000,
    acknowledgeUncappedSubscription: true, acknowledgeRequestQuotaIsNotMoney: true };
}
