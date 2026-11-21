import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.ts";
import { inputPage } from "../src/app-views.ts";
import { createCaseStore } from "../src/o-case-store.ts";
import type { AssessmentAdapter } from "../src/app.ts";
import type { DecisionResult } from "../src/contracts.ts";
import { createHash } from "node:crypto";
import { demo } from "../src/o-demo.ts";
import { createAssessmentAdapter, createResourceApp, SessionFailure } from "../src/session.ts";
import type { SessionFailureCode } from "../src/session.ts";
import type { DomainResources } from "../src/domain.ts";
import { syntheticCase, syntheticReviewed } from "./h-fixtures.ts";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const origin = "http://localhost:3000";
const held = (caseId: string, question = "확인 필요"): DecisionResult => ({ state: "needs-information", caseId, questions: [question], evidence: [] });
async function session(app: (request: Request) => Promise<Response>): Promise<string> {
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
for (const localAuth of [true, false]) for (const [runner, label] of [
  ["subscription", "구독 경로 모델 실행"], ["azure", "Azure 연결"], ["local", "로컬"], ["unspecified", "미지정"],
] as const) test(`input page ${localAuth ? "local operator" : "session"} shows configured ${runner} without claiming successful execution`, () => {
  const html = inputPage({ authenticated: true, localAuth, connected: true, photoEnabled: false, runner });
  assert.ok(html.includes(`${localAuth ? "검토 방식" : "구성된 실행기"} ${label} · 실행 성공은 평가 후 확인`), `configured ${runner} label and pending success`);
  assert.doesNotMatch(html, /SiWC|인증 성공|실행 성공 확인됨/);
  assert.match(html, /<form method="post" action="\/cases">/);
  assert.equal(html.includes("로그인한 담당자 · 사례 보관 최대 1시간"), localAuth);
  assert.doesNotMatch(html, /SQLite/);
});
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
  const before = await ownedPage(app, a, "/cases/same-case/report");
  assert.equal((await app(post("/cases", b))).status, 502);
  assert.equal((await app(post("/cases/same-case/answers", a))).status, 502);
  assert.equal(await ownedPage(app, a, "/cases/same-case/report"), before);
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
  let answerMode: "metadata" | "invalid" | "omitted" = "metadata";
  const app = createApp({ origin, adapter: {
    submit: async () => {
      const id = ++serial;
      return { decision: held(`meta-${id}`), execution: { traceId: `trace-${id}`, usage: `tokens-${id * 10}` } };
    },
    answer: async (id) => {
      switch (answerMode) {
        case "omitted": return held(id);
        case "invalid": return { decision: held(id, "invalid-replacement"), execution: { traceId: "" } };
        case "metadata": return { decision: held(id), execution: { traceId: "answer-trace" } };
      }
    },
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
  answerMode = "invalid";
  assert.equal((await app(post("/cases/meta-1/answers", cookie))).status, 502);
  assert.equal(await report(1), updated);
  answerMode = "omitted";
  assert.equal((await app(post("/cases/meta-1/answers", cookie))).status, 303);
  assert.doesNotMatch(await report(1), /answer-trace|tokens-10|invalid-replacement/);
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

const nativeFields = { description: "O4 합성 HTTP 시험", photoRefs: "", process: "사출", polymer: "", contamination: "없음", hazardousContact: "no", massKg: "", region: "울산", assessmentDate: "2026-11-05" };
const formHeaders = { "content-type": "application/x-www-form-urlencoded" };
async function submitNative(app: (request: Request) => Promise<Response>, cookie: string, fields = nativeFields): Promise<string> {
  const result = await app(post("/cases", cookie, new URLSearchParams(fields).toString(), formHeaders));
  assert.equal(result.status, 303);
  const path = result.headers.get("location");
  assert.ok(path);
  return path;
}
async function ownedPage(app: (request: Request) => Promise<Response>, cookie: string, path: string): Promise<string> {
  const result = await app(new Request(origin + path, { headers: { cookie } }));
  assert.equal(result.status, 200);
  return result.text();
}

test("native case POST and versioned edit round-trip 1,900 Korean syllables", async () => {
  const app = createResourceApp({ origin });
  try {
    const cookie = await session(app.fetch);
    const description = "가".repeat(1900);
    const path = await submitNative(app.fetch, cookie, { ...nativeFields, description });
    assert.equal(JSON.parse(await ownedPage(app.fetch, cookie, path + "/input")).description, description);
    const edited = "나".repeat(1900);
    const answer = new URLSearchParams({ baseVersion: "1", answerMode: "fields", field_description: edited });
    assert.equal((await app.fetch(post(path + "/answers", cookie, answer.toString(), formHeaders))).status, 303);
    assert.equal(JSON.parse(await ownedPage(app.fetch, cookie, path + "/input")).description, edited);
  } finally { app.dispose(); }
});

test("native case POST and edit fit the combined decoded text maxima", async () => {
  const app = createResourceApp({ origin });
  try {
    const cookie = await session(app.fetch);
    const short = "한".repeat(500);
    const description = "가".repeat(9998) + "\r\n한";
    const textFields = { description, process: short, polymer: short, contamination: short, region: short };
    const path = await submitNative(app.fetch, cookie, { ...nativeFields, ...textFields });
    assert.equal(JSON.parse(await ownedPage(app.fetch, cookie, path + "/input")).description, description);
    const edit = new URLSearchParams({ baseVersion: "1", answerMode: "fields", photoSelection: "explicit" });
    textFields.description = "나" + description.slice(1);
    for (const [name, value] of Object.entries(textFields)) edit.set("field_" + name, value);
    assert.equal((await app.fetch(post(path + "/answers", cookie, edit.toString(), formHeaders))).status, 303);
    const saved = JSON.parse(await ownedPage(app.fetch, cookie, path + "/input"));
    assert.deepEqual({ description: saved.description, process: saved.process, polymer: saved.polymer,
      contamination: saved.contamination, region: saved.region }, textFields);
  } finally { app.dispose(); }
});

test("decoded native text caps reject oversize inputs before evaluation and preserve the saved version", async () => {
  let evaluations = 0;
  const app = createResourceApp({ origin, runner: async () => { evaluations++; return {}; } });
  try {
    const cookie = await session(app.fetch), path = await submitNative(app.fetch, cookie);
    const before = await ownedPage(app.fetch, cookie, path + "/input");
    const beforeCount = evaluations;
    for (const [name, value] of Object.entries({
      description: "가".repeat(9999) + "\r\n한", process: "😀".repeat(249) + "\r\na",
      polymer: "a".repeat(501), contamination: "a".repeat(501), region: "a".repeat(501),
    })) {
      const create = new URLSearchParams({ ...nativeFields, [name]: value });
      assert.equal((await app.fetch(post("/cases", cookie, create.toString(), formHeaders))).status, 400, name);
      const edit = new URLSearchParams({ baseVersion: "1", answerMode: "fields", ["field_" + name]: value });
      assert.equal((await app.fetch(post(path + "/answers", cookie, edit.toString(), formHeaders))).status, 400, name);
    }
    const answers = '{"massKg":100}'.padEnd(9999) + "\r\n";
    for (const photoSelection of ["", "explicit"]) {
      const edit = new URLSearchParams({ baseVersion: "1", answers: answers + " " });
      if (photoSelection) edit.set("photoSelection", photoSelection);
      assert.equal((await app.fetch(post(path + "/answers", cookie, edit.toString(), formHeaders))).status, 400);
    }
    assert.equal(evaluations, beforeCount);
    assert.equal(await ownedPage(app.fetch, cookie, path + "/input"), before);
    assert.match(await ownedPage(app.fetch, cookie, path), /name="baseVersion" value="1"/);
    const edit = new URLSearchParams({ baseVersion: "1", answers });
    assert.equal((await app.fetch(post(path + "/answers", cookie, edit.toString(), formHeaders))).status, 303);
  } finally { app.dispose(); }
});

test("case wire allowance is bounded for declared and streamed forms and JSON keeps its default", async () => {
  const app = createResourceApp({ origin });
  try {
    const cookie = await session(app.fetch), path = await submitNative(app.fetch, cookie);
    for (const [target, params] of [
      ["/cases", new URLSearchParams({ ...nativeFields, massKg: "" })],
      [path + "/answers", new URLSearchParams({ baseVersion: "1", answerMode: "fields", field_massKg: "1" })],
    ] as const) {
      const mass = target === "/cases" ? "massKg" : "field_massKg";
      params.set(mass, "");
      params.set(mass, "0".repeat(109024 - params.toString().length) + "1");
      const wire = params.toString();
      assert.equal(Buffer.byteLength(wire), 109025);
      const declared = post(target, cookie, wire, { ...formHeaders, "content-length": "109025" });
      assert.equal((await app.fetch(declared)).status, 413);
      const bytes = new TextEncoder().encode(wire);
      const streamed = new Request(origin + target, { method: "POST", headers: { ...formHeaders, origin, cookie },
        body: new ReadableStream({ start(controller) {
          controller.enqueue(bytes.subarray(0, 109024));
          controller.enqueue(bytes.subarray(109024));
          controller.close();
        } }) });
      assert.equal(streamed.headers.get("content-length"), null);
      assert.equal((await app.fetch(streamed)).status, 413);
      assert.equal((await app.fetch(post(target, cookie, "{}".padEnd(16385)))).status, 413);
    }
    assert.match(await ownedPage(app.fetch, cookie, path), /name="baseVersion" value="1"/);
    const edit = new URLSearchParams({ baseVersion: "1", answerMode: "fields", field_massKg: "" });
    edit.set("field_massKg", "0".repeat(109023 - edit.toString().length) + "1");
    assert.equal(Buffer.byteLength(edit.toString()), 109024);
    assert.equal((await app.fetch(post(path + "/answers", cookie, edit.toString(), formHeaders))).status, 303);
  } finally { app.dispose(); }
});

test("configured case form body cap is authoritative on create and edit", async () => {
  const preparer = createAssessmentAdapter();
  const app = createApp({ origin, preparer, maxBodyBytes: 512 });
  try {
    const cookie = await session(app), path = await submitNative(app, cookie);
    assert.equal((await app(post("/cases", cookie, new URLSearchParams({
      ...nativeFields, description: "가".repeat(100),
    }).toString(), formHeaders))).status, 413);
    const edit = new URLSearchParams({ baseVersion: "1", answerMode: "fields", field_description: "나".repeat(100) });
    assert.equal((await app(post(path + "/answers", cookie, edit.toString(), formHeaders))).status, 413);
    assert.match(await ownedPage(app, cookie, path), /name="baseVersion" value="1"/);
  } finally { app.dispose(); await app.settled(); preparer.dispose(); }
});

test("O4 native corrections refresh missing questions and remain usable after review", async () => {
  const app = createResourceApp({ origin });
  try {
    const cookie = await session(app.fetch), path = await submitNative(app.fetch, cookie);
    const before = await ownedPage(app.fetch, cookie, path);
    assert.match(before, /수지/);
    const visibleQuestions: string[] = [], hiddenQuestions: string[] = [];
    const answerLinks: (string | null)[] = [], hiddenAnswerLinks: (string | null)[] = [];
    await new HTMLRewriter()
      .on("main > #case-reasons li", { text(chunk) { visibleQuestions.push(chunk.text); } })
      .on("details #case-reasons li", { text(chunk) { hiddenQuestions.push(chunk.text); } })
      .on('main > p > a.primary-action:not(.secondary-action)[href="#answer-fields"]', { element(element) { answerLinks.push(element.getAttribute("href")); } })
      .on('details a[href="#answer-fields"]', { element(element) { hiddenAnswerLinks.push(element.getAttribute("href")); } })
      .transform(new Response(before)).text();
    assert.match(visibleQuestions.join(""), /재질·품목/);
    assert.deepEqual(hiddenQuestions, []);
    assert.deepEqual(answerLinks, ["#answer-fields"]);
    assert.deepEqual(hiddenAnswerLinks, []);
    assert.match(before, /추가 정보 필요 · 실행 보류/);
    assert.doesNotMatch(before, /확인된 질량은 몇 kg인가요/);
    assert.match(before, /<textarea[^>]*name="answers"[^>]*><\/textarea>/);
    const polymer = await app.fetch(post(path + "/answers", cookie, new URLSearchParams({ answers: '{"polymer":"PP"}' }).toString(), formHeaders));
    assert.equal(polymer.headers.get("location"), path);
    const middle = await ownedPage(app.fetch, cookie, path);
    assert.doesNotMatch(middle, /수지 종류/);
    assert.match(middle, /기계적 재활용 추천/);
    assert.match(middle, /질량을 입력하면 비용·탄소를 계산해요/);
    assert.equal((await app.fetch(post(path + "/answers", cookie, '{"massKg":100}'))).status, 303);
    const reviewed = await ownedPage(app.fetch, cookie, path);
    assert.match(reviewed, /공개 근거상 가능\(조건부\)/);
    assert.doesNotMatch(reviewed, /확인된 질량은 몇 kg인가요/);
    assert.match(reviewed, new RegExp(`action="${path}/answers"`));
    assert.doesNotMatch(await ownedPage(app.fetch, cookie, path + "/report"), /<form\b/);
    assert.doesNotMatch(reviewed, /추적 |humanApproval: approved/);
  } finally { app.dispose(); }
});

test("optional mass answer updates the same recommended case with supported cost and carbon", async () => {
  const app = createResourceApp({ origin, resources: async input => syntheticReviewed(input) });
  try {
    const cookie = await session(app.fetch);
    const path = await submitNative(app.fetch, cookie, { ...nativeFields, polymer: "PP", massKg: "" });
    const before = await ownedPage(app.fetch, cookie, path);
    assert.match(before, /기계적 재활용 추천/);
    assert.match(before, /질량을 입력하면 비용·탄소를 계산해요/);
    const massLinks: string[] = [], hiddenMassLinks: string[] = [], order: string[] = [];
    await new HTMLRewriter()
      .on('main > p > a[href="#answer-fields"]', { text(chunk) { massLinks.push(chunk.text); } })
      .on('details a[href="#answer-fields"]', { text(chunk) { hiddenMassLinks.push(chunk.text); } })
      .on('#next-action, a[href="#answer-fields"], #result-context', {
        element(element) { order.push(element.getAttribute("id") ?? "mass-link"); },
      }).transform(new Response(before)).text();
    assert.match(massLinks.join(""), /질량을 입력하면 비용·탄소를 계산해요/);
    assert.deepEqual(hiddenMassLinks, []);
    assert.deepEqual(order, ["next-action", "mass-link", "result-context"]);
    assert.match(before, /질량을 몰라 비용을 계산하지 않았어요/);
    assert.doesNotMatch(before, /240,000 KRW|45 kgCO2e/);
    const answer = new URLSearchParams({
      answerMode: "fields", baseVersion: "1", photoSelection: "explicit",
      field_description: nativeFields.description, field_process: "사출", field_polymer: "PP",
      field_contamination: "없음", field_hazardousContact: "no", field_massKg: "2000",
      field_region: "울산", field_assessmentDate: "2026-11-05",
    });
    const response = await app.fetch(post(path + "/answers", cookie, answer.toString(), formHeaders));
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), path);
    const after = await ownedPage(app.fetch, cookie, path);
    assert.match(after, /240,000 KRW/);
    assert.match(after, /45 kgCO2e/);
    assert.match(after, /name="baseVersion" value="2"/);
    assert.doesNotMatch(after, /질량을 입력하면 비용·탄소를 계산해요/);
  } finally { app.dispose(); await app.close(); }
});

test("O4 corrections permit current-law recommendations beyond the collection verification date", async () => {
  const app = createResourceApp({ origin });
  try {
    const cookie = await session(app.fetch);
    const path = await submitNative(app.fetch, cookie, { ...nativeFields, polymer: "PP", assessmentDate: "2026-11-16" });
    assert.match(await ownedPage(app.fetch, cookie, path), /<form\b/);
    assert.equal((await app.fetch(post(path + "/answers", cookie, '{"massKg":100}'))).status, 303);
    const html = await ownedPage(app.fetch, cookie, path);
    assert.match(html, /공개 근거상 가능\(조건부\)/);
    assert.match(html, /<form\b/);
  } finally { app.dispose(); }
});

test("O4 invalid field corrections return safe 400s, preserve the report and allow recovery", async () => {
  const cases = createCaseStore(), app = createResourceApp({ origin, caseStore: cases });
  try {
    const cookie = await session(app.fetch), path = await submitNative(app.fetch, cookie);
    const owner = `session:${cookie.slice("resource_session=".length)}`, id = path.slice("/cases/".length);
    const snapshot = cases.read(owner, id); assert.ok(snapshot);
    const before = await ownedPage(app.fetch, cookie, path + "/report");
    for (const patch of [{ massKg: -1 }, { answers: "private-secret<script>" }, { answers: "{" }, {}, [], { massKg: "100" }, { massKg: 0 }, { assessmentDate: "2026-02-30" }, { caseId: "forged" }, { humanApproval: "approved" }]) {
      const response = await app.fetch(post(path + "/answers", cookie, JSON.stringify(patch)));
      assert.equal(response.status, 400, JSON.stringify(patch));
      const html = await response.text();
      assert.match(html, /role="alert"/);
      assert.match(html, /JSON/);
      assert.doesNotMatch(html, /private-secret|<script>|SessionFailure|AssessmentInputError/);
      assert.equal(await ownedPage(app.fetch, cookie, path + "/report"), before);
      const persisted = cases.read(owner, id); assert.ok(persisted);
      assert.equal(persisted.version, snapshot.version);
      assert.deepEqual(persisted.assessment, snapshot.assessment);
      const destinations = [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map(match => match[1]);
      assert.ok(destinations.includes(path), `Missing recovery link to ${path}`);
      assert.ok(destinations.includes("/cases"), "Missing owned-case list recovery link");
    }
    assert.equal((await app.fetch(post(path + "/answers", cookie, '{"polymer":"PP","massKg":100}'))).status, 303);
    assert.match(await ownedPage(app.fetch, cookie, path), /공개 근거상 가능\(조건부\)/);
    const forged = await app.fetch(post("/cases", cookie, JSON.stringify({ ...syntheticCase })));
    assert.equal(forged.status, 400);
  } finally { app.dispose(); await app.close(); cases.dispose(); }
});

for (const [code, status] of Object.entries({ "case-not-found": 404, "case-busy": 409, cancelled: 408, timeout: 504, capacity: 429, "rate-limit": 429, "not-configured": 503, authentication: 502, provider: 502, "invalid-model-output": 502, "turn-limit": 502 } satisfies Record<SessionFailureCode, number>)) {
  test(`O4 session failure ${code} maps to ${status} without leaking upstream details`, async () => {
    const app = createApp({ origin, adapter: { submit: async () => { throw Object.assign(new Error("private-secret"), { name: "SessionFailure", code }); }, answer: async (id) => held(id) } });
    const response = await app(post("/cases", await session(app)));
    assert.equal(response.status, status);
    const html = await response.text();
    assert.match(html, /role="alert"/);
    assert.doesNotMatch(html, /private-secret|SessionFailure/);
    if (code === "case-not-found") assert.match(html, /href="\/"/);
  });
}

test("O4 unknown or non-Error session failure shapes remain generic 502s", async () => {
  for (const error of [{ name: "SessionFailure", code: "capacity" }, Object.assign(new Error("private-secret"), { name: "SessionFailure", code: "unknown" }), Object.assign(new Error("private-secret"), { code: "capacity" })]) {
    const app = createApp({ origin, adapter: { submit: async () => { throw error; }, answer: async (id) => held(id) } });
    const response = await app(post("/cases", await session(app)));
    assert.equal(response.status, 502);
    assert.doesNotMatch(await response.text(), /private-secret|capacity|unknown/);
  }
});

test("O4 expired H cases return restart guidance while the owned report survives", async () => {
  let now = 0;
  const adapter = createAssessmentAdapter({ now: () => now });
  const app = createApp({ origin, adapter: { submit: adapter.submitForm, answer: adapter.answer } });
  try {
    const cookie = await session(app), path = await submitNative(app, cookie);
    const before = await ownedPage(app, cookie, path + "/report");
    now = 1_800_000;
    const response = await app(post(path + "/answers", cookie, '{"massKg":100}'));
    assert.equal(response.status, 404);
    assert.match(await response.text(), /href="\/"/);
    assert.equal(await ownedPage(app, cookie, path + "/report"), before);
  } finally { adapter.dispose(); }
});

test("committed case editing controls expire while report and input remain accessible", async () => {
  let now = 0;
  const adapter = createAssessmentAdapter();
  const app = createApp({ origin, now: () => now, preparer: adapter, actorForRequest: async () => "expiry-owner" });
  const action = (html: string) => html.match(/<p id="next-action">([\s\S]*?)<\/p>/)?.[1] ?? "";
  const assertReadOnly = (html: string) => {
    assert.match(action(html), /아래 보류 사유에서 누락된 정보를 확인하고 필요한 자료를 준비하세요\./);
    assert.doesNotMatch(action(html), /답변란/);
    assert.match(html, /<a class="primary-action" href="#checks"/);
    assert.match(html, /id="checks"/);
    assert.doesNotMatch(html, /action="[^"]+\/answers"|href="#answer-fields"/);
  };
  try {
    const cookie = await session(app), path = await submitNative(app, cookie);
    const before = await ownedPage(app, cookie, path + "/report");
    now = 1_799_999;
    const editable = await ownedPage(app, cookie, path);
    assert.match(action(editable), /누락된 사례 정보를 확인해 답변란에 입력하세요\./);
    assert.match(editable, /<a class="primary-action" href="#answer-fields"/);
    assert.match(editable, /id="answer-fields"[\s\S]*?<form method="post" action="[^"]+\/answers"/);
    assertReadOnly(before);
    assertReadOnly(await ownedPage(app, cookie, path + "/report?purpose=research"));
    for (const time of [1_800_000, 1_800_001]) {
      now = time;
      const html = await ownedPage(app, cookie, path);
      assert.match(html, /<a href="\/">새 사례를 입력하세요<\/a>/);
      assertReadOnly(html);
      assert.equal(await ownedPage(app, cookie, path + "/report"), before);
      assert.equal((await app(new Request(origin + path + "/input", { headers: { cookie } }))).status, 200);
      assert.equal((await app(post(path + "/answers", cookie, '{"massKg":100}'))).status, 404);
    }
  } finally { app.dispose(); await app.settled(); adapter.dispose(); }
});

test("O4 composed app rejects overlapping answers and disposal aborts active work", async () => {
  let block = false, entered = () => {}, aborted = false;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const app = createResourceApp({ origin, runner: async (_input, signal) => {
    if (!block) return {};
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => { aborted = true; reject(new SessionFailure("cancelled")); }, { once: true });
      entered();
    });
  } });
  try {
    const cookie = await session(app.fetch), path = await submitNative(app.fetch, cookie);
    const before = await ownedPage(app.fetch, cookie, path + "/report");
    block = true;
    const pending = app.fetch(post(path + "/answers", cookie, '{"massKg":100}'));
    await started;
    assert.equal((await app.fetch(post(path + "/answers", cookie, '{"massKg":200}'))).status, 409);
    app.dispose();
    assert.equal((await pending).status, 408);
    assert.equal(aborted, true);
    assert.equal(await ownedPage(app.fetch, cookie, path + "/report"), before);
  } finally { app.dispose(); }
});

