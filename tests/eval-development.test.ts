import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { zstdDecompressSync } from "node:zlib";
import { ModelRuntime } from "@code-yeongyu/senpi";
import type { FetchFunction } from "@earendil-works/pi-ai";
import { runDevelopment } from "../scripts/eval-development.ts";
import { inventory, loadDevelopmentManifest } from "../scripts/eval-manifest.ts";
import type { CaseInput } from "../src/contracts.ts";
import { lookupLegalEvidence } from "../src/evidence.ts";

const script = fileURLToPath(new URL("../scripts/eval-development.ts", import.meta.url));
const input: CaseInput = { caseId: "eval-synthetic-1", description: "Synthetic PP case; no field data.",
  photoRefs: ["private://must-never-be-sent"], process: "사출", polymer: "PP", contamination: "없음",
  hazardousContact: "no", massKg: 100, region: "울산", assessmentDate: "2026-11-05" };
const entry = { caseId: input.caseId, groupId: "synthetic-group", stratum: "clean-single-resin",
  split: "development", inputRef: "input.json", rights: { status: "eligible", scope: "existing-synthetic-text-only",
    photoTransmission: "excluded", licenseGranted: false }, exposure: "exposed",
  sourceHash: createHash("sha256").update(JSON.stringify(input)).digest("hex") };
const manifest = { corpusVersion: "synthetic-test-v1", split: "development", cases: [entry] };
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
async function fixture(value: unknown = manifest) {
  const root = mkdtempSync(join(tmpdir(), "eval-development-test-"));
  const manifestPath = join(root, "development.json"), authPath = join(root, "auth.json");
  writeFileSync(manifestPath, JSON.stringify(value)); writeFileSync(join(root, "input.json"), JSON.stringify(input));
  return { root, manifestPath, authPath, out: join(root, "out"), close: () => rmSync(root, { recursive: true, force: true }) };
}
async function authorize(authPath: string) {
  const runtime = await ModelRuntime.create({ authPath, modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  assert.ok(runtime.authStorage);
  const payload = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "synthetic-account" } })).toString("base64url");
  runtime.authStorage.set("chatgpt-subscription", { type: "oauth", access: `synthetic.${payload}.signature`,
    refresh: "synthetic-refresh", expires: Date.now() + 3_600_000 });
}
function response(output: unknown, requestId: string): Response {
  const item = { type: "message", id: "msg_eval", role: "assistant", status: "completed",
    content: [{ type: "output_text", text: JSON.stringify(output), annotations: [] }] };
  const events = [
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response: { id: "resp_eval", status: "completed", output: [item],
      usage: { input_tokens: 7, output_tokens: 11, total_tokens: 18 } } },
  ];
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream", "x-oai-request-id": requestId } });
}
async function rows(directory: string, arm: string): Promise<Record<string, unknown>[]> {
  return readFileSync(join(directory, `${arm}.jsonl`), "utf8").trim().split("\n").map((line) => {
    const value: unknown = JSON.parse(line); assert.ok(record(value)); return value;
  });
}

test("inventory CLI reports counts, groups and strata without model configuration", async () => {
  const second = JSON.stringify({ ...input, caseId: "eval-synthetic-2" });
  const f = await fixture({ ...manifest, cases: [entry, { ...entry, caseId: "eval-synthetic-2", inputRef: "second.json",
    sourceHash: createHash("sha256").update(second).digest("hex") }] });
  try {
    writeFileSync(join(f.root, "second.json"), second);
    const result = spawnSync(process.execPath, [script, "--inventory", f.manifestPath],
      { env: { ...process.env, RESOURCE_MODEL_RUNNER: "local", RESOURCE_AUTH_PATH: f.authPath }, encoding: "utf8", timeout: 10000 });
    assert.equal(result.error, undefined); assert.equal(result.status, 0);
    const parsed: unknown = JSON.parse(result.stdout); assert.ok(record(parsed));
    assert.equal(parsed["count"], 2); assert.equal(parsed["groupCount"], 1);
    assert.deepEqual(parsed["groups"], { "synthetic-group": 2 });
    assert.deepEqual(parsed["strata"], { "clean-single-resin": 2 });
    assert.equal(parsed["unseenEligible"], 0); assert.equal(parsed["lockedMissing"], 12);
    assert.equal(result.stderr, "");
  } finally { await f.close(); }
});

