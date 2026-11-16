import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { createApp } from "../src/app.ts";
import { createResourceApp } from "../src/session.ts";
import { createCaseStore } from "../src/o-case-store.ts";
import { feedbackPath, feedbackScript } from "../src/app-feedback.ts";

const origin = "http://localhost:3000";
test("primary answer links resolve on fixed demos and legacy adapter cases", async () => {
  const result = { state: "needs-information", caseId: "legacy-answer", questions: ["합성 질량 확인"], evidence: [] } as const;
  const app = createApp({ origin, adapter: { submit: async () => result, answer: async () => result } });
  async function navigation(response: Response) {
    const ids = new Set<string>(), links: string[] = [];
    let answerId: string | null = null;
    await new HTMLRewriter()
      .on("[id]", { element(element) { const id = element.getAttribute("id"); if (id) ids.add(id); } })
      .on('a.primary-action[href^="#"]', { element(element) { const href = element.getAttribute("href"); if (href) links.push(href); } })
      .on('textarea[name="answers"]', { element(element) { answerId = element.getAttribute("id"); } })
      .transform(response).text();
    assert.ok(links.length >= 2);
    for (const href of links) assert.ok(ids.has(href.slice(1)), `primary action ${href} must resolve`);
    return { links, answerId };
  }
  try {
    for (const path of ["/demo/held", "/demo/review"]) await navigation(await app(new Request(origin + path)));
    const home = await app(new Request(origin));
    const cookie = home.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    const created = await app(new Request(origin + "/cases", { method: "POST",
      headers: { cookie, origin, "content-type": "application/json" }, body: "{}" }));
    assert.equal(created.status, 303);
    const path = created.headers.get("location");
    assert.ok(path);
    const legacy = await navigation(await app(new Request(origin + path, { headers: { cookie } })));
    assert.ok(legacy.answerId);
    assert.ok(legacy.links.includes("#" + legacy.answerId), "legacy answer action reaches its real JSON control");
  } finally { app.dispose(); }
});

test("skip action resolves to a focusable main after primary navigation", async () => {
  const app = createApp({ origin });
  try {
    const navigation: { href: string | null; target: string | null; tabIndex: string | null; nestedMenus: number } = {
      href: null, target: null, tabIndex: null, nestedMenus: 0,
    };
    await new HTMLRewriter()
      .on(".skip-link", { element(element) { navigation.href = element.getAttribute("href"); } })
      .on("main", { element(element) { navigation.target = element.getAttribute("id"); navigation.tabIndex = element.getAttribute("tabindex"); } })
      .on('main nav[aria-label="주 메뉴"]', { element() { navigation.nestedMenus++; } })
      .transform(await app(new Request(origin))).text();
    assert.ok(navigation.target);
    assert.equal(navigation.href, "#" + navigation.target);
    assert.equal(navigation.tabIndex, "-1", "fragment navigation must focus main without adding a tab stop");
    assert.equal(navigation.nestedMenus, 0, "the next Tab must bypass the primary menu");
  } finally { app.dispose(); }
});

test("feedback keeps first native submit, prevents duplicates and recovers on pageshow", () => {
  // Given minimal DOM objects that throw if code touches fields or disables controls.
  const attributes = new Map<string, string>();
  const buttonAttributes = new Map<string, string>();
  const events = new Map<string, (event: { defaultPrevented: boolean; preventDefault(): void }) => void>();
  let pageshow = () => {};
  const status = { className: "", textContent: "", setAttribute: (key: string, value: string) => attributes.set("status:" + key, value) };
  const button = { setAttribute: (key: string, value: string) => buttonAttributes.set(key, value), removeAttribute: (key: string) => buttonAttributes.delete(key),
    set disabled(_value: boolean) { throw new Error("native serialization must retain submitter"); } };
  const form = { setAttribute: (key: string, value: string) => attributes.set(key, value), removeAttribute: (key: string) => attributes.delete(key),
    querySelectorAll: () => [button], querySelector: () => status, append: () => {},
    addEventListener: (name: string, handler: (event: { defaultPrevented: boolean; preventDefault(): void }) => void) => events.set(name, handler) };
  runInNewContext(feedbackScript, { document: { querySelectorAll: () => [form], createElement: () => status },
    window: { addEventListener: (_name: string, handler: () => void) => { pageshow = handler; } } });
  let prevented = 0;
  const event = { defaultPrevented: false, preventDefault: () => { prevented++; } };
  const submit = events.get("submit");
  assert.ok(submit);
  // When the first and a repeated submission occur.
  submit(event);
  assert.equal(prevented, 0);
  assert.equal(attributes.get("aria-busy"), "true");
  assert.equal(attributes.get("status:aria-live"), "polite");
  assert.ok(status.textContent.length > 0);
  submit(event);
  assert.equal(prevented, 1);
  // Then history restoration resets the live and button state and permits retry.
  pageshow();
  assert.equal(attributes.has("aria-busy"), false);
  assert.equal(buttonAttributes.has("aria-disabled"), false);
  assert.equal(status.textContent, "");
  submit(event);
  assert.equal(prevented, 1);
});

