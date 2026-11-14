import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { authTimeState, processTimeArguments, processTimeEnvironment, runWithProcessTime } from "./o-process-time.ts";
import { openOperationJournal } from "../src/o-operation-journal.ts";
import { parseOperationalConfiguration } from "../src/o-operations-config.ts";
import { configuration } from "./o-operations-fixtures.ts";
import { inspectOperationJournal } from "../scripts/o-journal.ts";
import { openRuntimeDatabase } from "../src/o-runtime-db.ts";
import { createLocalAuth } from "../src/o-auth.ts";
import { createOperationalApp } from "../src/operations.ts";

for (const rollback of [true, false]) test(`native lifecycle login with ${rollback ? "independent rollback" : "shared process time"}`, { timeout: 20000 }, async t => {
  // Given real Argon2/SQLite state written by a separate, independently imported auth module.
  const root = await mkdtemp(join(tmpdir(), "o-time-proof-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = processTimeEnvironment(1_800_000_000_000), script = fileURLToPath(new URL("./o-process-time-child.ts", import.meta.url));
  const seed = await promisify(execFile)(process.execPath, [...processTimeArguments, script, rollback ? "seed-rollback" : "seed", root], { env });
  const seeded: unknown = JSON.parse(seed.stdout);
  assert.ok(seeded && typeof seeded === "object" && "wall" in seeded && typeof seeded.wall === "number" && "window" in seeded);
  assert.equal(authTimeState(root).window, seeded.window);
  // When a fresh process performs native login, with only its wall clock rolled back.
  const probeEnv = processTimeEnvironment(seeded.wall);
  const probe = await promisify(execFile)(process.execPath, [...processTimeArguments, script, "login", root], { env: probeEnv });
  const result: unknown = JSON.parse(probe.stdout);
  t.diagnostic(`seed=${seed.stdout.trim()} child=${probe.stdout.trim()}`);
  assert.ok(result && typeof result === "object" && "status" in result && "before" in result && "after" in result
    && "wall" in result && typeof result.wall === "number" && "finished" in result && typeof result.finished === "number"
    && "created" in result && "assertions" in result);
  const { before, after } = result;
  assert.ok(before && typeof before === "object" && "window_start" in before && typeof before.window_start === "number" && "attempts" in before && typeof before.attempts === "number");
  assert.ok(after && typeof after === "object" && "attempts" in after);
  // Then future windows fail closed; aligned processes issue and assert their own session.
  assert.equal(result.status, rollback ? 503 : 303);
  if (rollback) {
    assert.ok(before.window_start > result.finished);
    assert.deepEqual(after, before);
    assert.equal(result.assertions, 0);
  } else {
    assert.ok(typeof result.created === "number" && result.created >= result.wall && result.created <= result.finished);
    assert.equal(after.attempts, before.attempts + 1);
    assert.equal(result.assertions, 3);
  }
});

for (const boundary of ["validFrom", "permit deadline"] as const) test(`journal refuses transport at ${boundary} after a clock step`, async t => {
  if (await runWithProcessTime(t, import.meta.url)) return;
  // Given a real durable reservation and dispatch audit, still before invocation.
  const root = await mkdtemp(join(tmpdir(), "o-time-journal-")), c = parseOperationalConfiguration(configuration());
  t.after(() => rm(root, { recursive: true, force: true }));
  const binding = { leaseToken: "clock-proof", actorId: "operator", caseId: "case", inputRevision: "a".repeat(64), artifact: null };
  const journal = await openOperationJournal({ stateRoot: root, configuration: c, currentOperation: () => binding });
  const event = { runId: "clock-proof", caseRevision: binding.inputRevision, at: new Date(0).toISOString(), elapsedMs: 0, requests: [], images: [], usage: null };
  const wall = Date.now;
  let calls = 0;
  try {
    await journal.record({ ...event, phase: "start" });
    const permit = await journal.authorizeDispatch({ runId: event.runId, caseRevision: event.caseRevision, endpoint: c.target.endpoint,
      deployment: "", modelId: c.target.modelId, attempt: 1, maxOutputTokens: c.maxOutputTokens, provider: c.target.provider, outputLimitEnforced: false }, new AbortController().signal);
    await journal.record({ ...event, phase: "dispatch", requests: [{ attempt: 1, approvalId: c.approvalId, transportStarted: false, status: null, requestId: null }] });
    // When the wall clock crosses either exact production boundary.
    Date.now = () => boundary === "validFrom" ? c.validFrom - 1 : permit.expiresAt;
    t.diagnostic(JSON.stringify({ boundary, now: Date.now(), validFrom: c.validFrom, validUntil: c.validUntil, expiresAt: permit.expiresAt }));
    await assert.rejects(journal.wrapTransport(async () => { calls++; return new Response(); })(c.target.endpoint, { body: "{}" }), { name: "OperationJournalError" });
    await journal.record({ ...event, phase: "finish" });
  } finally { Date.now = wall; await journal.close(); }
  // Then the uninvoked transport releases; it cannot become a consumed success.
  assert.equal(calls, 0);
  assert.equal(inspectOperationJournal(root)[0]?.state, "released");
});

test("process time preload retains the real login body deadline without issuing a session", async t => {
  if (await runWithProcessTime(t, import.meta.url)) return;
  // Given a real runtime and a body that remains pending until cancellation.
  const root = await mkdtemp(join(tmpdir(), "o-time-deadline-")), db = await openRuntimeDatabase(root);
  const origin = "http://localhost:3000", app = createOperationalApp({ origin, localAuth: createLocalAuth(db, { origin }), timeoutMs: 30 });
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  try {
    const started = performance.now(), wall = Date.now();
    // When the original, native request timer expires while reading the body.
    const init = { method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded" }, body, duplex: "half" } satisfies RequestInit & { readonly duplex: "half" };
    const result = await app.fetch(new Request(origin + "/login", init));
    t.diagnostic(JSON.stringify({ status: result.status, elapsedMs: performance.now() - started, wallElapsedMs: Date.now() - wall, timeoutMs: 30 }));
    // Then the real deadline cancels the stream without beginning authentication.
    assert.equal(result.status, 504);
    await app.settled(); assert.equal(cancelled, true);
    assert.equal(db.database.query<{ n: number }, []>("SELECT count(*) AS n FROM sessions").get()?.n, 0);
    assert.equal(db.database.query<{ n: number }, []>("SELECT count(*) AS n FROM login_limits").get()?.n, 0);
  } finally { app.dispose(); await app.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});
