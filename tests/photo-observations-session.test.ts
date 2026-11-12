import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { zstdDecompressSync } from "node:zlib";
import type { CredentialStore } from "@earendil-works/pi-ai";
import { PhotonImage } from "@silvia-odwyer/photon-node";
import { createSubscriptionRunner, createAssessmentAdapter, openCaseSession, SessionFailure } from "../src/session.ts";
import { decideCase, assessCase } from "../src/assessment.ts";
import type { CaseInput } from "../src/contracts.ts";
import { SUBSCRIPTION_ENDPOINT } from "../src/subscription-configuration.ts";
import { createOperatorRuntime } from "../src/o-operational-runtime.ts";
import { parseOperationalConfiguration } from "../src/o-operations-config.ts";
import { revision } from "../src/o-validation.ts";
import { fixture, origin, login, post, signal } from "./o-operational-fixtures.ts";

// Every identity, consent, response and observation below is synthetic. No real auth or external fetch.
const input: CaseInput = { caseId: "synthetic-sdk-observations", description: "SYNTHETIC candidate-only connection", photoRefs: ["synthetic-photo"],
  process: "사출", polymer: null, contamination: "없음", hazardousContact: "no", massKg: 2000, region: "울산", assessmentDate: "2026-11-05" };
function png() {
  const image = new PhotonImage(new Uint8Array([255, 0, 0, 255]), 1, 1);
  try { return new Uint8Array(image.get_bytes()); } finally { image.free(); }
}
function photoEnvelope(facts: CaseInput, candidates = ["PET"]) {
  return { decision: decideCase(facts), photoObservations: { images: facts.photoRefs.map((_ref, imageIndex) =>
    ({ imageIndex, usable: true, resinCandidates: candidates, visibleFeatures: ["SYNTHETIC visible mark"] })) } };
}
function sse(value: unknown) {
  const item = { type: "message", id: "msg_synthetic_photo", role: "assistant", status: "completed",
    content: [{ type: "output_text", text: JSON.stringify(value), annotations: [] }] };
  const events = [{ type: "response.output_item.done", output_index: 0, item }, { type: "response.completed", response: {
    id: "resp_synthetic_photo", status: "completed", output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }];
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream", "x-request-id": "synthetic-photo-request" } });
}
async function capturedImages(url: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) {
  const request = new Request(url, init), raw = Buffer.from(await request.arrayBuffer());
  const decoded = request.headers.get("content-encoding") === "zstd" ? zstdDecompressSync(raw, { maxOutputLength: 20 * 1024 * 1024 }) : raw;
  const result: string[] = [];
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object") for (const [key, child] of Object.entries(v)) {
      if (key === "image_url" && typeof child === "string") result.push(child); else visit(child);
    }
  };
  visit(JSON.parse(decoded.toString("utf8")));
  return result.map(value => createHash("sha256").update(Buffer.from(value.slice(value.indexOf(",") + 1), "base64")).digest("hex"));
}
async function sdkFixture(output: (facts: CaseInput) => unknown) {
  const root = await mkdtemp(join(tmpdir(), "resource-observation-test-")), data = png(), sha256 = createHash("sha256").update(data).digest("hex");
  const token = "synthetic." + Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "synthetic-photo-account" } })).toString("base64url") + ".signature";
  const denied = async (): Promise<never> => { throw new Error("synthetic credential mutations forbidden"); };
  const credentials: CredentialStore = {
    async read(provider) { return provider === "chatgpt-subscription" ? { type: "oauth", access: token, refresh: "synthetic-unused", expires: Date.now() + 3600000 } : undefined; },
    async readSlot() { return undefined; }, async list() { return [{ providerId: "chatgpt-subscription", type: "oauth" }]; },
    withRefreshLock: denied, modify: denied, delete: denied,
  };
  let current = input, calls = 0; const imageHashes: string[][] = [];
  const runner = createSubscriptionRunner({ enabled: true, authPath: join(root, "no-real-auth.json"), modelId: "gpt-6-sol",
    photos: async request => ({ ...request, data: new Uint8Array(data), mimeType: "image/png", sha256, approvedForModel: true }),
    transport: async (url, init) => { assert.equal(String(url), SUBSCRIPTION_ENDPOINT); calls++; imageHashes.push(await capturedImages(url, init)); return sse(output(current)); },
  }, (facts, options) => { current = structuredClone(facts); return openCaseSession(facts, { ...options, credentials }); });
  return { runner, sha256, calls: () => calls, imageHashes, async close() {
    assert.equal(dirname(resolve(root)), resolve(tmpdir())); assert.ok(basename(root).startsWith("resource-observation-test-"));
    await rm(root, { recursive: true, force: true });
  } };
}

test("existing subscription SDK attaches exact image once and returns host-bound candidate-only observations", async () => {
  const f = await sdkFixture(photoEnvelope), before = structuredClone(input);
  try {
    const result = await f.runner(input, signal());
    assert.equal(f.calls(), 1); assert.deepEqual(f.imageHashes, [[f.sha256]]);
    assert.equal(result.photoObservations?.images[0]?.sha256, f.sha256);
    assert.equal(result.photoObservations?.caseRevision, revision(input));
    assert.deepEqual(input, before);
    const a = assessCase(input, {}, undefined, result.photoObservations);
    assert.equal(a.candidates.photoInference, "unverified-model-observations");
    assert.deepEqual(a.candidates.resins, []); assert.equal(a.candidates.photoResins?.[0]?.value, "PET");
    assert.deepEqual(JSON.parse(result.execution!.usage!).imageSha256, [f.sha256]);
  } finally { await f.close(); }
});