test("same-origin script is external and CSP retains its restrictive directives", async () => {
  // Given the native app and its input document.
  const app = createApp({ origin });
  try {
    const home = await app(new Request(origin));
    const html = await home.text();
    // When the browser requests the declared script.
    const script = await app(new Request(origin + feedbackPath));
    assert.equal(script.status, 200);
    assert.match(script.headers.get("content-type") ?? "", /javascript/);
    assert.equal(await script.text(), feedbackScript);
    assert.match(html, /<script src="\/app-feedback.js" defer><\/script>/);
    const csp = home.headers.get("content-security-policy") ?? "";
    for (const directive of ["default-src 'none'", "script-src 'self'", "form-action 'self'", "base-uri 'none'", "frame-ancestors 'none'"]) assert.ok(csp.includes(directive));
    assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
    assert.doesNotMatch(feedbackScript, /fetch\(|XMLHttpRequest|document\.cookie|localStorage|sessionStorage/);
    assert.doesNotMatch(html, /합성 보류 데모|실측 질량/);
  } finally { app.dispose(); }
});

test("ordinary Korean fields submit without JavaScript, preserve null, and reevaluate unchanged inputs", async () => {
  // Given a case with genuinely missing mass and the real prepareAnswer validator.
  const store = createCaseStore();
  const app = createResourceApp({ origin, caseStore: store });
  try {
    const home = await app.fetch(new Request(origin));
    const cookie = home.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    const headers = { cookie, origin, "content-type": "application/x-www-form-urlencoded" };
    const submitted = await app.fetch(new Request(origin + "/cases", { method: "POST", headers, body: new URLSearchParams({ description: "합성 PP 사례", process: "사출", polymer: "PP", contamination: "없음", hazardousContact: "no", massKg: "", region: "울산", assessmentDate: "2026-11-10" }) }));
    assert.equal(submitted.status, 303);
    const path = submitted.headers.get("location");
    assert.ok(path);
    const owner = "session:" + cookie.slice("resource_session=".length);
    const id = path.slice("/cases/".length);
    const before = store.read(owner, id);
    assert.ok(before);
    const html = await (await app.fetch(new Request(origin + path, { headers: { cookie } }))).text();
    assert.ok(html.indexOf('name="field_massKg"') < html.indexOf('name="answers"'));
    assert.match(html, /자료 반영해 다시 평가하기/);
    const questionNavigation = { links: 0, targets: 0, fields: [] as string[] };
    await new HTMLRewriter()
      .on('a.primary-action[href="#answer-fields"]', { element() { questionNavigation.links++; } })
      .on("#answer-fields", { element() { questionNavigation.targets++; } })
      .on('input[name^="field_"],textarea[name^="field_"],select[name^="field_"]', {
        element(element) {
          const name = element.getAttribute("name");
          if (name) questionNavigation.fields.push(name);
        },
      })
      .transform(new Response(html)).text();
    assert.equal(questionNavigation.links, 1, "question has a direct action to its native answer fields");
    assert.equal(questionNavigation.targets, 1, "answer action resolves to one real heading");
    assert.equal(questionNavigation.fields[0], "field_massKg", "the missing mass is the first answer control");
    // When a native POST carries an explicit unchanged nullable scalar patch.
    const response = await app.fetch(new Request(origin + path + "/answers", { method: "POST", headers,
      body: new URLSearchParams({ baseVersion: String(before.version), answerMode: "fields", field_massKg: "", photoSelection: "explicit" }) }));
    assert.equal(response.status, 303);
    const after = store.read(owner, id);
    assert.ok(after);
    assert.deepEqual(after.input, before.input);
    assert.equal(after.version, before.version + 1);
    // Then invalid units and empty JSON do not replace that committed result.
    const invalidFields: readonly Readonly<Record<string, string>>[] = [{ answerMode: "fields", field_massKg: "24kg" }, { answers: "[]" }, { answerMode: "fields", field_massKg: "0" }, { answerMode: "fields", field_massKg: "24", field_photoRefs: "forged" }];
    for (const fields of invalidFields) {
      const invalid = await app.fetch(new Request(origin + path + "/answers", { method: "POST", headers,
        body: new URLSearchParams({ ...fields, baseVersion: String(after.version), photoSelection: "explicit" }) }));
      assert.equal(invalid.status, 400);
      assert.equal(store.read(owner, id)?.version, after.version);
    }
    const updated = await app.fetch(new Request(origin + path + "/answers", { method: "POST", headers,
      body: new URLSearchParams({ baseVersion: String(after.version), answerMode: "fields", field_massKg: "24", photoSelection: "explicit" }) }));
    assert.equal(updated.status, 303);
    assert.equal(store.read(owner, id)?.input.massKg, 24);
  } finally { app.dispose(); await app.close(); store.dispose(); }
});
