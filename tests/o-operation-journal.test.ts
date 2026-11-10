import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openOperationJournal } from "../src/o-operation-journal.ts";
import { parseOperationalConfiguration } from "../src/o-operations-config.ts";
import { SUBSCRIPTION_ENDPOINT } from "../src/subscription-configuration.ts";
import { configuration } from "./o-operations-fixtures.ts";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";
import { inspectOperationJournal } from "../scripts/o-journal.ts";
const binding = { leaseToken: "lease", actorId: "operator", caseId: "case", inputRevision: "a".repeat(64), artifact: null };
const request = { runId: "run", caseRevision: binding.inputRevision, endpoint: SUBSCRIPTION_ENDPOINT, deployment: "", modelId: "gpt-6-sol",
  attempt: 1, maxOutputTokens: 128, provider: "chatgpt-subscription" as const, outputLimitEnforced: false };
const audit = (phase: "start" | "dispatch" | "finish") => ({ phase, runId: "run", caseRevision: binding.inputRevision,
  at: new Date(0).toISOString(), elapsedMs: 0, requests: [], images: [], usage: null });
async function fixture(t: { after(fn: () => unknown): void }) {
  const root = await mkdtemp(join(tmpdir(), "o-journal-")), config = parseOperationalConfiguration(configuration());
  const journal = await openOperationJournal({ stateRoot: root, configuration: config, currentOperation: () => binding });
  t.after(async () => { await journal.close(); await rm(root, { recursive: true, force: true }); });
  return { journal, root, config };
}

test("configuration rejects omitted acknowledgements, wrong target and inconsistent deadlines", () => {
  for (const patch of [{ acknowledgeUncappedSubscription: false }, { approvalId: "" }, { requestTimeoutMs: 65000 },
    { runnerTimeoutMs: 8000 }, { target: { ...configuration().target, endpoint: "https://example.com" } }]) {
    assert.throws(() => parseOperationalConfiguration({ ...configuration(), ...patch }));
  }
});

test("reservation replay is idempotent and conflicting replay cannot spend another allowance", async t => {
  const { journal } = await fixture(t);
  await journal.record(audit("start"));
  const permit = await journal.authorizeDispatch(request, new AbortController().signal);
  assert.deepEqual(await journal.authorizeDispatch(request, new AbortController().signal), permit);
  await assert.rejects(journal.authorizeDispatch({ ...request, maxOutputTokens: 256 }, new AbortController().signal));
  await assert.rejects(journal.authorizeDispatch({ ...request, attempt: 2 }, new AbortController().signal));
  assert.equal(journal.inspectPending()[0]?.state, "reserved");
});

test("proven uninvoked reservation releases once and conflicting terminal replay fails", async t => {
  const { journal } = await fixture(t);
  await journal.record(audit("start")); await journal.authorizeDispatch(request, new AbortController().signal);
  await journal.record(audit("finish")); await journal.record(audit("finish"));
  assert.deepEqual(journal.inspectPending(), []);
  await assert.rejects(journal.record({ ...audit("finish"), elapsedMs: 1 }));
});

test("transport failure retains uncertainty across restart and never refunds or retries", async t => {
  const { journal, root, config } = await fixture(t); let calls = 0;
  await journal.record(audit("start")); await journal.authorizeDispatch(request, new AbortController().signal);
  await journal.record({ ...audit("dispatch"), requests: [{ attempt: 1, approvalId: config.approvalId, transportStarted: false, status: null, requestId: null }] });
  const transport = journal.wrapTransport(async () => { calls++; throw new Error("synthetic disconnect"); });
  await assert.rejects(transport(SUBSCRIPTION_ENDPOINT, { method: "POST", body: "{}", signal: new AbortController().signal }));
  await journal.record(audit("finish")); await journal.close();
  const recovered = await openOperationJournal({ stateRoot: root, configuration: config, currentOperation: () => binding });
  try { assert.equal(calls, 1); assert.equal(recovered.inspectPending()[0]?.state, "unresolved"); }
  finally { await recovered.close(); }
});

test("another process lifetime owner cannot recover active reservations", async t => {
  const { journal, root, config } = await fixture(t);
  await journal.record(audit("start")); await journal.authorizeDispatch(request, new AbortController().signal);
  await assert.rejects(openOperationJournal({ stateRoot: root, configuration: config, currentOperation: () => binding }));
  assert.equal(journal.inspectPending()[0]?.state, "reserved");
});

