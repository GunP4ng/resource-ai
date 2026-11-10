import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { PhotonImage } from "@silvia-odwyer/photon-node";
import { Database } from "bun:sqlite";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createOperatorRuntime } from "../src/o-operational-runtime.ts";
import { parseOperationalConfiguration } from "../src/o-operations-config.ts";
import { revision } from "../src/o-validation.ts";
import { inspectOperationJournal } from "../scripts/o-journal.ts";
import { openCaseSession } from "../src/session.ts";
import { openRuntimeDatabase } from "../src/o-runtime-db.ts";
import { createCaseStore } from "../src/o-case-store.ts";
import { createLocalAuth } from "../src/o-auth.ts";
import { createPhotoStore } from "../src/photos.ts";
import { createSubscriptionPhotoExecutionAuthority } from "../src/photo-execution.ts";
import { createFileResourceProvider } from "../src/o-resources.ts";
import { openOperationJournal } from "../src/o-operation-journal.ts";
import { createOperationalApp } from "../src/operations.ts";
import { fixture, origin, login, post, response, signal } from "./o-operational-fixtures.ts";

for (const rollbackMs of [0, 2000]) test(`selected photo expiry after durable transport intent blocks invocation and releases before terminal audit${rollbackMs ? " after wall clock rollback" : ""}`, async t => {
  const cleanup: (() => unknown)[] = [];
  t.after(async () => {
    const failures: unknown[] = [];
    for (const close of cleanup.reverse()) { try { await close(); } catch (error) { failures.push(error); } }
    if (failures.length) throw new AggregateError(failures, "expiry regression cleanup failed");
  });
  const f = await fixture(t), { authPath: _auth, ...target } = f.config.target;
  const wallNow = Date.now;
  const wall = mock.method(Date, "now", () => wallNow() - rollbackMs); cleanup.push(() => wall.mock.restore());
  const config = parseOperationalConfiguration({ ...f.config, photos: { enabled: true, mappings: [{ target, scope: { provider: target.provider, purpose: f.config.purpose } }] } });
  let calls = 0, checkedAt: number | undefined;
  const db = await openRuntimeDatabase(f.stateRoot, { existingOnly: true }); cleanup.push(() => db.close());
  const issued = db.database.query<{ created_at: number }, [string]>("SELECT created_at FROM sessions WHERE actor_id=?").get(f.actor.actorId);
  assert.ok(issued);
  if (rollbackMs) assert.ok(Date.now() < issued.created_at);
  // Continue the authenticated fixture's epoch, and advance all expiry/grant
  // clocks together when the durable intent is committed below.
  let at = issued.created_at;
  wall.mock.mockImplementation(() => at);
  const authority = createSubscriptionPhotoExecutionAuthority(); authority.publish(config.target, config.photos.mappings);
  const cases = createCaseStore(() => at, authority, db); cleanup.push(() => cases.dispose());
  const auth = createLocalAuth(db, { origin, now: () => at }), owner = `actor:${f.actor.actorId}`;
  const photos = await createPhotoStore({ root: join(f.stateRoot, "photos"), authorize: cases.authorize,
    retentionMs: 1000, maxPhotos: 10, now: () => at, photoExecution: authority });
  const ticket = authority.current(); assert.ok(ticket);
  const image = new PhotonImage(new Uint8Array([255, 0, 0, 255]), 1, 1);
  let png: Uint8Array;
  try { png = new Uint8Array(image.get_bytes()); } finally { image.free(); }
  const photo = await photos.put(f.actor.actorId, f.snapshot.input.caseId, png, "image/png", {
    recordId: "synthetic-expiry-consent", store: true, model: true, visibleContentReviewed: true,
    modelBindingId: ticket.bindingId, modelScope: ticket.scope, expiresAt: at + 60000,
  }, signal());
  const association = cases.begin(owner, f.snapshot.input.caseId, f.snapshot.version);
  try { cases.associate(association, photo, () => {}); } finally { cases.rollback(association); }
  const snapshot = cases.read(owner, f.snapshot.input.caseId); assert.ok(snapshot);
  // The committed selection is empty; the lease will select the associated photo.
  assert.deepEqual(snapshot.input.photoRefs, []);
  const input = { ...snapshot.input, photoRefs: [photo.photoRef] };
  assert.equal(cases.eligible(snapshot, input, ticket), true);
  const next = parseOperationalConfiguration({ ...config, grants: [{ actorId: f.actor.actorId, caseId: input.caseId, inputRevision: revision(input), artifactSha256: null }] });
  const journal = await openOperationJournal({ stateRoot: f.stateRoot, configuration: next, currentOperation: () => cases.currentOperation() });
  cleanup.push(() => journal.close());
  const resources = await createFileResourceProvider({ root: f.resourcesRoot, caseStore: cases });
  const assertCanTransmit = photos.assertCanTransmit;
  photos.assertCanTransmit = async (...args) => { await assertCanTransmit(...args); checkedAt = at; };
  const app = createOperationalApp({ origin, caseStore: cases, localAuth: auth, resources, photoStore: photos,
    photoPolicy: { retentionMs: 1000 }, presentationMode: "synthetic", timeoutMs: next.requestTimeoutMs,
    operations: { enabled: true, provider: "subscription", timeoutMs: next.runnerTimeoutMs, maxTurns: next.maxTurns,
      maxOutputTokens: next.maxOutputTokens, configuration: async () => next.target, photoExecution: authority,
      authorizeDispatch: journal.authorizeDispatch, record: journal.record,
      transport: journal.wrapTransport(async () => { calls++; return response(input); }) } });
  cleanup.push(async () => { app.dispose(); await app.close(); });
  const journalPath = join(f.stateRoot, "operations", "journal.sqlite");
  const observer = new Database(journalPath, { readonly: true });
  cleanup.push(() => observer.close());
  const transaction = Database.prototype.transaction;
  let crossedExpiry = false, releasedBeforeTerminal = false;
  try {
    const cookie = await login(app);
    // Observe the real SQLite transaction after its synchronous FULL commit returns.
    // No guard is replaced, and all prior app/SDK/photo checks run normally.
    Database.prototype.transaction = new Proxy(transaction, { apply(original, connection: Database, args) {
      const work = Reflect.apply(original, connection, args);
      if (connection.filename !== journalPath) return work;
      return new Proxy(work.bind(connection), { get(_wrapped, key) {
        const method = Reflect.get(work, key);
        if (key !== "immediate") return method;
        return (...params: unknown[]) => {
          const result = Reflect.apply(method, work, params);
          const intent = observer.query<{ state: string; expires: number; payload: string | null; response: string | null; terminal: string | null }, []>(
            "SELECT a.state,a.expires,a.payload,a.response,r.terminal FROM attempts a JOIN runs r ON r.id=a.run").get();
          if (!crossedExpiry && intent?.state === "unresolved" && intent.payload) {
            assert.equal(checkedAt, at); assert.ok(at < photo.expiresAt);
            assert.deepEqual(JSON.parse(intent.payload).intendedPhotoSha256, [photo.sha256]);
            assert.equal(calls, 0); assert.equal(intent.response, null); assert.equal(intent.terminal, null);
            at = photo.expiresAt; crossedExpiry = true;
            assert.ok(intent.expires > at && next.validUntil > at);
            const lease = db.database.query<{ expires: number; expected_version: number }, [string]>("SELECT expires,expected_version FROM leases WHERE case_id=?").get(input.caseId);
            assert.ok(lease && lease.expires > at); assert.equal(lease.expected_version, snapshot.version);
            const identity = auth.resolve(post(f.path + "/answers", cookie, {}), signal()); assert.ok(identity); identity.assertCurrent();
            authority.assertCurrent(ticket);
            assert.equal(cases.eligible(snapshot, input, ticket), false);
          } else if (crossedExpiry && intent?.state === "released" && intent.terminal === null) {
            assert.equal(calls, 0); assert.equal(intent.response, null); releasedBeforeTerminal = true;
          }
          return result;
        };
      } });
    } });
    const result = await app.fetch(post(f.path + "/answers", cookie, { baseVersion: snapshot.version, patch: { photoRefs: input.photoRefs } }));
    await app.settled(); await journal.settled();
    assert.equal(crossedExpiry, true); assert.ok(checkedAt !== undefined && checkedAt < at);
    assert.equal(calls, 0);
    assert.equal(result.status, 502); assert.equal(releasedBeforeTerminal, true);
    assert.deepEqual(journal.inspectPending(), []); assert.deepEqual(cases.read(owner, input.caseId), snapshot);
    const row = observer.query<{ state: string; payload: string | null; response: string | null }, []>("SELECT state,payload,response FROM attempts").get();
    assert.equal(row?.state, "released"); assert.ok(row.payload); assert.equal(row.response, null);
  } finally {
    Database.prototype.transaction = transaction;
  }
});

