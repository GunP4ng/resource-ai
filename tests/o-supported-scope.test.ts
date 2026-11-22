import assert from "node:assert/strict";
import { test } from "node:test";
import { createSyntheticResourceApp as createResourceApp } from "./synthetic-runtime.ts";
import { createCaseStore } from "../src/o-case-store.ts";
import { unsupportedScope } from "../src/o-supported-scope.ts";
import originalRows from "../data/evaluation/rubric-followup-20261121/conditional-alternatives/results.json" with { type: "json" };

test("scope boundary recognizes reported nonplastics without guessing unknown or mixed plastic facts", () => {
  for (const polymer of ["유리", "glass", "음식물", "고무", "폐섬유", "오니", "rubber", "sludge"]) {
    assert.ok(unsupportedScope({ polymer, description: "검토용 입력" }), polymer);
  }
  for (const polymer of ["기타 미지원 재질", "폐목재", "금속 스크랩", "종이", "wood", "steel", "포장재", "복합 포장재", "PP", "PA", "PC"]) {
    assert.equal(unsupportedScope({ polymer, description: "검토용 입력" }), null, polymer);
  }
  assert.equal(unsupportedScope({ polymer: null, description: "폐목재 절단 자투리" }), null);
  assert.equal(unsupportedScope({ polymer: null, description: "폐목재가 아닌 미상 재료" }), null);
  assert.equal(unsupportedScope({ polymer: null, description: "not wood, material unknown" }), null);
  assert.equal(unsupportedScope({ polymer: "PET", description: "종이 라벨이 부착됨" }), null);
  assert.equal(unsupportedScope({ polymer: "PP/PE 혼합", description: "재질 확인 필요" }), null);
  assert.equal(unsupportedScope({ polymer: null, description: "미상 발포재" }), null);
  assert.equal(unsupportedScope({ polymer: null, description: "종이 라벨이 붙은 재질 미상의 용기" }), null);
  assert.equal(unsupportedScope({ polymer: "미상", description: "목재 포장에 든 부품" }), null);
  assert.equal(unsupportedScope({ polymer: "알 수 없음", description: "재질 확인 필요" }), null);
  assert.equal(unsupportedScope({ polymer: null, description: "paper label; material unknown" }), null);
  for (const row of originalRows) assert.equal(unsupportedScope(row.input), null, row.caseId);
});

test("out-of-scope app input produces no evaluation or stored case and cannot overwrite a prior decision", async () => {
  const origin = "http://localhost:3000", owner = "actor:scope-test";
  const store = createCaseStore();
  let calls = 0;
  const app = createResourceApp({ origin, actorForRequest: async () => "scope-test", caseStore: store,
    runner: async () => { calls++; return {}; } });
  const post = (path: string, raw: unknown) => new Request(origin + path, {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(raw),
  });
  try {
    const { caseId: _id, ...raw } = originalRows[0]!.input;
    const rejected = await app.fetch(post("/cases", { ...raw, polymer: "유리", description: "폐유리 절단품" }));
    assert.equal(rejected.status, 422);
    assert.equal(rejected.headers.get("cache-control"), "private, no-store");
    const rejectedHtml = await rejected.text();
    assert.match(rejectedHtml, /data-out-of-scope/);
    assert.match(rejectedHtml, /<a class="primary-action" href="\/">입력 확인하기<\/a>/);
    assert.doesNotMatch(rejectedHtml, /<form\b/);
    assert.equal(calls, 0);
    assert.equal(store.list(owner).length, 0);
    const created = await app.fetch(post("/cases", raw));
    assert.equal(created.status, 303);
    const path = created.headers.get("location");
    assert.ok(path);
    const id = path.slice("/cases/".length), before = store.read(owner, id);
    assert.ok(before);
    const beforeCalls = calls;
    const update = await app.fetch(post(path + "/answers", { baseVersion: before.version, patch: { polymer: "glass" } }));
    assert.equal(update.status, 422);
    const updateHtml = await update.text();
    assert.ok(updateHtml.includes(`<a class="primary-action" href="${path}">입력 확인하기</a>`));
    assert.doesNotMatch(updateHtml, /<form\b/);
    const nativeUpdate = await app.fetch(new Request(origin + path + "/answers", {
      method: "POST", headers: { origin }, body: new URLSearchParams({
        baseVersion: String(before.version), answerMode: "fields", field_polymer: "glass",
      }),
    }));
    assert.equal(nativeUpdate.status, 422);
    assert.equal(nativeUpdate.headers.get("cache-control"), "private, no-store");
    assert.equal(await nativeUpdate.text(), updateHtml);
    assert.equal(calls, beforeCalls);
    assert.deepEqual(store.read(owner, id), before);
  } finally { app.dispose(); }
});

