import { test } from "node:test";
import assert from "node:assert/strict";
import { createOperationalApp } from "../src/operations.ts";
import type { OperationalClock } from "../src/operations.ts";
import { syntheticCase } from "./h-fixtures.ts";
import { createCaseStore } from "../src/o-case-store.ts";
import { createPhotoStore } from "../src/photos.ts";
import { createRequire } from "node:module";
import { mkdtemp, rm, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CaseInput } from "../src/contracts.ts";
import { Readable } from "node:stream";
import { requestBridge } from "../scripts/app.ts";
import { revision } from "../src/o-validation.ts";
import { createApp } from "../src/app.ts";

const origin = "http://localhost:3000";
function post(path: string, value: unknown) {
  return new Request(origin + path, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(value) });
}
const { caseId: _fixtureId, ...fields } = syntheticCase;
function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error("uninitialized"); };
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
async function createCase(app: ReturnType<typeof createOperationalApp>) {
  const response = await app.fetch(post("/cases", fields)); assert.equal(response.status, 303);
  const path = response.headers.get("location"); assert.ok(path); return path;
}

test("current native case form omits photoRefs and commits owned normalized text input", async () => {
  let actor = "owner";
  const cases = createCaseStore();
  const seen: CaseInput[] = [];
  const app = createOperationalApp({ origin, caseStore: cases, actorForRequest: async () => actor,
    resources: input => { seen.push(input); return {}; } });
  try {
    const home = await app.fetch(new Request(origin));
    assert.equal(home.status, 200);
    const html = await home.text();
    const form = /<form method="post" action="\/cases">([\s\S]*?)<\/form>/.exec(html)?.[1];
    assert.ok(form);
    const values = { description: "합성 네이티브 사례", process: "사출", polymer: "", contamination: "없음",
      hazardousContact: "no", massKg: "12.5", region: "울산", assessmentDate: "2026-11-05" };
    const names = [...form.matchAll(/<(?:input|textarea|select)\b[^>]*\bname="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(names, Object.keys(values));
    const submit = (value: Record<string, string>) => app.fetch(new Request(origin + "/cases", {
      method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(value),
    }));
    const created = await submit(values);
    assert.equal(created.status, 303);
    const path = created.headers.get("location"); assert.ok(path);
    const id = path.slice("/cases/".length);
    const snapshot = cases.read("actor:owner", id); assert.ok(snapshot);
    assert.deepEqual(snapshot.input, { ...values, caseId: id, photoRefs: [], polymer: null, massKg: 12.5 });
    assert.deepEqual(seen, [snapshot.input]);
    assert.equal((await app.fetch(new Request(origin + path))).status, 200);
    actor = "other";
    assert.equal((await app.fetch(new Request(origin + path))).status, 404);
    assert.equal(cases.read("actor:other", id), undefined);
    actor = "owner";
    const { photoRefs: _refs, ...json } = snapshot.input;
    const { caseId: _id, ...missingRefs } = json;
    assert.equal((await app.fetch(post("/cases", missingRefs))).status, 400);
    assert.equal((await submit({ ...values, photoRefs: "https://example.invalid/forged.png" })).status, 502);
    assert.equal(seen.length, 1);
  } finally { app.dispose(); }
});

test("verified ownership survives a new session and rejects a changed actor with the old cookie", async () => {
  let actor: string | null = "owner";
  const app = createOperationalApp({ origin, actorForRequest: async () => actor });
  try {
    const home = await app.fetch(new Request(origin));
    const cookie = home.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    const { caseId: _id, ...input } = syntheticCase;
    const created = await app.fetch(new Request(origin + "/cases", { method: "POST", headers: { origin, cookie, "content-type": "application/json" }, body: JSON.stringify(input) }));
    assert.equal(created.status, 303);
    const path = created.headers.get("location");
    assert.ok(path);
    assert.equal((await app.fetch(new Request(origin + path))).status, 200);
    actor = "other";
    assert.equal((await app.fetch(new Request(origin + path, { headers: { cookie } }))).status, 404);
    actor = null;
    assert.equal((await app.fetch(new Request(origin + path, { headers: { "x-actor-id": "owner" } }))).status, 403);
  } finally { app.dispose(); }
});

test("legacy adapter HTTP composition applies verified ownership independently of photo support", async () => {
  let actor = "owner";
  const decision = { state: "needs-information", caseId: "legacy-case", questions: ["synthetic missing fact"], evidence: [] } as const;
  const app = createApp({ origin, actorForRequest: async () => actor, adapter: { submit: async () => decision, answer: async () => decision } });
  const home = await app(new Request(origin)), cookie = home.headers.get("set-cookie")?.split(";")[0]; assert.ok(cookie);
  assert.equal((await app(post("/cases", {}))).status, 303);
  assert.equal((await app(new Request(origin + "/cases/legacy-case"))).status, 200);
  actor = "other";
  assert.equal((await app(new Request(origin + "/cases/legacy-case", { headers: { cookie } }))).status, 404);
});

test("rejected execution envelope preserves old facts for the next correction", async () => {
  let invalid = false; const seen: CaseInput[] = [];
  const app = createOperationalApp({ origin, actorForRequest: async () => "owner",
    resources: input => { seen.push(input); return {}; }, runner: async () => invalid ? { execution: { traceId: "" } } : {} });
  try {
    const path = await createCase(app);
    const before = await (await app.fetch(new Request(origin + path + "/report"))).text();
    invalid = true;
    assert.equal((await app.fetch(post(path + "/answers", { baseVersion: 1, patch: { massKg: 999 } }))).status, 502);
    assert.equal(await (await app.fetch(new Request(origin + path + "/report"))).text(), before);
    invalid = false;
    assert.equal((await app.fetch(post(path + "/answers", { baseVersion: 1, patch: { process: "압출" } }))).status, 303);
    assert.equal(seen.at(-1)?.massKg, syntheticCase.massKg);
    assert.equal(seen.at(-1)?.process, "압출");
  } finally { app.dispose(); }
});

test("private staged edit keeps GET committed, rejects occupied and ABA stale revisions before resources", { timeout: 5000 }, async () => {
  const entered = deferred<void>(), release = deferred<void>(); let block = false, calls = 0;
  const app = createOperationalApp({ origin, actorForRequest: async () => "owner", resources: async () => {
    calls++; if (block) { entered.resolve(); await release.promise; } return {};
  } });
  try {
    const path = await createCase(app), before = await (await app.fetch(new Request(origin + path))).text();
    block = true;
    const edit = app.fetch(post(path + "/answers", { baseVersion: 1, patch: { massKg: 999 } })); await entered.promise;
    assert.equal(await (await app.fetch(new Request(origin + path))).text(), before);
    assert.equal((await app.fetch(post(path + "/answers", { baseVersion: 1, patch: { massKg: 10 } }))).status, 409);
    assert.equal(calls, 2);
    block = false; release.resolve(); assert.equal((await edit).status, 303);
    assert.equal((await app.fetch(post(path + "/answers", { baseVersion: 2, patch: { massKg: syntheticCase.massKg } }))).status, 303);
    assert.equal((await app.fetch(post(path + "/answers", { baseVersion: 1, patch: { massKg: 12 } }))).status, 409);
    assert.equal(calls, 3);
  } finally { release.resolve(); app.dispose(); }
});

test("resource photo authorization sees only its request stage while another case remains concurrent", { timeout: 5000 }, async () => {
  const cases = createCaseStore(), entered = deferred<void>(), release = deferred<void>();
  let target = "", staged = "", expectedStage = "";
  const app = createOperationalApp({ origin, caseStore: cases, actorForRequest: async () => "owner", resources: async (input, signal) => {
    if (input.caseId === target) {
      const access = await cases.authorize("owner", input.caseId, signal);
      staged = access?.caseRevision ?? ""; expectedStage = revision(input); entered.resolve(); await release.promise;
    }
    return {};
  } });
  try {
    const path = await createCase(app); target = path.slice(7);
    const committed = cases.read("actor:owner", target); assert.ok(committed);
    const edit = app.fetch(post(path + "/answers", { baseVersion: 1, patch: { massKg: 999 } })); await entered.promise;
    assert.equal(staged, expectedStage);
    assert.notEqual(staged, revision(committed.input));
    assert.equal((await cases.authorize("owner", target, new AbortController().signal))?.caseRevision, revision(committed.input));
    assert.notEqual(await createCase(app), path);
    release.resolve(); assert.equal((await edit).status, 303);
  } finally { release.resolve(); app.dispose(); }
});

const photon = createRequire(import.meta.resolve("@code-yeongyu/senpi"))("@silvia-odwyer/photon-node") as typeof import("@silvia-odwyer/photon-node");
test("delayed answer body cannot pair an old snapshot with a newly committed baseVersion", { timeout: 5000 }, async () => {
  const cases = createCaseStore(), reading = deferred<void>();
  const seen: CaseInput[] = [];
  const app = createOperationalApp({ origin, caseStore: cases, actorForRequest: async () => "owner",
    resources: input => { seen.push(input); return {}; } });
  let streamController!: ReadableStreamDefaultController<Uint8Array>;
  try {
    const path = await createCase(app), id = path.slice(7);
    const stream = new ReadableStream<Uint8Array>({ start(controller) { streamController = controller; }, pull() { reading.resolve(); } }, { highWaterMark: 0 });
    const pending = app.fetch(new Request(origin + path + "/answers", { method: "POST",
      headers: { origin, "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit & { duplex: "half" }));
    await reading.promise;
    assert.equal((await app.fetch(post(path + "/answers", { baseVersion: 1, patch: { process: "압출" } }))).status, 303);
    const committed = cases.read("actor:owner", id); assert.ok(committed); assert.equal(committed.version, 2);
    const report = await (await app.fetch(new Request(origin + path + "/report"))).text();
    const evaluations = seen.length;
    streamController.enqueue(new TextEncoder().encode(JSON.stringify({ baseVersion: 2, patch: { massKg: 999 } })));
    streamController.close();
    assert.equal((await pending).status, 409);
    assert.equal(seen.length, evaluations);
    assert.deepEqual(cases.read("actor:owner", id), committed);
    assert.equal(await (await app.fetch(new Request(origin + path + "/report"))).text(), report);
    assert.equal((await app.fetch(post(path + "/answers", { baseVersion: 2, patch: { massKg: 500 } }))).status, 303);
    const next = cases.read("actor:owner", id); assert.ok(next);
    assert.equal(next.version, 3); assert.equal(next.input.process, "압출"); assert.equal(next.input.massKg, 500);
    assert.equal(seen.at(-1)?.process, "압출");
  } finally { app.dispose(); }
});

function pixels() { const image = new photon.PhotonImage(new Uint8Array([255, 0, 0, 255]), 1, 1); try { return new Uint8Array(image.get_bytes()); } finally { image.free(); } }

test("cancelled upload releases its lease before late storage and cleanup without disturbing a newer edit", { timeout: 5000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "o4-cancelled-upload-")), cases = createCaseStore();
  const store = await createPhotoStore({ root, retentionMs: 60000, maxPhotos: 10, authorize: cases.authorize });
  const entered = deferred<void>(), release = deferred<void>(), cleanupEntered = deferred<void>(), cleanupRelease = deferred<void>(), finished = deferred<void>();
  const editEntered = deferred<void>(), editRelease = deferred<void>();
  let receipt: Awaited<ReturnType<typeof store.put>> | undefined, revoked = false;
  const app = createOperationalApp({ origin, actorForRequest: async () => "owner", photoPolicy: { retentionMs: 60000 },
    caseStore: { ...cases, rollback(lease) { cases.rollback(lease); if (revoked && lease.base === 1) finished.resolve(); } },
    photoStore: { ...store,
      async put(actor, id, data, mime, consent, _signal) {
        receipt = await store.put(actor, id, data, mime, consent, new AbortController().signal);
        entered.resolve(); await release.promise; return receipt;
      },
      async revoke(actor, ref, signal) {
        cleanupEntered.resolve(); await cleanupRelease.promise;
        await store.revoke(actor, ref, signal); revoked = true;
      },
    },
    resources: async input => { if (input.massKg === 600) { editEntered.resolve(); await editRelease.promise; } return {}; },
  });
  try {
    const path = await createCase(app), id = path.slice(7), controller = new AbortController();
    const data = new FormData(); data.set("baseVersion", "1"); data.set("store", "yes");
    data.set("file", new File([pixels()], "synthetic.png", { type: "image/png" }));
    const pending = app.fetch(new Request(origin + path + "/photos", { method: "POST", headers: { origin }, body: data, signal: controller.signal }));
    await entered.promise; controller.abort();
    assert.equal((await pending).status, 408);
    assert.equal((await app.fetch(post(path + "/answers", { baseVersion: 1, patch: { massKg: 500 } }))).status, 303);
    release.resolve(); await cleanupEntered.promise;
    assert.deepEqual(cases.read("actor:owner", id)?.photos, []);
    const newer = app.fetch(post(path + "/answers", { baseVersion: 2, patch: { massKg: 600 } })); await editEntered.promise;
    cleanupRelease.resolve(); await finished.promise;
    assert.equal(revoked, true); assert.ok(receipt);
    await assert.rejects(store.read("owner", { caseId: id, caseRevision: receipt.uploadRevision, photoRef: receipt.photoRef }, new AbortController().signal));
    assert.equal((await app.fetch(post(path + "/answers", { baseVersion: 2, patch: { massKg: 700 } }))).status, 409);
    editRelease.resolve(); assert.equal((await newer).status, 303);
    const snapshot = cases.read("actor:owner", id); assert.ok(snapshot);
    assert.equal(snapshot.version, 3); assert.equal(snapshot.input.massKg, 600); assert.deepEqual(snapshot.photos, []);
  } finally {
    release.resolve(); cleanupRelease.resolve(); editRelease.resolve(); app.dispose();
    // Drain compensation even when the pre-fix lease assertion fails.
    if (receipt) await finished.promise;
    await rm(root, { recursive: true, force: true });
  }
});

async function photoApp(clock?: OperationalClock) {
  const root = await mkdtemp(join(tmpdir(), "o4-photo-http-")), cases = createCaseStore();
  const store = await createPhotoStore({ root, retentionMs: 60000, maxPhotos: 10, authorize: cases.authorize });
  let actor = "owner";
  const entered = deferred<void>(), release = deferred<void>(); let blocked = false;
  const app = createOperationalApp({ origin, clock, timeoutMs: clock ? 200 : 10000, caseStore: cases, photoStore: store, photoPolicy: { retentionMs: 60000 }, actorForRequest: async () => actor,
    resources: async () => { if (blocked) { entered.resolve(); await release.promise; } return {}; } });
  const path = await createCase(app);
  const upload = (change?: (data: FormData) => void) => {
    const data = new FormData(); data.set("baseVersion", "1"); data.set("store", "yes"); data.set("file", new File([pixels()], "synthetic.png", { type: "image/png" }));
    change?.(data); return new Request(origin + path + "/photos", { method: "POST", headers: { origin }, body: data });
  };
  return { app, path, upload, store, root, cases, entered, release, block: () => { blocked = true; }, actor: (value: string) => { actor = value; },
    async close() { release.resolve(); app.dispose(); await rm(root, { recursive: true, force: true }); } };
}

test("storage-only upload produces private PNG preview without model permission and cross-actor access", async () => {
  const f = await photoApp();
  try {
    assert.equal((await f.app.fetch(f.upload())).status, 303);
    const snapshot = f.cases.read("actor:owner", f.path.slice(7)), photo = snapshot?.photos[0]; assert.ok(photo); assert.ok(snapshot);
    const previewPath = `${f.path}/photos/${photo.photoRef}`;
    const preview = await f.app.fetch(new Request(origin + previewPath));
    assert.equal(preview.status, 200); assert.equal(preview.headers.get("content-type"), "image/png");
    const decoded = photon.PhotonImage.new_from_byteslice(new Uint8Array(await preview.arrayBuffer()));
    try { assert.deepEqual(decoded.get_raw_pixels(), new Uint8Array([255, 0, 0, 255])); } finally { decoded.free(); }
    await assert.rejects(f.store.resolver("owner")({ photoRef: photo.photoRef, caseId: snapshot.input.caseId, caseRevision: photo.uploadRevision }, new AbortController().signal));
    assert.equal((await f.app.fetch(post(f.path + "/answers", { baseVersion: 2, patch: { photoRefs: [photo.photoRef] } }))).status, 502);
    f.actor("other");
    for (const request of [new Request(origin + f.path), new Request(origin + f.path + "/report"), new Request(origin + previewPath), post(previewPath + "/withdraw-storage", {}), post(f.path + "/answers", { baseVersion: 2, patch: { massKg: 1 } }), f.upload()]) assert.equal((await f.app.fetch(request)).status, 404);
  } finally { await f.close(); }
});

test("native versioned reevaluation keeps storage-only attachments unselected and rejects stale form reuse", async () => {
  const f = await photoApp();
  try {
    assert.equal((await f.app.fetch(f.upload())).status, 303);
    const answer = () => new Request(origin + f.path + "/answers", { method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ baseVersion: "2", photoSelection: "explicit", answers: "{}" }) });
    assert.equal((await f.app.fetch(answer())).status, 303);
    const snapshot = f.cases.read("actor:owner", f.path.slice(7)); assert.ok(snapshot);
    assert.deepEqual(snapshot.input.photoRefs, []); assert.equal(snapshot.photos.length, 1); assert.equal(snapshot.version, 3);
    assert.equal((await f.app.fetch(answer())).status, 409);
  } finally { await f.close(); }
});

test("storage withdrawal preempts a blocked edit and cannot be rolled back by its late result", { timeout: 5000 }, async () => {
  const f = await photoApp();
  try {
    assert.equal((await f.app.fetch(f.upload())).status, 303);
    const photo = f.cases.read("actor:owner", f.path.slice(7))?.photos[0]; assert.ok(photo);
    f.block();
    const edit = f.app.fetch(post(f.path + "/answers", { baseVersion: 2, patch: { massKg: 999 } })); await f.entered.promise;
    assert.equal((await f.app.fetch(post(`${f.path}/photos/${photo.photoRef}/withdraw-storage`, {}))).status, 303);
    f.release.resolve(); assert.equal((await edit).status, 408);
    assert.equal((await f.app.fetch(new Request(`${origin}${f.path}/photos/${photo.photoRef}`))).status, 404);
    const snapshot = f.cases.read("actor:owner", f.path.slice(7)); assert.ok(snapshot);
    assert.equal(snapshot.input.massKg, syntheticCase.massKg); assert.equal(snapshot.version, 3); assert.equal(snapshot.permissionChanged, true);
  } finally { await f.close(); }
});

test("cancelled late lease cannot overwrite a newer completed correction", { timeout: 5000 }, async () => {
  const entered = deferred<void>(), release = deferred<void>(), finished = deferred<void>(), cases = createCaseStore();
  const app = createOperationalApp({ origin, caseStore: cases, actorForRequest: async () => "owner", resources: async input => {
    if (input.massKg === 999) { entered.resolve(); await release.promise; finished.resolve(); } return {};
  } });
  try {
    const path = await createCase(app), controller = new AbortController();
    const request = post(path + "/answers", { baseVersion: 1, patch: { massKg: 999 } });
    const pending = app.fetch(new Request(request, { signal: controller.signal })); await entered.promise; controller.abort();
    assert.equal((await pending).status, 408);
    assert.equal((await app.fetch(post(path + "/answers", { baseVersion: 1, patch: { massKg: 500 } }))).status, 303);
    release.resolve(); await finished.promise;
    const snapshot = cases.read("actor:owner", path.slice(7)); assert.ok(snapshot);
    assert.equal(snapshot.input.massKg, 500); assert.equal(snapshot.version, 2);
  } finally { release.resolve(); app.dispose(); }
});

test("stalled multipart consumes the original request deadline and releases its stream", { timeout: 5000 }, async () => {
  let time = 0; const timers = new Map<() => void, number>();
  const clock: OperationalClock = { now: () => time, schedule(callback, delay) { timers.set(callback, time + delay); return () => { timers.delete(callback); }; } };
  const f = await photoApp(clock), reading = deferred<void>(); let cancelled = false;
  try {
    const stream = new ReadableStream<Uint8Array>({ pull() { reading.resolve(); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
    const request = new Request(origin + f.path + "/photos", { method: "POST", headers: { origin, "content-type": "multipart/form-data; boundary=synthetic" }, body: stream, duplex: "half" } as RequestInit & { duplex: "half" });
    const pending = f.app.fetch(request); await reading.promise;
    time = 200; for (const [callback, at] of timers) if (at <= time) { timers.delete(callback); callback(); }
    assert.equal((await pending).status, 504); assert.equal(cancelled, true); assert.equal(timers.size, 0);
    assert.equal(f.cases.read("actor:owner", f.path.slice(7))?.photos.length, 0);
  } finally { await f.close(); }
});

test("model-only withdrawal retains preview and a failed durable denial stays failed until retry", async () => {
  const f = await photoApp(); let moved = false;
  try {
    assert.equal((await f.app.fetch(f.upload())).status, 303);
    const photo = f.cases.read("actor:owner", f.path.slice(7))?.photos[0]; assert.ok(photo);
    const preview = `${f.path}/photos/${photo.photoRef}`;
    await rename(f.root, f.root + "-moved"); moved = true;
    assert.equal((await f.app.fetch(post(preview + "/withdraw-model", {}))).status, 503);
    assert.equal(f.cases.read("actor:owner", f.path.slice(7))?.denied.includes(photo.photoRef), true);
    await rename(f.root + "-moved", f.root); moved = false;
    assert.equal((await f.app.fetch(post(preview + "/withdraw-model", {}))).status, 303);
    assert.equal((await f.app.fetch(new Request(origin + preview))).status, 200);
    assert.equal(f.cases.read("actor:owner", f.path.slice(7))?.photos.length, 1);
  } finally { if (moved) await rename(f.root + "-moved", f.root); await f.close(); }
});

test("multipart rejects duplicated, unknown, forged consent, unsupported MIME and invalid pixels", async () => {
  const f = await photoApp();
  try {
    const cases: readonly [((data: FormData) => void), number][] = [
      [data => data.append("store", "yes"), 400], [data => data.set("expiresAt", "9999999999999"), 400],
      [data => data.set("model", "yes"), 400], [data => data.delete("store"), 400],
      [data => data.set("file", new File([pixels()], "synthetic.gif", { type: "image/gif" })), 415],
      [data => data.set("file", new File(["bad pixels"], "bad.png", { type: "image/png" })), 400],
    ];
    for (const [change, status] of cases) assert.equal((await f.app.fetch(f.upload(change))).status, status);
    assert.equal(f.cases.read("actor:owner", f.path.slice(7))?.photos.length, 0);
    assert.equal((await f.app.fetch(f.upload())).status, 303);
  } finally { await f.close(); }
});

test("chunked oversize multipart is cancelled before an attachment is published", async () => {
  const f = await photoApp(); let cancelled = false;
  try {
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { if (sent++ === 7) controller.close(); else controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled = true; } });
    const request = new Request(origin + f.path + "/photos", { method: "POST", headers: { origin, "content-type": "multipart/form-data; boundary=synthetic" }, body: stream, duplex: "half" } as RequestInit & { duplex: "half" });
    assert.equal((await f.app.fetch(request)).status, 413); assert.equal(cancelled, true);
    assert.equal(f.cases.read("actor:owner", f.path.slice(7))?.photos.length, 0);
  } finally { await f.close(); }
});

test("native bridge starts the app before consuming body and preserves sanitized PNG response bytes", async () => {
  const expected = pixels(); let consumed = false, entered = false;
  const incoming = Object.assign(new Readable({ read() { consumed = true; this.push(Buffer.from("synthetic upload")); this.push(null); } }), { method: "POST", url: "/cases/synthetic/photos", headers: { "content-type": "application/octet-stream" } });
  let status = 0, bytes: string | Uint8Array = "", contentType: string | undefined;
  await requestBridge(origin, async request => {
    entered = true; assert.equal(consumed, false);
    assert.equal(await request.text(), "synthetic upload");
    return new Response(expected, { headers: { "content-type": "image/png" } });
  })(incoming, { writableEnded: false, once() {}, writeHead(code, headers) { status = code; contentType = headers?.["content-type"]; }, end(value) { bytes = value; } });
  assert.equal(entered, true); assert.equal(status, 200); assert.equal(contentType, "image/png"); assert.deepEqual(bytes, Buffer.from(expected));
});