test("model observations reach the existing adapter state without changing original known fields", async () => {
  const f = await sdkFixture(facts => photoEnvelope(facts, ["PET"]));
  const adapter = createAssessmentAdapter({ runner: f.runner });
  const { caseId: _id, ...fields } = { ...input, polymer: "PP" };
  try {
    const result = await adapter.submit(fields, signal());
    assert.ok("decision" in result);
    assert.notEqual(result.decision.state, "compared");
    assert.ok(JSON.stringify(result.decision).includes("PET") && JSON.stringify(result.decision).includes("PP"));
    assert.equal(fields.polymer, "PP"); assert.equal(fields.hazardousContact, "no"); assert.equal(f.calls(), 1);
  } finally { adapter.dispose(); await adapter.settled(); await f.close(); }
});

test("legacy DecisionResult-only photo responses remain supported without claiming inference", async () => {
  const f = await sdkFixture(decideCase);
  try { const result = await f.runner(input, signal()); assert.equal(result.photoObservations, undefined); assert.equal(f.calls(), 1); }
  finally { await f.close(); }
});

for (const kind of ["no-image", "protected-field", "bad-index"] as const) test(`subscription runner rejects ${kind} photo claims without retry or another dispatch`, async () => {
  const f = await sdkFixture(facts => {
    const result = photoEnvelope({ ...facts, photoRefs: ["synthetic-photo"] });
    if (kind === "protected-field") return { ...result, photoObservations: { images: [{ ...result.photoObservations.images[0], hazardousContact: "no" }] } };
    if (kind === "bad-index") result.photoObservations.images[0]!.imageIndex = 1;
    return result;
  });
  try {
    await assert.rejects(f.runner(kind === "no-image" ? { ...input, photoRefs: [] } : input, signal()), e => e instanceof SessionFailure && e.code === "invalid-model-output");
    assert.equal(f.calls(), 1);
  } finally { await f.close(); }
});

test("operational app uses private photo/SHA, existing grants and journal; malformed observations preserve the prior case/report", async t => {
  const closes: (() => Promise<void>)[] = [];
  t.after(async () => { for (const close of closes.reverse()) await close(); });
  const f = await fixture(t), { authPath: _auth, ...target } = f.config.target;
  let bad = false, calls = 0, selected = f.snapshot.input;
  const hashes: string[][] = [];
  const config = parseOperationalConfiguration({ ...f.config, photos: { enabled: true, mappings: [{ target, scope: { provider: target.provider, purpose: f.config.purpose } }] } });
  const operator = await createOperatorRuntime({ origin, stateRoot: f.stateRoot, resourcesRoot: f.resourcesRoot, configuration: config, privatePhotos: true,
    transport: async (url, init) => {
      calls++; hashes.push(await capturedImages(url, init));
      const envelope = photoEnvelope(selected);
      return sse(bad ? { ...envelope, photoObservations: { images: [{ ...envelope.photoObservations.images[0], wasteCode: "51-03-01" }] } } : envelope);
    } });
  closes.push(() => operator.close());
  const ticket = operator.authority.current(); assert.ok(ticket && operator.photoStore);
  const photo = await operator.photoStore.put(f.actor.actorId, selected.caseId, png(), "image/png", {
    recordId: "synthetic-observation-consent", store: true, model: true, visibleContentReviewed: true,
    modelBindingId: ticket.bindingId, modelScope: ticket.scope, expiresAt: Date.now() + 60000 }, signal());
  const owner = `actor:${f.actor.actorId}`, lease = operator.caseStore.begin(owner, selected.caseId, f.snapshot.version);
  try { operator.caseStore.associate(lease, photo, () => {}); } finally { operator.caseStore.rollback(lease); }
  const beforeSelection = operator.caseStore.read(owner, selected.caseId); assert.ok(beforeSelection);
  selected = { ...beforeSelection.input, photoRefs: [photo.photoRef] };
  await operator.reloadConfiguration(parseOperationalConfiguration({ ...config, approvalId: "synthetic-observation-grant-1",
    grants: [{ actorId: f.actor.actorId, caseId: selected.caseId, inputRevision: revision(selected), artifactSha256: null }] }));
  const cookie = await login(operator.app);
  const success = await operator.app.fetch(post(f.path + "/answers", cookie, { baseVersion: beforeSelection.version, patch: { photoRefs: selected.photoRefs } }));
  assert.equal(success.status, 303); assert.equal(calls, 1); assert.deepEqual(hashes, [[photo.sha256]]);
  const prior = operator.caseStore.read(owner, selected.caseId); assert.ok(prior);
  assert.equal(prior.input.polymer, "PP"); assert.equal(prior.input.hazardousContact, "no");
  const priorReport = await (await operator.app.fetch(new Request(origin + f.path, { headers: { cookie } }))).text();
  assert.ok(priorReport.includes("PET"));
  bad = true; selected = { ...prior.input, massKg: 999 };
  await operator.reloadConfiguration(parseOperationalConfiguration({ ...config, approvalId: "synthetic-observation-grant-2",
    grants: [{ actorId: f.actor.actorId, caseId: selected.caseId, inputRevision: revision(selected), artifactSha256: null }] }));
  const failed = await operator.app.fetch(post(f.path + "/answers", cookie, { baseVersion: prior.version, patch: { massKg: 999 } }));
  assert.equal(failed.status, 502); assert.equal(calls, 2);
  const after = operator.caseStore.read(owner, selected.caseId); assert.ok(after);
  assert.equal(after.version, prior.version); assert.deepEqual(after.input, prior.input);
  assert.equal(await (await operator.app.fetch(new Request(origin + f.path, { headers: { cookie } }))).text(), priorReport);
});
