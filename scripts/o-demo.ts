import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createApp } from "../src/app.ts";
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
