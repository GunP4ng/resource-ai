import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.ts";
import { createOperationalApp } from "../src/operations.ts";
import { openRuntimeDatabase } from "../src/o-runtime-db.ts";
import { createCaseStore } from "../src/o-case-store.ts";
import { createLocalAuth } from "../src/o-auth.ts";
const origin = "http://localhost:3000", app = createApp({ origin });
const output = "/tmp/resource-ai-o-demo";
await mkdir(output, { recursive: true });
for (const id of ["normal", "held", "review"] as const) {
  const result = await app(new Request(`${origin}/demo/${id}`)); assert.equal(result.status, 200);
  const html = await result.text(); await writeFile(`${output}/${id}.html`, html);
  console.log(`APP_DEMO_PASS ${id} status=200 bytes=${Buffer.byteLength(html)} mode=synthetic modelCalls=none file=${output}/${id}.html`);
}
const reference = await app(new Request(`${origin}/reference`)); assert.equal(reference.status, 200);
await writeFile(`${output}/reference.html`, await reference.text());
console.log(`REAL_REFERENCE_PASS status=200 file=${output}/reference.html`);
const home = await app(new Request(origin)); const cookie = home.headers.get("set-cookie")?.split(";")[0]; assert.ok(cookie);
const unavailable = await app(new Request(`${origin}/cases`, { method: "POST", headers: { origin, cookie, "content-type": "application/json" }, body: "{}" }));
assert.equal(unavailable.status, 503);
console.log("LIVE_READINESS_PASS status=503 adapter=absent modelCalls=none");
app.dispose();

const temporary = await mkdtemp(join(tmpdir(), "resource-held-demo-"));
const secret = randomBytes(32).toString("hex");
async function runtime() {
  const db = await openRuntimeDatabase(join(temporary, "state"));
  const cases = createCaseStore(Date.now, undefined, db), auth = createLocalAuth(db, { origin });
  const app = createOperationalApp({ origin, localAuth: auth, caseStore: cases,
    runtime: { identity: "local-operator", storage: "sqlite", runner: "local" } });
  return { db, cases, auth, app, async close() { app.dispose(); await app.close(); cases.dispose(); db.close(); } };
}
let current = await runtime();
try {
  await current.auth.create("demo", secret);
  const logged = await current.auth.login("demo", secret, new AbortController().signal);
  const cookie = logged.setCookie.split(";")[0]; assert.ok(cookie);
  const form = (path: string, data: Record<string, string>) => new Request(origin + path, { method: "POST", headers: { origin, cookie, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(data) });
  const created = await current.app.fetch(form("/cases", { description: "시연 입력 · 질량과 수지 확인 필요", process: "", polymer: "", contamination: "", hazardousContact: "unknown", massKg: "", region: "", assessmentDate: new Date().toISOString().slice(0, 10) }));
  assert.equal(created.status, 303); const path = created.headers.get("location"); assert.ok(path);
  const corrected = await current.app.fetch(form(path + "/answers", { baseVersion: "1", photoSelection: "explicit", answers: '{"polymer":"PP","massKg":100}' }));
  assert.equal(corrected.status, 303);
  const report = await current.app.fetch(new Request(origin + path + "/report", { headers: { cookie } })); assert.equal(report.status, 200);
  const before = await report.text(); await writeFile(join(output, "held-native.html"), before);
  const exported = await current.app.fetch(new Request(origin + path + "/input", { headers: { cookie } })); assert.equal(exported.status, 200);
  await writeFile(join(output, "held-input.json"), await exported.text());
  await current.close(); current = await runtime();
  const recovered = await current.auth.login("demo", secret, new AbortController().signal);
  const after = await current.app.fetch(new Request(origin + path + "/report", { headers: { cookie: recovered.setCookie.split(";")[0] ?? "" } }));
  assert.equal(after.status, 200); assert.equal(await after.text(), before);
  console.log("HELD_NATIVE_PASS create=303 correction=303 export=200 restart=200 runner=local resources=unavailable");
  console.log("Demo outputs are generated handler HTML, not actual HTTP/browser QA or a recording. Normal: 3-minute synthetic calculation track; held: 2-minute native correction/recovery track.");
} finally { await current.close(); await rm(temporary, { recursive: true, force: true }); }
