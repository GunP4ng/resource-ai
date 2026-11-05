import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.ts";
import type { AssessmentAdapter } from "../src/app.ts";
import type { DecisionResult } from "../src/contracts.ts";
import { createHash } from "node:crypto";
import { demo } from "../src/o-demo.ts";
const origin = "http://localhost:3000";
const held = (caseId: string, question = "확인 필요"): DecisionResult => ({ state: "needs-information", caseId, questions: [question], evidence: [] });
async function session(app: ReturnType<typeof createApp>): Promise<string> {
  const response = await app(new Request(origin));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("referrer-policy"), "same-origin");
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  return cookie;
}
function post(path: string, cookie: string, body = "{}", headers: Readonly<Record<string, string>> = {}): Request {
  return new Request(`${origin}${path}`, { method: "POST", headers: { cookie, origin, "content-type": "application/json", ...headers }, body });
}
test("adapter absent: visible input, real 503, health readiness, allowlisted demos and real snapshots", async () => {
  const app = createApp({ origin });
  const cookie = await session(app);
  const unavailable = await app(post("/cases", cookie));
  assert.equal(unavailable.status, 503);
  assert.ok((await unavailable.text()).includes("H1/H4"));
  const health = await app(new Request(`${origin}/health`));
  assert.deepEqual(await health.json(), { app: "ready", backend: "unavailable", azure: "not-verified" });
  for (const [path, content] of [["/demo/normal", "240,000 KRW"], ["/demo/held", "추가 정보 필요"], ["/demo/review", "검토 필요"], ["/reference", "허가 미확인"]]) {
    const result = await app(new Request(`${origin}${path}`));
    assert.equal(result.status, 200);
    assert.ok((await result.text()).includes(content ?? "missing"));
  }
  for (const path of ["/demo/unknown", "/demo/%2e%2e%2fetc", "/cases/unknown/report"]) assert.equal((await app(new Request(`${origin}${path}`))).status, 404);
});
test("submit, answer and printable report remain isolated across two sessions", async () => {
  let serial = 0;
  const submitted: unknown[] = [];
  const answered: unknown[] = [];
  const adapter: AssessmentAdapter = {
    submit: async (raw) => {
      submitted.push(raw);
      return held(`case-${++serial}`, `<case-${serial}>`);
    },
    answer: async (id, raw) => {
      answered.push({ id, raw });
      return { state: "needs-review", caseId: id, reasons: [`${id}-review`], evidence: [] };
    },
  };
  const app = createApp({ origin, adapter });
  const a = await session(app), b = await session(app);
  const fields = { description: "세척한 수지", assessmentDate: "2026-11-05", massKg: "2000" };
  const first = await app(post("/cases", a, new URLSearchParams(fields).toString(), { "content-type": "application/x-www-form-urlencoded" }));
  const second = await app(post("/cases", b));
  assert.deepEqual(submitted, [fields, {}]);
  const question = await app(new Request(`${origin}/cases/case-1`, { headers: { cookie: a } }));
  assert.ok((await question.text()).includes('action="/cases/case-1/answers"'));
  assert.equal(first.headers.get("location"), "/cases/case-1");
  assert.equal(second.headers.get("location"), "/cases/case-2");
  assert.equal((await app(new Request(`${origin}/cases/case-1/report`, { headers: { cookie: b } }))).status, 404);
  assert.equal((await app(post("/cases/case-1/answers", b))).status, 404);
  assert.equal((await app(post("/cases/case-1/answers", a, "answers=confirmed", { "content-type": "application/x-www-form-urlencoded" }))).status, 303);
  assert.deepEqual(answered, [{ id: "case-1", raw: { answers: "confirmed" } }]);
  const report = await app(new Request(`${origin}/cases/case-1/report`, { headers: { cookie: a } }));
  const html = await report.text();
  assert.ok(html.includes("case-1-review"));
  assert.ok(!html.includes("case-2"));
  assert.equal(report.headers.get("cache-control"), "private, no-store");
  assert.ok(report.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"));
  assert.equal((await app(new Request(`${origin}/cases/case-2`, { headers: { cookie: a } }))).status, 404);
});
test("same-origin, body size, JSON and content type checks precede adapter execution", async () => {
  let calls = 0;
  const adapter: AssessmentAdapter = { submit: async () => {
    calls++;
    return held("case-1");
  }, answer: async (id) => held(id) };
  const app = createApp({ origin, adapter, maxBodyBytes: 20 });
  const cookie = await session(app);
  for (const [request, status] of [[post("/cases", cookie, "{}", { origin: "https://foreign.invalid" }), 403], [post("/cases", cookie, "x".repeat(21)), 413], [post("/cases", cookie, "{"), 400], [post("/cases", cookie, "hello", { "content-type": "text/plain" }), 415], [post("/cases", cookie, "a=1&a=2", { "content-type": "application/x-www-form-urlencoded" }), 400]] as const) {
    assert.equal((await app(request)).status, status);
  }
  assert.equal(calls, 0);
});
test("streaming body is bounded without content-length", async () => {
  const adapter: AssessmentAdapter = { submit: async () => held("case-1"), answer: async (id) => held(id) };
  const app = createApp({ origin, adapter, maxBodyBytes: 10 });
  const cookie = await session(app);
  const stream = new ReadableStream<Uint8Array>({ start(c) {
    c.enqueue(new TextEncoder().encode("12345678901"));
    c.close();
  } });
  const request = new Request(`${origin}/cases`, { method: "POST", headers: { origin, cookie, "content-type": "application/json" }, body: stream });
  assert.equal((await app(request)).status, 413);
});
test("timeout aborts adapter and cannot be rendered as a domain decision", async () => {
  let signal: AbortSignal | undefined;
  const adapter: AssessmentAdapter = { submit: async (_, s) => {
    signal = s;
    return new Promise(() => {
    });
  }, answer: async (id) => held(id) };
  const app = createApp({ origin, adapter, timeoutMs: 20 });
  const cookie = await session(app);
  const result = await app(post("/cases", cookie));
  assert.equal(result.status, 504);
  assert.equal(signal?.aborted, true);
  const html = await result.text();
  assert.ok(!html.includes("조건부 비교"));
});
test("request cancellation reaches adapter and returns execution failure", async () => {
  let begin = () => {
  };
  const started = new Promise<void>((resolve) => {
    begin = resolve;
  });
  let adapterSignal: AbortSignal | undefined;
  const adapter: AssessmentAdapter = { submit: async (_, s) => {
    adapterSignal = s;
    begin();
    return new Promise(() => {
    });
  }, answer: async (id) => held(id) };
  const app = createApp({ origin, adapter });
  const cookie = await session(app), controller = new AbortController();
  const req = new Request(post("/cases", cookie), { signal: controller.signal });
  const pending = app(req);
  await started;
  controller.abort();
  const result = await pending;
  assert.equal(result.status, 408);
  assert.equal(adapterSignal?.aborted, true);
});
test("authentication/provider errors and invalid result dates never expose raw messages", async () => {
  for (const adapter of [
    { submit: async () => {
    throw new Error("401 secret-provider-key");
  }, answer: async (id: string) => held(id) },
    { submit: async () => ({ state: "needs-review", caseId: "case-1", reasons: ["review"], evidence: [{ sourceId: "x", title: "x", publisher: "x", url: "https://example.org", locator: "x", retrievedAt: "2026-02-30T00:00:00Z", effectiveFrom: null, effectiveTo: null, datasetVersion: "x", sha256: "x", license: null, licenseVerified: false }] } as const), answer: async (id: string) => held(id) },
  ] satisfies readonly AssessmentAdapter[]) {
    const app = createApp({ origin, adapter });
    const cookie = await session(app);
    const result = await app(post("/cases", cookie));
    assert.equal(result.status, 502);
    assert.ok(!(await result.text()).includes("secret-provider-key"));
  }
});
test("adapter cannot switch the case identity on answer or reuse another session's identity", async () => {
  const app = createApp({ origin, adapter: { submit: async () => held("same-case"), answer: async () => held("other-case") } });
  const a = await session(app), b = await session(app);
  assert.equal((await app(post("/cases", a))).status, 303);
  assert.equal((await app(post("/cases", b))).status, 502);
  assert.equal((await app(post("/cases/same-case/answers", a))).status, 502);
});
test("expired session loses access to reports", async () => {
  let now = 100;
  const app = createApp({ origin, now: () => now, adapter: { submit: async () => held("case-1"), answer: async (id) => held(id) } });
  const cookie = await session(app);
  assert.equal((await app(post("/cases", cookie))).status, 303);
  now += 3600001;
  assert.equal((await app(new Request(`${origin}/cases/case-1/report`, { headers: { cookie } }))).status, 404);
});
test("synthetic evidence links serve the exact snapshot bytes used by deterministic functions", async () => {
  const app = createApp({ origin }), generated = await demo("normal", origin);
  assert.ok(generated);
  const source = generated.result.evidence[0];
  assert.ok(source);
  const response = await app(new Request(source.url));
  assert.equal(response.status, 200);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.equal(createHash("sha256").update(bytes).digest("hex"), source.sha256);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
});

test("foreign, literal null, missing Origin and cross-site requests are rejected before adapter work", async () => {
  let calls = 0;
  const app = createApp({ origin, adapter: {
    submit: async () => {
    calls++;
    return held("blocked");
  },
    answer: async (id) => {
    calls++;
    return held(id);
  },
  } });
  const cookie = await session(app);
  for (const value of ["https://foreign.invalid", "null", undefined]) {
    const headers = new Headers({ cookie, "content-type": "application/x-www-form-urlencoded" });
    if (value !== undefined) headers.set("origin", value);
    const response = await app(new Request(`${origin}/cases`, { method: "POST", headers, body: "description=test" }));
    assert.equal(response.status, 403);
  }
  assert.equal((await app(post("/cases", cookie, "{}", { "sec-fetch-site": "cross-site" }))).status, 403);
  assert.equal(calls, 0);
});
test("case-owned execution metadata survives storage, answer updates and report rendering", async () => {
  let serial = 0;
  const app = createApp({ origin, adapter: {
    submit: async () => {
      const id = ++serial;
      return { decision: held(`meta-${id}`), execution: { traceId: `trace-${id}`, usage: `tokens-${id * 10}` } };
    },
    answer: async (id) => ({ decision: held(id), execution: { traceId: "answer-trace" } }),
  } });
  const cookie = await session(app);
  assert.equal((await app(post("/cases", cookie))).status, 303);
  assert.equal((await app(post("/cases", cookie))).status, 303);
  async function report(id: number): Promise<string> {
    const response = await app(new Request(`${origin}/cases/meta-${id}/report`, { headers: { cookie } }));
    assert.equal(response.status, 200);
    return response.text();
  }
  const first = await report(1);
  const second = await report(2);
  assert.ok(first.includes("trace-1 · 사용량 tokens-10"));
  assert.ok(!first.includes("trace-2"));
  assert.ok(second.includes("trace-2 · 사용량 tokens-20"));
  assert.ok(!second.includes("trace-1"));
  assert.equal((await app(post("/cases/meta-1/answers", cookie))).status, 303);
  const updated = await report(1);
  assert.ok(updated.includes("answer-trace · 사용량 미제공"));
  assert.ok(!updated.includes("tokens-10"));
  assert.ok((await report(2)).includes("trace-2 · 사용량 tokens-20"));
});
test("invalid execution envelopes fail closed without storing or exposing metadata", async () => {
  const invalid: readonly unknown[] = [
    { traceId: "" }, { traceId: "x".repeat(201) }, { traceId: 1 },
    { traceId: "secret-trace", usage: 12 }, { traceId: "x", usage: "" },
    { traceId: "x", usage: "x".repeat(2001) }, { traceId: "x", extra: "secret-extra" },
    null, [],
  ];
  for (const execution of invalid) {
    // Deliberately malformed provider output crosses the application's runtime boundary.
    const adapter = { submit: async () => ({ decision: held("invalid-meta"), execution }), answer: async (id: string) => held(id) } as AssessmentAdapter;
    const app = createApp({ origin, adapter });
    const cookie = await session(app);
    const response = await app(post("/cases", cookie));
    assert.equal(response.status, 502);
    assert.ok(!(await response.text()).includes("secret-"));
    assert.equal((await app(new Request(`${origin}/cases/invalid-meta`, { headers: { cookie } }))).status, 404);
  }
});