for (const [name, value] of [
  ["locked manifest", { ...manifest, split: "locked" }],
  ["locked entry", { ...manifest, cases: [{ ...entry, split: "locked" }] }],
  ["unexposed entry", { ...manifest, cases: [{ ...entry, exposure: "unexposed" }] }],
  ["ineligible text rights", { ...manifest, cases: [{ ...entry, rights: { status: "pending" } }] }],
  ["photo rights escalation", { ...manifest, cases: [{ ...entry, rights: { ...entry.rights, photoTransmission: "allowed" } }] }],
  ["unverified text scope", { ...manifest, cases: [{ ...entry, rights: { ...entry.rights, scope: "unknown" } }] }],
  ["changed source hash", { ...manifest, cases: [{ ...entry, sourceHash: "0".repeat(64) }] }],
  ["missing group", { ...manifest, cases: [{ ...entry, groupId: "" }] }],
  ["duplicate case", { ...manifest, cases: [entry, entry] }],
  ["remote reference", { ...manifest, cases: [{ ...entry, inputRef: "https://example.invalid/input.json" }] }],
  ["empty cases", { ...manifest, cases: [] }],
] as const) {
  test(`manifest refuses ${name} before execution`, async () => {
    const f = await fixture(value);
    try { await assert.rejects(loadDevelopmentManifest(f.manifestPath), { name: "EvaluationError" }); }
    finally { await f.close(); }
  });
}

test("manifest rejects malformed or mismatched referenced inputs", async () => {
  const malformed = JSON.stringify({ ...input, massKg: "100", caseId: "wrong" });
  const f = await fixture({ ...manifest, cases: [{ ...entry,
    sourceHash: createHash("sha256").update(malformed).digest("hex") }] });
  try {
    writeFileSync(join(f.root, "input.json"), malformed);
    await assert.rejects(loadDevelopmentManifest(f.manifestPath), /Invalid CaseInput or caseId mismatch/);
  } finally { await f.close(); }
});

test("manifest rejects references escaping the corpus directory", async () => {
  const outside = await fixture();
  const f = await fixture({ ...manifest, cases: [{ ...entry, inputRef: `../${basename(outside.root)}/input.json` }] });
  try { await assert.rejects(loadDevelopmentManifest(f.manifestPath), /escapes the corpus root/); }
  finally { await f.close(); await outside.close(); }
});

test("A and B are tool-free, C applies the host gate, and all arms preserve trace and usage", async () => {
  const f = await fixture();
  const requests: Record<string, unknown>[] = [];
  try {
    await authorize(f.authPath);
    const transport: FetchFunction = async (url, init) => {
      const request = new Request(url, init);
      const bytes = Buffer.from(await request.arrayBuffer());
      const body: unknown = JSON.parse((request.headers.get("content-encoding") === "zstd" ? zstdDecompressSync(bytes) : bytes).toString("utf8"));
      assert.ok(record(body)); requests.push(body);
      return response({ state: "compared", caseId: input.caseId, humanApproval: "approved", evidence: [] }, `req_eval_${requests.length}`);
    };
    const result = await runDevelopment({ ...f, maxCases: 1, transport });
    assert.equal(result.calls, 3);
    assert.equal(result.failures, 0, JSON.stringify({ requests, logs: await Promise.all(["A", "B", "C"].map((arm) => rows(result.directory, arm))) }));
    assert.equal(requests.length, 3);
    assert.deepEqual(requests.map((request) => request["model"]), ["gpt-6-sol", "gpt-6-sol", "gpt-6-sol"]);
    assert.deepEqual(requests.slice(0, 2).map((request) => request["tools"] ?? []), [[], []]);
    assert.ok(Array.isArray(requests[2]?.["tools"]) && requests[2]["tools"].length > 0);
    assert.doesNotMatch(JSON.stringify(requests), /private:\/\/must-never-be-sent|input_image/);
    const a = (await rows(result.directory, "A"))[0], b = (await rows(result.directory, "B"))[0], c = (await rows(result.directory, "C"))[0];
    assert.ok(a && b && c);
    assert.equal(a["effectiveInputSha256"], b["effectiveInputSha256"]);
    assert.equal(b["effectiveInputSha256"], c["effectiveInputSha256"]);
    assert.deepEqual(a["providerRequestIds"], ["req_eval_1"]);
    assert.deepEqual(b["providerRequestIds"], ["req_eval_2"]);
    assert.deepEqual(c["providerRequestIds"], ["req_eval_3"]);
    assert.ok(record(a["tokenUsage"])); assert.equal(a["tokenUsage"]["total"], 18);
    assert.ok(record(c["output"])); assert.equal(c["output"]["state"], "needs-review");
    assert.equal(c["citationAudit"], "unverified");
    assert.deepEqual(b["sourceSnapshotIds"], lookupLegalEvidence({ ...input, photoRefs: [] }).evidence.map((source) => source.sourceId));
    assert.deepEqual(c["sourceSnapshotIds"], b["sourceSnapshotIds"]);
    assert.deepEqual(b["sourceSnapshots"], lookupLegalEvidence({ ...input, photoRefs: [] }).evidence
      .map(({ sourceId, sha256, datasetVersion, locator }) => ({ sourceId, sha256, datasetVersion, locator })));
    assert.match(String(c["gitSha"]), /^[a-f0-9]{40,64}$/);
    assert.equal(statSync(join(result.directory, "A.jsonl")).mode & 0o222, 0);
  } finally { await f.close(); }
});