test("native out-of-scope creation returns an editable draft that can be corrected and submitted", async () => {
  const origin = "http://localhost:3000";
  let evaluations = 0, commits = 0;
  const app = createResourceApp({ origin, runner: async () => { evaluations++; return {}; },
    committed: () => { commits++; } });
  const original = {
    description: "\n합성 시료 A", process: '세척 <A> & "B"', polymer: "유리",
    contamination: "없음", hazardousContact: "no", massKg: "180.00",
    region: "울산", assessmentDate: "2026-11-25",
  };
  try {
    const entry = await app.fetch(new Request(origin));
    const cookie = entry.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    const get = (path: string) => app.fetch(new Request(origin + path, { headers: { cookie } }));
    const post = (path: string, body: URLSearchParams) => app.fetch(new Request(origin + path, {
      method: "POST", headers: { origin, cookie }, body,
    }));
    const rejected = await post("/cases", new URLSearchParams(original));
    assert.equal(rejected.status, 422);
    assert.equal(rejected.headers.get("cache-control"), "private, no-store");
    assert.equal(rejected.headers.get("location"), null);
    assert.equal(rejected.headers.get("set-cookie"), null);
    assert.deepEqual([evaluations, commits], [0, 0]);
    assert.match(await (await get("/cases")).text(), /저장된 사례가 없습니다/);

    const formSelector = '[data-out-of-scope] form[method="post"][action="/cases"]';
    const fields = new URLSearchParams();
    let action: string | null = null;
    let description = "";
    // HTMLRewriter exposes the source entities in attribute values and text.
    const entities: Record<string, string> = { "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&#39;": "'" };
    const decode = (value: string) => value.replace(/&(?:lt|gt|amp|quot|#39);/g, entity => entities[entity] ?? entity);
    const html = await new HTMLRewriter()
      .on(formSelector, { element(el) { action = el.getAttribute("action"); } })
      .on(`${formSelector} input[name]`, { element(el) {
        fields.append(el.getAttribute("name") ?? "", decode(el.getAttribute("value") ?? ""));
      } })
      .on(`${formSelector} textarea[name="description"]`, {
        // Unlike HTMLRewriter, browser HTML parsing strips one initial textarea newline.
        element(el) { el.onEndTag(() => fields.append("description", decode(description).replace(/^\n/, ""))); },
        text(chunk) { description += chunk.text; },
      })
      .on(`${formSelector} select[name="hazardousContact"] option[selected]`, { element(el) {
        fields.append("hazardousContact", el.getAttribute("value") ?? "");
      } })
      .transform(rejected).text();
    assert.equal(action, "/cases", "422 must contain the editable creation form");
    assert.match(html, /value="세척 &lt;A&gt; &amp; &quot;B&quot;"/);
    assert.equal(fields.size, Object.keys(original).length);
    assert.deepEqual(Object.fromEntries(fields), original);

    fields.set("polymer", "PET");
    const created = await post(action, fields);
    assert.equal(created.status, 303);
    const path = created.headers.get("location");
    assert.ok(path);
    assert.match(path, /^\/cases\/[\w-]+$/);
    const stored = await get(path + "/input");
    assert.equal(stored.status, 200);
    assert.deepEqual(await stored.json(), { ...original, polymer: "PET", massKg: 180, caseId: path.slice("/cases/".length), photoRefs: [] });

    const detail = await get(path);
    assert.equal(detail.status, 200);
    let reportPath: string | null = null;
    await new HTMLRewriter().on(`a[href="${path}/report"]`, { element(el) {
      reportPath = el.getAttribute("href");
    } }).transform(detail).text();
    assert.ok(reportPath);
    const report = await get(reportPath);
    assert.equal(report.status, 200);
    assert.match(await report.text(), /id="commercial-summary"/);
    assert.deepEqual([evaluations, commits], [1, 1]);
  } finally { await app.close(); }
});
