import assert from "node:assert/strict";
import { openRuntimeDatabase } from "../src/o-runtime-db.ts";
import { createLocalAuth, LOCAL_AUTH_LIMITS } from "../src/o-auth.ts";
import { createOperationalApp } from "../src/operations.ts";

const [stage, root] = process.argv.slice(2);
assert.ok(root);
const origin = "http://localhost:3000", password = "clock-proof synthetic password";
const db = await openRuntimeDatabase(root);
const auth = createLocalAuth(db, { origin });
try {
  if (stage === "seed-rollback" || stage === "seed") {
    // Auth has already anchored above. Reproduce the parent retaining its epoch
    // while grant/case wall time and a subsequently started child move backwards.
    if (stage === "seed-rollback") {
      const wall = Date.now;
      Date.now = () => wall() - 60_000;
    }
    await auth.create("operator", password);
    await auth.login("operator", password, new AbortController().signal);
    const window = db.database.query<{ window_start: number }, []>("SELECT window_start FROM login_limits WHERE key='global'").get();
    assert.ok(window);
    console.log(JSON.stringify({ wall: Date.now(), window: window.window_start }));
  } else {
    assert.equal(stage, "login");
    db.assertReady();
    const before = db.database.query<{ window_start: number; attempts: number }, []>("SELECT window_start,attempts FROM login_limits WHERE key='global'").get();
    const app = createOperationalApp({ origin, localAuth: auth });
    try {
      const start = performance.now(), wall = Date.now();
      const signed = await app.fetch(new Request(origin + "/login", { method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ username: "operator", password }) }));
      let assertions = 0, created: number | null = null;
      const cookie = signed.headers.get("set-cookie")?.split(";")[0];
      if (cookie) {
        const identity = auth.resolve(new Request(origin, { headers: { cookie } }), new AbortController().signal);
        assert.ok(identity);
        identity.assertCurrent(); assertions++;
        const elapsed = performance.now();
        await new Promise<void>(done => setTimeout(done, 20));
        assert.ok(performance.now() - elapsed >= 15);
        identity.assertCurrent(); assertions++;
        // The child's own default auth epoch also survives an in-process rollback.
        const currentWall = Date.now;
        Date.now = () => currentWall() - 2000;
        try { identity.assertCurrent(); assertions++; }
        finally { Date.now = currentWall; }
        created = identity.validUntil - LOCAL_AUTH_LIMITS.sessionMs;
      }
      const after = db.database.query<{ window_start: number; attempts: number }, []>("SELECT window_start,attempts FROM login_limits WHERE key='global'").get();
      console.log(JSON.stringify({ status: signed.status, wall, finished: Date.now(), elapsedMs: performance.now() - start, before, after, created, assertions }));
    } finally { app.dispose(); await app.close(); }
  }
} finally { db.close(); }
