import assert from "node:assert/strict";
import { test } from "node:test";
import { createCaseStore } from "../src/o-case-store.ts";
import { createSyntheticResourceApp } from "./synthetic-runtime.ts";

const origin = "http://localhost:3000";
const actor = "date-recovery";
const owner = `actor:${actor}`;
const draft = {
  description: "\n합성 첫 줄\n둘째 줄", process: '세척 <A> & "B"', polymer: "PET", contamination: "없음",
  hazardousContact: "no", massKg: "180.00", region: "울산",
};
const badDate = "10000-01-01";
const dateNotice = "검토 기준일을 9999년 12월 31일 이하의 실제 날짜로 고쳐 다시 제출하세요.";
const entities: Readonly<Record<string, string>> = { "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&#39;": "'" };
const decode = (value: string) => value.replace(/&(?:lt|gt|amp|quot|#39);/g, key => entities[key] ?? key);

function fixture() {
  const store = createCaseStore();
  let evaluations = 0, commits = 0;
  const app = createSyntheticResourceApp({
    origin, caseStore: store, actorForRequest: async () => actor,
    runner: async () => { evaluations++; return {}; }, committed: () => { commits++; },
  });
  return {
    store, app,
    post: (fields: URLSearchParams, path = "/cases") => app.fetch(new Request(origin + path, {
      method: "POST", headers: { origin }, body: fields,
    })),
    counts: () => [evaluations, commits, store.list(owner).length],
    async close() { await app.close(); store.dispose(); },
  };
}

async function correctionFields(response: Response) {
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("location"), null);
  assert.equal(response.headers.get("set-cookie"), null);
  const selector = '[data-intake-panel]:not([hidden]) form[data-intake-form][method="post"][action="/cases"]';
  const fields = new URLSearchParams();
  let forms = 0, description = "", notice = "";
  const html = await new HTMLRewriter()
    .on(selector, { element() { forms++; } })
    .on(`${selector} input[name]`, { element(el) {
      const name = el.getAttribute("name")!;
      fields.append(name, decode(el.getAttribute("value") ?? ""));
      if (name === "assessmentDate") {
        assert.equal(el.getAttribute("type"), "date");
        assert.ok(el.hasAttribute("required"));
        assert.equal(el.getAttribute("max"), "9999-12-31");
      }
    } })
    .on(`${selector} textarea[name="description"]`, { text(chunk) { description += chunk.text; } })
    .on(`${selector} select[name="hazardousContact"] option[selected]`, {
      element(el) { fields.append("hazardousContact", el.getAttribute("value") ?? ""); },
    })
    .on('[data-intake-panel] .notice[role="alert"]', { text(chunk) { notice += chunk.text; } })
    .transform(response).text();
  assert.equal(forms, 1);
  assert.ok(notice.includes(dateNotice));
  assert.match(html, /세척 &lt;A&gt; &amp; &quot;B&quot;/);
  assert.doesNotMatch(html, /data-intake-landing|data-out-of-scope|id="decision-summary"/);
  // Browsers consume the first source newline in a textarea.
  fields.append("description", decode(description).replace(/^\n/, ""));
  assert.equal(fields.size, 9);
  assert.match(fields.get("submissionId") ?? "", /^[a-f0-9-]{36}$/);
  return fields;
}
function caseFields(fields: URLSearchParams) {
  const { submissionId: _submissionId, ...input } = Object.fromEntries(fields);
  return input;
}

test("G021 native create recovers a sole invalid or missing date and resubmits the retained draft", async t => {
  const { app, post, counts, close } = fixture();
  t.after(close);
  const initial = await app.fetch(new Request(origin));
  assert.match(await initial.text(), /<input id="assessmentDate"[^>]*max="9999-12-31"/);

  const token = "a".repeat(32);
  let retry: URLSearchParams | undefined;
  for (const date of [badDate, "2026-02-30", "", undefined]) {
    const params = new URLSearchParams(draft);
    if (date !== undefined) params.set("assessmentDate", date);
    const response = await post(params, date === badDate ? `/cases?progress=${token}` : "/cases");
    const fields = await correctionFields(response);
    assert.deepEqual(caseFields(fields), { ...draft, assessmentDate: date ?? "" });
    assert.deepEqual(counts(), [0, 0, 0]);
    retry = fields;
  }
  const progress = await app.fetch(new Request(`${origin}/cases/progress/${token}`));
  assert.equal(progress.status, 200);
  assert.deepEqual(await progress.json(), { step: null });

  assert.ok(retry);
  retry.set("assessmentDate", "2028-02-29");
  const accepted = await post(retry);
  assert.equal(accepted.status, 303);
  const path = accepted.headers.get("location");
  assert.ok(path);
  assert.deepEqual(counts(), [1, 1, 1]);
  const stored = await app.fetch(new Request(origin + path + "/input"));
  assert.equal(stored.status, 200);
  assert.deepEqual(await stored.json(), {
    ...draft, caseId: path.slice("/cases/".length), massKg: 180, assessmentDate: "2028-02-29", photoRefs: [],
  });
});

test("G021 keeps mass precedence, generic failures, scope handling and saved edits", async t => {
  const { store, app, post, counts, close } = fixture();
  t.after(close);
  const valid = { ...draft, assessmentDate: "2028-02-29" };
  const invalid = { ...draft, assessmentDate: badDate };
  for (const fields of [valid, invalid]) {
    const response = await post(new URLSearchParams({ ...fields, massKg: "1000001" }));
    assert.equal(response.status, 400);
    const html = await response.text();
    assert.match(html, /<p role="alert">null 또는 0 &lt; kg &lt;= 1000000 범위의 유한한 숫자여야 합니다\./);
    if (fields === invalid) assert.match(html, /YYYY-MM-DD 형식의 실제 달력 날짜여야 합니다\./);
    assert.match(html, /<input id="massKg"[^>]*value="1000001"/);
    assert.doesNotMatch(html, /data-intake-panel/);
  }

  const duplicate = new URLSearchParams(invalid);
  duplicate.append("assessmentDate", valid.assessmentDate);
  async function generic(response: Response, message: RegExp) {
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const html = await response.text();
    assert.match(html, message);
    assert.doesNotMatch(html, /data-intake-form/);
  }
  await generic(await post(new URLSearchParams({ ...invalid, massKg: "abc" })), /<li>사례 입력:/);
  await generic(await post(new URLSearchParams({ ...valid, hazardousContact: "maybe" })), /<li>유해물질 접촉:/);
  await generic(await post(new URLSearchParams({ ...invalid, hazardousContact: "maybe" })),
    /<li>유해물질 접촉:[^<]*<\/li><li>평가 기준일:/);
  await generic(await post(duplicate), /같은 필드가 두 번 들어 있습니다/);
  await generic(await post(new URLSearchParams({ ...invalid, photoRefs: "synthetic-photo" })),
    /<li>평가 기준일:/);
  assert.deepEqual(counts(), [0, 0, 0]);

  const glass = await post(new URLSearchParams({ ...valid, polymer: "유리" }));
  assert.equal(glass.status, 422);
  assert.match(await glass.text(), /유리는 검토 범위에 포함되지 않습니다/);
  const glassDraft = await correctionFields(await post(new URLSearchParams({ ...invalid, polymer: "유리" })));
  assert.deepEqual(caseFields(glassDraft), { ...invalid, polymer: "유리" });
  assert.deepEqual(counts(), [0, 0, 0]);

  const created = await post(new URLSearchParams(valid));
  assert.equal(created.status, 303);
  const path = created.headers.get("location");
  assert.ok(path);
  const id = path.slice("/cases/".length);
  const before = store.read(owner, id);
  assert.ok(before);
  const beforeCounts = counts();
  assert.deepEqual(beforeCounts, [1, 1, 1]);
  const editPage = await app.fetch(new Request(origin + path));
  assert.match(await editPage.text(), /<input id="field_assessmentDate" name="field_assessmentDate" type="date" required value="/);
  const json = await app.fetch(new Request(origin + "/cases", {
    method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ ...invalid, massKg: 180, photoRefs: [] }),
  }));
  await generic(json, /<li>평가 기준일:/);
  assert.deepEqual(counts(), beforeCounts);
  await generic(await post(new URLSearchParams({
    baseVersion: String(before.version), answerMode: "fields", field_assessmentDate: badDate,
  }), path + "/answers"), /<li>평가 기준일:/);
  assert.deepEqual(counts(), beforeCounts);
  assert.deepEqual(store.read(owner, id), before);
});
