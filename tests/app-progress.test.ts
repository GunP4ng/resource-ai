import assert from "node:assert/strict";
import { test } from "node:test";
import { createSyntheticResourceApp } from "./synthetic-runtime.ts";

test("review progress follows the server work and is visible only to the submitting session", async () => {
  const origin = "http://localhost:3000";
  const token = "ab".repeat(16);
  const resourceStarted = Promise.withResolvers<void>();
  const allowResources = Promise.withResolvers<void>();
  const app = createSyntheticResourceApp({
    origin,
    async resources() {
      resourceStarted.resolve();
      await allowResources.promise;
      return {};
    },
  });
  try {
    async function cookie() {
      const home = await app.fetch(new Request(origin));
      const session = home.headers.get("set-cookie")?.split(";")[0];
      assert.ok(session);
      return session;
    }
    async function current(session: string) {
      const response = await app.fetch(new Request(`${origin}/cases/progress/${token}`, { headers: { cookie: session } }));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      return response.json();
    }
    const owner = await cookie(), other = await cookie();
    const submission = app.fetch(new Request(`${origin}/cases?progress=${token}`, {
      method: "POST", headers: { origin, cookie: owner },
      body: new URLSearchParams({ description: "PP 사출 부품", process: "사출", polymer: "PP", contamination: "없음",
        hazardousContact: "no", massKg: "100", region: "울산", assessmentDate: "2026-11-22" }),
    }));
    await Promise.race([resourceStarted.promise, submission.then(r => assert.fail(`review did not start: ${r.status}`))]);
    assert.deepEqual(await current(owner), { step: "evidence" });
    assert.deepEqual(await current(other), { step: null });
    allowResources.resolve();
    const result = await submission;
    assert.equal(result.status, 303);
    assert.match(result.headers.get("location") ?? "", /^\/cases\/[^/?]+$/);
    assert.deepEqual(await current(owner), { step: null });
  } finally {
    allowResources.resolve();
    app.dispose();
  }
});