for (const stage of ["reserved", "dispatch", "transport"] as const) test(`SIGKILL after ${stage} releases the kernel lock and recovers only proven uninvoked work`, { timeout: 15000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), "o-crash-")), config = parseOperationalConfiguration(configuration());
  t.after(() => rm(root, { recursive: true, force: true }));
  const child = spawn(process.execPath, [fileURLToPath(new URL("./o-journal-child.ts", import.meta.url)), root, stage, JSON.stringify(config)], { stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(child, "exit"), lines = createInterface({ input: child.stdout }); let diagnostic = "";
  child.stderr.on("data", bytes => { diagnostic += String(bytes); });
  try {
    await Promise.race([new Promise<void>(done => lines.on("line", line => { if (line === "ready") done(); })), exited.then(() => { throw new Error(diagnostic); })]);
    await assert.rejects(openOperationJournal({ stateRoot: root, configuration: config, currentOperation: () => binding }));
    child.kill("SIGKILL"); await exited;
    const recovered = await openOperationJournal({ stateRoot: root, configuration: config, currentOperation: () => binding });
    try { assert.equal(recovered.inspectPending().length, stage === "transport" ? 1 : 0); }
    finally { await recovered.close(); }
    assert.equal(inspectOperationJournal(root)[0]?.state, stage === "transport" ? "unresolved" : "released");
  } finally { lines.close(); if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await exited; }
});

test("a competing SQLite writer cannot oversubscribe or partially publish a reservation", async t => {
  const { journal, root } = await fixture(t); await journal.record(audit("start"));
  const connection = new Database(join(root, "operations", "journal.sqlite"));
  try {
    connection.exec("BEGIN IMMEDIATE");
    await assert.rejects(journal.authorizeDispatch(request, new AbortController().signal));
    assert.deepEqual(journal.inspectPending(), []);
    connection.exec("ROLLBACK");
    await journal.authorizeDispatch(request, new AbortController().signal);
    await assert.rejects(journal.authorizeDispatch({ ...request, attempt: 2 }, new AbortController().signal));
    assert.equal(journal.inspectPending().length, 1);
  } finally { connection.close(); }
});

for (const reason of ["revoked", "aborted"] as const) test(`${reason} operation cannot invoke a transport after reservation`, async () => {
  const root = await mkdtemp(join(tmpdir(), "o-live-")); let live = true, calls = 0;
  const config = parseOperationalConfiguration(configuration());
  const journal = await openOperationJournal({ stateRoot: root, configuration: config, currentOperation: () => { assert.ok(live); return binding; } });
  try {
    await journal.record(audit("start")); await journal.authorizeDispatch(request, new AbortController().signal);
    await journal.record({ ...audit("dispatch"), requests: [{ attempt: 1, approvalId: config.approvalId, transportStarted: false, status: null, requestId: null }] });
    const controller = new AbortController();
    if (reason === "revoked") live = false; else controller.abort();
    await assert.rejects(journal.wrapTransport(async () => { calls++; return new Response(); })(SUBSCRIPTION_ENDPOINT, { body: "{}", signal: controller.signal }));
    await journal.record(audit("finish")); assert.equal(calls, 0); assert.deepEqual(journal.inspectPending(), []);
  } finally { await journal.close(); await rm(root, { recursive: true, force: true }); }
});

test("HTTP failure blocks automatic retry even when request quota remains", async t => {
  const root = await mkdtemp(join(tmpdir(), "o-http-failure-")), c = parseOperationalConfiguration({ ...configuration(), requestAllowance: 2, maxTurns: 2 });
  const journal = await openOperationJournal({ stateRoot: root, configuration: c, currentOperation: () => binding }); let calls = 0;
  try {
    await journal.record(audit("start")); await journal.authorizeDispatch(request, new AbortController().signal);
    await journal.record({ ...audit("dispatch"), requests: [{ attempt: 1, approvalId: c.approvalId, transportStarted: false, status: null, requestId: null }] });
    await journal.wrapTransport(async () => { calls++; return new Response(null, { status: 500 }); })(SUBSCRIPTION_ENDPOINT, { body: "{}" });
    await assert.rejects(journal.authorizeDispatch({ ...request, attempt: 2 }, new AbortController().signal));
    assert.equal(calls, 1); assert.equal(journal.inspectPending()[0]?.state, "unresolved");
  } finally { await journal.close(); await rm(root, { recursive: true, force: true }); }
});