test("provider failures are retained once per arm without retries or private error text", async () => {
  const f = await fixture();
  let calls = 0;
  try {
    await authorize(f.authPath);
    const result = await runDevelopment({ ...f, transport: async () => {
      calls++;
      return Response.json({ error: { message: "private-provider-secret" } },
        { status: 429, headers: { "x-oai-request-id": `req_failure_${calls}` } });
    } });
    assert.equal(calls, 3); assert.equal(result.failures, 3);
    for (const arm of ["A", "B", "C"]) {
      const log = await rows(result.directory, arm);
      assert.equal(log.length, 1); assert.equal(log[0]?.["errorCategory"], "rate-limit");
      assert.equal(log[0]?.["outcome"], "error");
      assert.doesNotMatch(JSON.stringify(log), /private-provider-secret/);
    }
  } finally { await f.close(); }
});

test("global call budget retains unexecuted arms instead of dispatching extra requests", async () => {
  const f = await fixture();
  let calls = 0;
  try {
    await authorize(f.authPath);
    const result = await runDevelopment({ ...f, maxCalls: 1, transport: async () => {
      calls++; return response({ decision: "needs-review" }, "req_budget");
    } });
    assert.equal(calls, 1); assert.equal(result.failures, 2);
    assert.equal((await rows(result.directory, "B"))[0]?.["errorCategory"], "budget-exhausted");
    assert.equal((await rows(result.directory, "C"))[0]?.["calls"], 0);
  } finally { await f.close(); }
});

test("an opted-in repeated-failure limit stops dispatch after preserving both failed arms", async () => {
  const f = await fixture();
  let calls = 0;
  try {
    await authorize(f.authPath);
    const result = await runDevelopment({ ...f, maxConsecutiveFailures: 2, transport: async () => {
      calls++;
      return Response.json({ error: { message: "rate limited" } },
        { status: 429, headers: { "x-oai-request-id": `req_stop_${calls}` } });
    } });
    assert.equal(calls, 2);
    assert.equal(result.failures, 2);
    assert.equal(result.stoppedAfterRepeatedFailure, "rate-limit");
    assert.equal((await rows(result.directory, "A"))[0]?.["errorCategory"], "rate-limit");
    assert.equal((await rows(result.directory, "B"))[0]?.["errorCategory"], "rate-limit");
    assert.equal(readFileSync(join(result.directory, "C.jsonl"), "utf8"), "");
    assert.equal(statSync(join(result.directory, "B.jsonl")).mode & 0o222, 0);
  } finally { await f.close(); }
});

test("timed out provider calls are retained for all arms without retries", async () => {
  const f = await fixture();
  let calls = 0;
  try {
    await authorize(f.authPath);
    // Leave room for SDK initialization on Bun 1.4.4, then require three actual interrupted calls.
    const result = await runDevelopment({ ...f, timeoutMs: 5000, transport: async (_url, init) => {
      calls++;
      const signal = init?.signal;
      assert.ok(signal);
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(new DOMException("Synthetic timeout", "AbortError"));
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
    } });
    assert.equal(calls, 3); assert.equal(result.failures, 3);
    for (const arm of ["A", "B", "C"]) {
      const log = await rows(result.directory, arm);
      assert.equal(log.length, 1); assert.equal(log[0]?.["errorCategory"], "timeout");
      assert.equal(log[0]?.["calls"], 1);
    }
  } finally { await f.close(); }
});

test("invalid case budget is rejected before any provider dispatch", async () => {
  const f = await fixture();
  try {
    await assert.rejects(runDevelopment({ ...f, maxCases: 19, transport: async () => assert.fail("must not dispatch") }), /max-cases/);
  } finally { await f.close(); }
});

test("execution CLI requires explicit subscription opt-in", async () => {
  const f = await fixture();
  try {
    const result = spawnSync(process.execPath, [script, "--cases", f.manifestPath, "--out", f.out],
      { env: { ...process.env, RESOURCE_MODEL_RUNNER: "local", RESOURCE_AUTH_PATH: f.authPath }, encoding: "utf8", timeout: 10000 });
    assert.equal(result.error, undefined); assert.equal(result.status, 1);
    assert.match(result.stderr, /RESOURCE_MODEL_RUNNER=subscription/);
  } finally { await f.close(); }
});

test("manifest inventory preserves no photo references in executable inputs", async () => {
  const f = await fixture();
  try {
    const loaded = await loadDevelopmentManifest(f.manifestPath);
    assert.deepEqual(loaded.cases[0]?.input.photoRefs, []);
    assert.equal(inventory(loaded).photosSent, false);
  } finally { await f.close(); }
});
