import { openOperationJournal } from "../src/o-operation-journal.ts";
import { parseOperationalConfiguration } from "../src/o-operations-config.ts";
import { SUBSCRIPTION_ENDPOINT } from "../src/subscription-configuration.ts";

const [root, stage, json] = process.argv.slice(2);
if (!root || !stage || !json) throw new Error("synthetic child arguments");
const c = parseOperationalConfiguration(JSON.parse(json));
const binding = { leaseToken: "lease", actorId: "operator", caseId: "case", inputRevision: "a".repeat(64), artifact: null };
const journal = await openOperationJournal({ stateRoot: root, configuration: c, currentOperation: () => binding });
const event = { runId: "run", caseRevision: binding.inputRevision, at: new Date(0).toISOString(), elapsedMs: 0, requests: [], images: [], usage: null };
await journal.record({ ...event, phase: "start" });
await journal.authorizeDispatch({ runId: "run", caseRevision: binding.inputRevision, endpoint: SUBSCRIPTION_ENDPOINT, deployment: "", modelId: c.target.modelId, attempt: 1, maxOutputTokens: c.maxOutputTokens, provider: c.target.provider, outputLimitEnforced: false }, new AbortController().signal);
if (stage !== "reserved") await journal.record({ ...event, phase: "dispatch", requests: [{ attempt: 1, approvalId: c.approvalId, transportStarted: false, status: null, requestId: null }] });
const hold = () => { console.log("ready"); setInterval(() => {}, 10000); };
if (stage === "transport") await journal.wrapTransport(async () => { hold(); return new Promise<Response>(() => {}); })(SUBSCRIPTION_ENDPOINT, { method: "POST", body: "{}" });
else hold();
