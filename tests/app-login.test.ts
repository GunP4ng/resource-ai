import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../src/app.ts";
import { createLocalAuth } from "../src/o-auth.ts";
import { createMemoryRuntimeDatabase } from "../src/o-runtime-db.ts";

const origin = "http://localhost:3000";
function fixture(t: { after(fn: () => void): void }) {
  const runtime = createMemoryRuntimeDatabase();
  const auth = createLocalAuth(runtime, { origin });
  const app = createApp({ origin, localAuth: auth });
  t.after(() => { app.dispose(); runtime.close(); });
  return { app, auth, runtime };
}
function submit(fields: Readonly<Record<string, string>>, requestOrigin = origin) {
  return new Request(origin + "/login", {
    method: "POST", headers: { origin: requestOrigin, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
}
async function loginControls(result: Response) {
  const inputs: { name: string | null; type: string | null; autocomplete: string | null; value: string | null }[] = [];
  let forms = 0, alerts = 0;
  await new HTMLRewriter()
    .on('form[method="post"][action="/login"]', { element() { forms++; } })
    .on('form[action="/login"] input', { element(element) {
      inputs.push({ name: element.getAttribute("name"), type: element.getAttribute("type"),
        autocomplete: element.getAttribute("autocomplete"), value: element.getAttribute("value") });
    } })
    .on('form[action="/login"] [role="alert"]', { element() { alerts++; } })
    .transform(result).text();
  return { forms, inputs, alerts };
}

test("protected GET keeps 403 and provides a primary link to the working login form", async t => {
  const { app } = fixture(t);
  for (const path of ["/", "/cases", "/cases/private-case/report"]) {
    const result = await app(new Request(origin + path));
    assert.equal(result.status, 403);
    assert.equal(result.headers.get("set-cookie"), null);
    let target: string | null = null;
    await new HTMLRewriter().on("a.primary-action", { element(element) {
      target = element.getAttribute("href");
    } }).transform(result).text();
    assert.equal(target, "/login");
    const login = await app(new Request(origin + target));
    assert.equal(login.status, 200);
    const controls = await loginControls(login);
    assert.equal(controls.forms, 1);
    assert.deepEqual(controls.inputs, [
      { name: "username", type: "text", autocomplete: "username", value: null },
      { name: "password", type: "password", autocomplete: "current-password", value: null },
    ]);
    assert.equal(controls.alerts, 0);
  }
});

test("invalid login stays retryable with an inline error and never echoes submitted secrets", async t => {
  const { app } = fixture(t);
  const secret = "wrong-password-<script>do-not-echo</script>";
  const result = await app(submit({ username: "unknown", password: secret }));
  assert.equal(result.status, 403);
  assert.equal(result.headers.get("set-cookie"), null);
  const html = await result.text();
  assert.ok(!html.includes(secret));
  const controls = await loginControls(new Response(html));
  assert.equal(controls.forms, 1);
  assert.equal(controls.alerts, 1);
  assert.equal(controls.inputs.find(input => input.name === "password")?.value, null);
});

test("login input and origin failures retain their status and a retry form", async t => {
  const { app } = fixture(t);
  for (const [request, status] of [
    [submit({ username: "demo" }), 400],
    [submit({ username: "demo", password: "long-test-password" }, "https://other.example"), 403],
  ] as const) {
    const result = await app(request);
    assert.equal(result.status, status);
    assert.equal(result.headers.get("set-cookie"), null);
    const controls = await loginControls(result);
    assert.equal(controls.forms, 1);
    assert.equal(controls.alerts, 1);
  }
});

test("throttled and unavailable logins retain 429 and 503 with inline recovery", async t => {
  const { app, runtime } = fixture(t);
  for (let attempt = 0; attempt < 5; attempt++) {
    const result = await app(submit({ username: "unknown", password: "long-test-password" }));
    assert.equal(result.status, 403);
  }
  const throttled = await app(submit({ username: "unknown", password: "long-test-password" }));
  assert.equal(throttled.status, 429);
  assert.equal((await loginControls(throttled)).alerts, 1);
  runtime.close();
  const unavailable = await app(submit({ username: "unknown", password: "long-test-password" }));
  assert.equal(unavailable.status, 503);
  assert.equal((await loginControls(unavailable)).alerts, 1);
});