test("O4 real H timeout returns 504 without replacing the previous assessment", async () => {
  let block = false, aborted = false;
  const adapter = createAssessmentAdapter({ timeoutMs: 10, runner: async (_input, signal) => {
    if (!block) return {};
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => {
      aborted = true;
      reject(new Error("private-provider-secret"));
    }, { once: true }));
  } });
  const app = createApp({ origin, adapter: { submit: adapter.submitForm, answer: adapter.answer }, timeoutMs: 2000 });
  try {
    const cookie = await session(app), path = await submitNative(app, cookie);
    const before = await ownedPage(app, cookie, path + "/report");
    block = true;
    const response = await app(post(path + "/answers", cookie, '{"massKg":100}'));
    assert.equal(response.status, 504);
    assert.equal(aborted, true);
    assert.doesNotMatch(await response.text(), /private-provider-secret/);
    assert.equal(await ownedPage(app, cookie, path + "/report"), before);
  } finally { adapter.dispose(); }
});

test("O4 reviewed comparison allows corrections and rejects cached supplements after mass or date changes", async () => {
  for (const patch of [{ massKg: 1000 }, { assessmentDate: "2026-11-06" }]) {
    let cached: DomainResources | undefined;
    const app = createResourceApp({ origin, resources: (input) => cached ??= syntheticReviewed(input) });
    try {
      const cookie = await session(app.fetch);
      const path = await submitNative(app.fetch, cookie, { ...nativeFields, polymer: "PP", massKg: "2000" });
      const html = await ownedPage(app.fetch, cookie, path);
      assert.match(html, /현장 담당자 승인 대기/);
      assert.doesNotMatch(html, /humanApproval:/);
      assert.match(html, /<form\b/);
      assert.match(html, /기준선/);
      assert.doesNotMatch(await ownedPage(app.fetch, cookie, path + "/report"), /<form\b/);
      assert.equal((await app.fetch(post(path + "/answers", cookie, JSON.stringify(patch)))).status, 303);
      const updated = await ownedPage(app.fetch, cookie, path);
      assert.match(updated, /<h1>검토 필요<\/h1>/);
      assert.doesNotMatch(updated, /<h1>조건부 비교<\/h1>/);
    } finally { app.dispose(); }
  }
});

