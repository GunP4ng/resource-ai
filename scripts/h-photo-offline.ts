import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createServer } from "node:http";
import { zstdDecompressSync } from "node:zlib";
import type { CredentialStore } from "@earendil-works/pi-ai";
import type { CaseInput } from "../src/contracts.ts";
import { assessCase, decideCase } from "../src/assessment.ts";
import { createPhotoStore } from "../src/photos.ts";
import { createSubscriptionPhotoExecutionAuthority } from "../src/photo-execution.ts";
import { SUBSCRIPTION_ENDPOINT } from "../src/subscription-configuration.ts";
import { createResourceApp, createSubscriptionRunner, openCaseSession } from "../src/session.ts";
import { revision } from "../src/o-validation.ts";
import { candidatePath, loadHCandidates, sha256 } from "./h-candidates.ts";

// Deliberately use the real SDK serializer with an in-memory fake credential and
// injected SSE transport. No real auth store, login or network model request.
assert.equal(process.env["RESOURCE_MODEL_RUNNER"], "local", "Set RESOURCE_MODEL_RUNNER=local for offline verification");
const root = await mkdtemp(join(tmpdir(), "resource-h-photo-offline-"));
const output = resolve(process.argv[2] ?? "artifacts/h-photo-offline.json");
let transportCalls = 0;
try {
  const pack = await loadHCandidates(), authPath = join(root, "synthetic-auth.json");
  const payload = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "synthetic-offline-account" } })).toString("base64url");
  const fake = { type: "oauth" as const, access: `synthetic.${payload}.signature`, refresh: "synthetic-unused", expires: Date.now() + 3_600_000 };
  const denied = (): never => { throw new Error("offline credential mutation/refresh forbidden"); };
  const credentials: CredentialStore = {
    async read(provider) { return provider === "chatgpt-subscription" ? structuredClone(fake) : undefined; },
    async readSlot() { return undefined; },
    async list() { return [{ providerId: "chatgpt-subscription", type: "oauth" }]; },
    async withRefreshLock() { return denied(); }, async modify() { return denied(); }, async delete() { return denied(); },
  };
  const authority = createSubscriptionPhotoExecutionAuthority();
  const target = { provider: "chatgpt-subscription", endpoint: SUBSCRIPTION_ENDPOINT, modelId: "gpt-6-sol", accountIdSha256: sha256("synthetic-offline-account") } as const;
  authority.publish({ ...target, authPath }, [{ target, scope: { provider: "synthetic-offline-only", purpose: "local H photo serialization check; no external model transmission" } }]);
  const ticket = authority.current()!;
  const cases = new Map<string, CaseInput>(), actor = "synthetic-h-offline";
  let clock = Date.now();
  const vault = join(root, "photos"); await mkdir(vault, { mode: 0o700 });
  const store = await createPhotoStore({ root: vault, photoExecution: authority, retentionMs: 60_000, maxPhotos: 20, now: () => clock,
    authorize: async (owner, id) => owner === actor && cases.has(id) ? { ownerId: actor, caseRevision: revision(cases.get(id)!), read: true, sendToModel: true } : null });
  const signal = () => new AbortController().signal;
  const receipts = new Map<string, Awaited<ReturnType<typeof store.put>>>();
  const rows = [];
  const run = async (input: CaseInput, expectedSha: string) => {
    cases.set(input.caseId, input);
    let sentSha: string | undefined;
    let transportFailure: unknown;
    const runner = createSubscriptionRunner({ enabled: true, authPath, modelId: "gpt-6-sol", photos: store.resolver(actor, ticket),
      transport: async (url, init) => {
        try {
        transportCalls++; assert.equal(String(url), SUBSCRIPTION_ENDPOINT);
        const envelope = new Request(url, init), wire = Buffer.from(await envelope.arrayBuffer());
        const encoding = envelope.headers.get("content-encoding");
        assert.ok(encoding === null || encoding === "zstd");
        // The pinned SDK compresses subscription SSE request bodies; inspect the
        // actual serialized image after bounded decompression, not String(body).
        const decoded = encoding === "zstd" ? zstdDecompressSync(wire, { maxOutputLength: 20 * 1024 * 1024 }) : wire;
        const request: unknown = JSON.parse(decoded.toString("utf8")), images: string[] = [];
        const visit = (value: unknown): void => {
          if (Array.isArray(value)) value.forEach(visit);
          else if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) {
            if (key === "image_url" && typeof child === "string") images.push(child);
            else visit(child);
          }
        };
        visit(request); assert.equal(images.length, 1);
        assert.ok(images[0]!.startsWith("data:image/png;base64,"));
        sentSha = sha256(Buffer.from(images[0]!.split(",")[1]!, "base64")); assert.equal(sentSha, expectedSha);
        const item = { type: "message", id: "msg_offline", role: "assistant", status: "completed",
          content: [{ type: "output_text", text: JSON.stringify(decideCase(input)), annotations: [] }] };
        const events = [{ type: "response.output_item.done", output_index: 0, item },
          { type: "response.completed", response: { id: "resp_offline", status: "completed", output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }];
        return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""),
          { headers: { "content-type": "text/event-stream", "x-request-id": "synthetic-offline" } });
        } catch (error) { transportFailure = error; throw error; }
      },
    }, (value, options) => openCaseSession(value, { ...options, credentials }));
    await store.assertCanTransmit(actor, input, signal(), undefined, ticket);
    const result = await runner(input, signal()).catch(error => { throw transportFailure ?? error; });
    assert.equal(sentSha, expectedSha);
    const usage = JSON.parse(result.execution!.usage!); assert.deepEqual(usage.imageSha256, [expectedSha]);
    const assessment = assessCase(input);
    return { input, caseRevision: revision(input), transmittedImageSha256: sentSha, questions: assessment.questions,
      candidates: assessment.candidates, legalIssues: assessment.legal.issues, reviewReasons: assessment.reviewReasons,
      decision: decideCase(input, result.proposal), execution: result.execution,
      providerRequestId: null, realProviderUsage: null, responseOrigin: "synthetic injected SSE, not model inference", usageOrigin: "synthetic fixture counters" };
  };
  for (const entry of pack.entries) {
    const bytes = await readFile(candidatePath(entry.photo.path)); cases.set(entry.candidateId, entry.input);
    const receipt = await store.put(actor, entry.candidateId, bytes, "image/png", { recordId: entry.candidateId,
      store: true, model: true, visibleContentReviewed: true, modelBindingId: ticket.bindingId, modelScope: ticket.scope, expiresAt: clock + 60_000 }, signal());
    receipts.set(entry.candidateId, receipt);
    rows.push({ candidateId: entry.candidateId, sourceAssetSha256: entry.photo.sha256, storedSha256: receipt.sha256,
      ...await run({ ...entry.input, photoRefs: [receipt.photoRef] }, receipt.sha256) });
  }
  const mixed = pack.entries[2]!, mixedReceipt = receipts.get(mixed.candidateId)!;
  const single = await run({ ...mixed.input, photoRefs: [mixedReceipt.photoRef], polymer: "PP" }, mixedReceipt.sha256);
  assert.ok(!single.questions.some(q => q.includes("층별")));
  const contact = pack.entries[3]!, contactReceipt = receipts.get(contact.candidateId)!;
  const resolved = await run({ ...contact.input, photoRefs: [contactReceipt.photoRef], contamination: "이전 내용물과 세척·잔류 확인 완료 (합성 가정)" }, contactReceipt.sha256);
  assert.ok(!resolved.questions.some(q => q.includes("SDS")));
  const hazardous = await run({ ...contact.input, photoRefs: [contactReceipt.photoRef], hazardousContact: "yes" }, contactReceipt.sha256);
  assert.equal(hazardous.decision.state, "needs-review");
  // A separately labelled historical synthetic control exercises J's existing
  // 11/05 cutoff. It does not update source currentness or replace the 11/12 cases.
  const historicalInput: CaseInput = { ...mixed.input, photoRefs: [mixedReceipt.photoRef],
    process: "사출", polymer: "PP", contamination: "없음", hazardousContact: "no", assessmentDate: "2026-11-05" };
  const historical = await run(historicalInput, mixedReceipt.sha256);
  assert.ok(historical.candidates.wasteCodes.length > 0);
  const processChanged = await run({ ...historicalInput, process: "합성수지 화학합성" }, mixedReceipt.sha256);
  const contaminationChanged = await run({ ...historicalInput, contamination: "폐유 혼합" }, mixedReceipt.sha256);
  assert.equal(processChanged.candidates.wasteCodes.length, 0);
  assert.equal(contaminationChanged.candidates.wasteCodes.length, 0);
  const hazardChanged = await run({ ...historicalInput, hazardousContact: "yes" }, mixedReceipt.sha256);
  assert.equal(hazardChanged.decision.state, "needs-review");
  assert.ok(hazardChanged.reviewReasons.some(reason => reason.includes("유해물질 접촉이 보고")));
  const first = receipts.get(pack.entries[0]!.candidateId)!, second = receipts.get(pack.entries[1]!.candidateId)!;
  const request = { caseId: first.caseId, caseRevision: revision(cases.get(first.caseId)!), photoRef: first.photoRef };
  await store.withdrawModel(actor, first.photoRef, signal());
  await assert.rejects(store.resolver(actor, ticket)(request, signal()));
  assert.ok((await store.read(actor, request, signal())).data.length > 0);
  await store.revoke(actor, second.photoRef, signal());
  await assert.rejects(store.read(actor, { caseId: second.caseId, caseRevision: revision(cases.get(second.caseId)!), photoRef: second.photoRef }, signal()));
  clock += 60_001; const purged = await store.purgeExpired(); assert.equal(purged.removed, 9); assert.equal(purged.unreadable, 0);

  // Real loopback HTTP/form round trip through O's unchanged app and the H adapter.
  let app: ReturnType<typeof createResourceApp>;
  let origin = "";
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (Array.isArray(value)) value.forEach(part => headers.append(key, part));
        else if (value !== undefined) headers.set(key, value);
      }
      const result = await app.fetch(new Request(origin + request.url, { method: request.method, headers,
        ...(!["GET", "HEAD"].includes(request.method ?? "GET") ? { body: Buffer.concat(chunks).toString("utf8") } : {}) }));
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch (error) { response.destroy(error instanceof Error ? error : new Error("offline HTTP bridge failure")); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  origin = `http://127.0.0.1:${address.port}`; app = createResourceApp({ origin });
  let http;
  try {
    const home = await fetch(origin), cookie = home.headers.get("set-cookie")!.split(";", 1)[0]!;
    const { caseId: _caseId, ...fields } = mixed.input;
    const form = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, key === "photoRefs" ? "" : value === null ? "" : String(value)]));
    const created = await fetch(origin + "/cases", { method: "POST", redirect: "manual", headers: { origin, cookie, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form) });
    assert.equal(created.status, 303); const path = created.headers.get("location")!;
    const before = await (await fetch(origin + path, { headers: { cookie } })).text(); assert.ok(before.includes("층별·구성 수지"));
    const answered = await fetch(origin + path + "/answers", { method: "POST", redirect: "manual", headers: { origin, cookie, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ answers: JSON.stringify({ polymer: "PP" }) }) });
    assert.equal(answered.status, 303);
    const after = await (await fetch(origin + path, { headers: { cookie } })).text(); assert.ok(!after.includes("층별·구성 수지"));
    const stranger = await fetch(origin), otherCookie = stranger.headers.get("set-cookie")!.split(";", 1)[0]!;
    const inaccessible = await fetch(origin + path, { headers: { cookie: otherCookie } }); assert.equal(inaccessible.status, 404);
    http = { createStatus: created.status, answerStatus: answered.status, otherSessionStatus: inaccessible.status,
      mixedQuestionShown: true, resolvedQuestionRemoved: true, beforeHtmlSha256: sha256(before), afterHtmlSha256: sha256(after) };
  } finally { app.dispose(); await app.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  const report = { corpusVersion: pack.version, manifestSha256: pack.manifestSha256, provider: "chatgpt-subscription", modelId: "gpt-6-sol",
    publicPhotos: 10, syntheticScenarioInputs: 10, syntheticTransportCalls: transportCalls, externalModelCalls: 0,
    realProviderUsage: null, realRequestId: null, photoInference: "not-performed",
    boundary: "Real PNG decode/private store/SDK HTTP serialization and loopback app. Synthetic credentials, authority, consent, inputs, SSE responses and counters; no field/provider acceptance or external image access.",
    lifecycle: { modelWithdrawalDenied: true, previewPreserved: true, storageRevocationDenied: true, expiryPurged: purged.removed },
    http, rows, samePhotoConditionVariants: [single, resolved, hazardous],
    historicalSyntheticBoundaryControl: { scope: "Explicit 2026-11-05 synthetic control, not current field evidence or approval",
      sameImageSha256: mixedReceipt.sha256, variants: [historical, processChanged, contaminationChanged, hazardChanged] } };
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ output, publicPhotos: 10, syntheticTransportCalls: transportCalls, externalModelCalls: 0, http, lifecycle: report.lifecycle }, null, 2));
} finally { await rm(root, { recursive: true, force: true }); }