test("revocation at the final synchronous guard releases a proven uninvoked transport intent", async () => {
  const root = await mkdtemp(join(tmpdir(), "o-final-guard-")), c = parseOperationalConfiguration(configuration());
  let checking = false, guards = 0, calls = 0;
  const journal = await openOperationJournal({ stateRoot: root, configuration: c, currentOperation: () => {
    if (checking && ++guards === 4) throw new Error("synthetic revocation after transport intent"); return binding;
  } });
  try {
    await journal.record(audit("start")); await journal.authorizeDispatch(request, new AbortController().signal);
    await journal.record({ ...audit("dispatch"), requests: [{ attempt: 1, approvalId: c.approvalId, transportStarted: false, status: null, requestId: null }] });
    checking = true;
    await assert.rejects(journal.wrapTransport(async () => { calls++; return new Response(); })(SUBSCRIPTION_ENDPOINT, { body: "{}" }));
    assert.equal(calls, 0); assert.deepEqual(journal.inspectPending(), []);
  } finally { await journal.close(); await rm(root, { recursive: true, force: true }); }
});

test("consumed allowance blocks another valid attempt and survives idempotent terminal replay", async () => {
  const root = await mkdtemp(join(tmpdir(), "o-consumed-")), c = parseOperationalConfiguration({ ...configuration(), maxTurns: 2 });
  const journal = await openOperationJournal({ stateRoot: root, configuration: c, currentOperation: () => binding });
  try {
    await journal.record(audit("start")); await journal.authorizeDispatch(request, new AbortController().signal);
    await journal.record({ ...audit("dispatch"), requests: [{ attempt: 1, approvalId: c.approvalId, transportStarted: false, status: null, requestId: null }] });
    await journal.wrapTransport(async () => new Response(null, { headers: { "x-request-id": "observed" } }))(SUBSCRIPTION_ENDPOINT, { body: "{}" });
    await assert.rejects(journal.authorizeDispatch({ ...request, attempt: 2 }, new AbortController().signal));
    await journal.record(audit("finish")); await journal.record(audit("finish"));
    await journal.record({ ...audit("start"), runId: "run-2" });
    await assert.rejects(journal.authorizeDispatch({ ...request, runId: "run-2" }, new AbortController().signal));
  } finally { await journal.close(); }
  try { assert.deepEqual(inspectOperationJournal(root).map(r => r.state), ["consumed", "no-attempt"]); }
  finally { await rm(root, { recursive: true, force: true }); }
});

test("journal capacity rejects another write without silently discarding audit or resetting allowance", async () => {
  const root = await mkdtemp(join(tmpdir(), "o-capacity-")), c = parseOperationalConfiguration({ ...configuration(), journalCapacity: 10 });
  const journal = await openOperationJournal({ stateRoot: root, configuration: c, currentOperation: () => binding });
  try {
    for (const id of ["one", "two", "three"]) { await journal.record({ ...audit("start"), runId: id }); await journal.record({ ...audit("finish"), runId: id }); }
    await assert.rejects(journal.record({ ...audit("start"), runId: "four" }));
  } finally { await journal.close(); }
  try { assert.equal(inspectOperationJournal(root, 2).length, 2); assert.equal(inspectOperationJournal(root, 100).length, 3); }
  finally { await rm(root, { recursive: true, force: true }); }
});

for (const corruption of ["schema", "binding", "permissions"] as const) test(`journal ${corruption} corruption stops startup before recovering reservations`, async t => {
  const { journal, root, config } = await fixture(t);
  await journal.record(audit("start")); await journal.authorizeDispatch(request, new AbortController().signal); await journal.close();
  const path = join(root, "operations", "journal.sqlite"), connection = new Database(path);
  if (corruption === "schema") connection.exec("CREATE TABLE unexpected(value TEXT)");
  if (corruption === "binding") connection.exec("UPDATE runs SET binding='{}'");
  connection.close();
  if (corruption === "permissions") await chmod(path, 0o644);
  await assert.rejects(openOperationJournal({ stateRoot: root, configuration: config, currentOperation: () => binding }));
  await chmod(path, 0o600);
  const observer = new Database(path);
  try { assert.equal(observer.query<{ state: string }, []>("SELECT state FROM attempts").get()?.state, "reserved"); }
  finally { observer.close(); }
});

test("journal CLI from another cwd reports only bounded sanitized policy and execution metadata", async t => {
  const { journal, root } = await fixture(t);
  await journal.record(audit("start")); await journal.authorizeDispatch(request, new AbortController().signal); await journal.close();
  const result = await promisify(execFile)(process.execPath, [fileURLToPath(new URL("../scripts/o-journal.ts", import.meta.url)), "--state-dir", root, "--limit", "1"], { cwd: tmpdir() });
  const rows = JSON.parse(result.stdout); assert.equal(rows.length, 1); assert.equal(rows[0].state, "reserved");
  assert.equal(JSON.parse(rows[0].policy).target.accountIdSha256, "b".repeat(64));
  assert.equal(JSON.parse(rows[0].policy).target.authPath, undefined);
  assert.equal(JSON.parse(rows[0].binding).actorId, undefined); assert.equal(JSON.parse(rows[0].binding).leaseToken, undefined);
});