for (const scenario of ["success", "withdrawal", "changed-bytes", "stale-ticket", "expiry"] as const) test(`disk photo authority and exact grant reload ${scenario}`, async t => {
  const f = await fixture(t), { authPath: _auth, ...target } = f.config.target;
  const config = parseOperationalConfiguration({ ...f.config, photos: { enabled: true, mappings: [{ target, scope: { provider: target.provider, purpose: f.config.purpose } }] } });
  let calls = 0, input = f.snapshot.input;
  const runtime = await createOperatorRuntime({ ...f, origin, configuration: config, privatePhotos: true, transport: async () => { calls++; return response(input); } }, async (...args) => {
    const owned = await openCaseSession(...args), stream = owned.session.agent.streamFunction;
    if (scenario === "stale-ticket") owned.session.agent.streamFunction = (model, context, settings) => stream(model, context, { ...settings, fetch: async (url, init) => {
      runtime.authority.publish(config.target, config.photos.mappings);
      assert.ok(settings?.fetch); return settings.fetch(url, init);
    } });
    return owned;
  });
  try {
    const cookie = await login(runtime.app), ticket = runtime.authority.current(); assert.ok(ticket);
    const image = new PhotonImage(new Uint8Array([255, 0, 0, 255]), 1, 1), form = new FormData();
    form.set("baseVersion", "1"); form.set("store", "yes"); form.set("model", "yes"); form.set("visible", "yes"); form.set("modelBindingId", ticket.bindingId);
    try { form.set("file", new File([new Uint8Array(image.get_bytes())], "synthetic.png", { type: "image/png" })); } finally { image.free(); }
    assert.equal((await runtime.app.fetch(new Request(origin + f.path + "/photos", { method: "POST", headers: { origin, cookie }, body: form }))).status, 303);
    const snapshot = runtime.caseStore.read(`actor:${f.actor.actorId}`, f.snapshot.input.caseId); assert.ok(snapshot);
    const photo = snapshot.photos[0]; assert.ok(photo);
    input = { ...snapshot.input, photoRefs: [photo.photoRef] };
    const next = parseOperationalConfiguration({ ...config, approvalId: "explicit-new-photo-grant", grants: [{ actorId: f.actor.actorId, caseId: input.caseId, inputRevision: revision(input), artifactSha256: null }] });
    await runtime.reloadConfiguration(next);
    assert.equal(runtime.authority.current(), ticket);
    let baseVersion = 2;
    if (scenario === "withdrawal") {
      assert.equal((await runtime.app.fetch(post(f.path + `/photos/${photo.photoRef}/withdraw-model`, cookie, {}))).status, 303); baseVersion = 3;
    }
    if (scenario === "changed-bytes" || scenario === "expiry") {
      const path = join(f.stateRoot, "photos", photo.photoRef + ".json"), value = JSON.parse(await readFile(path, "utf8"));
      if (scenario === "changed-bytes") value.png = Buffer.from("changed bytes").toString("base64");
      else { const at = Date.now(); value.createdAt = at - 7200000; value.expiresAt = at - 3600000; }
      await writeFile(path, JSON.stringify(value), { mode: 0o600 });
    }
    const result = await runtime.app.fetch(post(f.path + "/answers", cookie, { baseVersion, patch: { photoRefs: [photo.photoRef] } }));
    const success = scenario === "success";
    assert.equal(result.status, success ? 303 : 502); assert.equal(calls, success ? 1 : 0);
    if (success) assert.equal(runtime.caseStore.read(`actor:${f.actor.actorId}`, input.caseId)?.presentation?.mode, "synthetic");
  } finally { await runtime.close(); }
  if (scenario === "success") {
    const row = inspectOperationJournal(f.stateRoot)[0]; assert.ok(row?.payload);
    assert.equal(JSON.parse(row.payload).intendedPhotoSha256.length, 1);
    assert.equal(JSON.parse(row.terminal ?? "null").images.length, 1);
  }
});

test("a grant reload cannot retarget the shared photo authority or relabel injected transport", async t => {
  const f = await fixture(t); let calls = 0;
  const runtime = await createOperatorRuntime({ ...f, origin, configuration: f.config, privatePhotos: false, transport: async () => { calls++; return response(f.snapshot.input); } });
  try {
    await assert.rejects(runtime.reloadConfiguration(parseOperationalConfiguration({ ...f.config, approvalId: "different-target", target: { ...f.config.target, modelId: "different-model" } })));
    assert.equal((await runtime.app.fetch(new Request(origin + "/operations/readiness"))).status, 503); assert.equal(calls, 0);
  } finally { await runtime.close(); }
});