test("O4 source and packaged launchers reduce missing questions before review and exit cleanly", { timeout: 120000 }, async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  await rm(resolve(root, "dist/data"), { recursive: true, force: true });
  await promisify(execFile)(process.execPath, ["run", "build:app"], { cwd: root, timeout: 20000 });
  for (const launcher of ["scripts/app.ts", "dist/app/app.js"]) {
    const reservation = createServer();
    await new Promise<void>((resolve, reject) => {
      reservation.once("error", reject);
      reservation.listen(0, "127.0.0.1", resolve);
    });
    const address = reservation.address();
    assert.ok(address && typeof address !== "string");
    const port = address.port;
    await new Promise<void>((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));
    const directory = await mkdtemp(join(tmpdir(), "o4-launcher-"));
    const child = spawn(process.execPath, [resolve(root, launcher)], { cwd: directory, env: { ...process.env, PORT: String(port), RESOURCE_MODEL_RUNNER: "local" }, stdio: ["ignore", "pipe", "pipe"] });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    let stdout = "", stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([new Promise<void>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error("launcher readiness timeout")), 10000);
        child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); if (stdout.includes("Re:Source app:")) resolve(); });
      }), exited.then(() => { throw new Error(`launcher exited before readiness: ${stderr}`); })]);
      clearTimeout(timer);
      const url = `http://localhost:${port}`;
      const reference = await fetch(url + "/reference", { signal: AbortSignal.timeout(2000) });
      assert.equal(reference.status, 200, `${launcher}: reference assets resolve outside repository cwd`);
      const referenceHtml = await reference.text();
      assert.match(referenceHtml, /136개 정규화 가격/);
      assert.match(referenceHtml, /31곳 등재/);
      const home = await fetch(url, { signal: AbortSignal.timeout(2000) });
      const cookie = home.headers.get("set-cookie")?.split(";")[0];
      assert.ok(cookie);
      const submitted = await fetch(url + "/cases", { method: "POST", redirect: "manual", headers: { ...formHeaders, cookie, origin: url }, body: new URLSearchParams(nativeFields), signal: AbortSignal.timeout(2000) });
      assert.equal(submitted.status, 303);
      const path = submitted.headers.get("location");
      assert.ok(path);
      const caseId = path.slice("/cases/".length);
      const page = await fetch(url + path, { headers: { cookie }, signal: AbortSignal.timeout(2000) });
      assert.equal(page.status, 200);
      const initial = await page.text();
      const polymerQuestion = "확인된 재질·품목과 이를 확인한 자료(라벨·재질 명세·발생 이력 등)가 있나요?";
      const massQuestion = "확인된 질량은 몇 kg인가요?";
      const questions = (html: string): string[] => {
        assert.match(html, /<h1>추가 정보 필요<\/h1>/);
        const list = html.match(/<section id="case-reasons">[\s\S]*?<ul>(.*?)<\/ul>/s);
        assert.ok(list, `${launcher}: expected needs-information`);
        const contents = list[1];
        assert.ok(typeof contents === "string");
        const items = [...contents.matchAll(/<li\b[^>]*>(.*?)<\/li>/gs)].map((item) => {
          const question = item[1]?.replace(/^<strong>[^<]*<\/strong>\s*/, "");
          assert.ok(question);
          return question;
        });
        assert.ok(!items.some(item => item.includes("JSON")));
        return items;
      };
      assert.deepEqual(questions(initial), [polymerQuestion]);
      assert.match(initial, /name="answers"/);
      assert.ok(initial.includes(`사례 ${caseId}</p>`));
      assert.doesNotMatch(initial, /snapshot-unavailable/);
      const polymer = await fetch(url + path + "/answers", { method: "POST", redirect: "manual", headers: { ...formHeaders, cookie, origin: url }, body: new URLSearchParams({ answers: '{"polymer":"PP"}' }), signal: AbortSignal.timeout(2000) });
      assert.equal(polymer.status, 303);
      assert.equal(polymer.headers.get("location"), path);
      const middlePage = await fetch(url + path, { headers: { cookie }, signal: AbortSignal.timeout(2000) });
      assert.equal(middlePage.status, 200);
      const middle = await middlePage.text();
      assert.match(middle, /기계적 재활용 추천/);
      assert.doesNotMatch(middle, /확인된 질량은 몇 kg인가요/);
      assert.ok(middle.includes(`사례 ${caseId}</p>`));
      assert.doesNotMatch(middle, /snapshot-unavailable/);
      const corrected = await fetch(url + path + "/answers", { method: "POST", redirect: "manual", headers: { ...formHeaders, cookie, origin: url }, body: new URLSearchParams({ answers: '{"massKg":100}' }), signal: AbortSignal.timeout(2000) });
      assert.equal(corrected.status, 303);
      assert.equal(corrected.headers.get("location"), path);
      const refreshed = await fetch(url + path, { headers: { cookie }, signal: AbortSignal.timeout(2000) });
      assert.equal(refreshed.status, 200);
      const reviewed = await refreshed.text();
      assert.match(reviewed, /공개 근거상 가능\(조건부\)/);
      assert.ok(reviewed.includes(`사례 ${caseId}</p>`));
      assert.doesNotMatch(reviewed, /snapshot-unavailable/);
      assert.ok(!reviewed.includes(polymerQuestion));
      assert.ok(!reviewed.includes(massQuestion));
      assert.ok(reviewed.includes(`action="${path}/answers"`));
      const report = await fetch(url + path + "/report", { headers: { cookie }, signal: AbortSignal.timeout(2000) });
      assert.equal(report.status, 200);
      assert.doesNotMatch(await report.text(), /<form\b/);
      // The exit listener above is installed at spawn; arm the failure bound
      // before signalling so an immediate exit cannot race the subscription.
      const shutdown = Promise.race([exited, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`launcher shutdown timeout: ${launcher}\n${stderr}`)), 15000);
      })]);
      child.kill("SIGTERM");
      const result = await shutdown;
      assert.deepEqual(result, { code: 0, signal: null });
      assert.equal(stderr, "");
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exited;
      await rm(directory, { recursive: true, force: true });
    }
  }
});
