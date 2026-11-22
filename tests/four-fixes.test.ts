import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { createApp } from "../src/app.ts";
import type { AppDependencies } from "../src/app.ts";
import type { CaseInput, DecisionResult } from "../src/contracts.ts";
import { createResourceDomain } from "../src/domain.ts";
import { lookupLegalEvidence } from "../src/evidence.ts";
import { createCaseStore } from "../src/o-case-store.ts";
import { safetyReasons } from "../src/o-safety-reasons.ts";
import { createAssessmentAdapter } from "../src/session.ts";

const origin = "http://localhost:3000";
const start = Date.UTC(2026, 10, 25);
const minute = 60_000;
const at = (minutes: number) => start + minutes * minute;
const utc = (minutes: number) => new Date(at(minutes)).toISOString();
const resinQuestion = "확인된 수지 종류와 이를 확인한 자료(라벨·재질 명세 등)가 있나요?";
const fields = { description: "합성 사출 용기 파쇄품", process: "사출", polymer: "PET",
  contamination: "없음", hazardousContact: "no", massKg: "100", region: "울산", assessmentDate: "2026-11-25" };
const facts: CaseInput = { ...fields, caseId: "synthetic-four-fixes", photoRefs: [], massKg: 100, hazardousContact: "no" };

function fixture(t: TestContext, requestControls: Pick<AppDependencies, "actorForRequest" | "checkRequest"> = {}) {
  let time = start;
  let evaluations = 0;
  let beforeEvaluate: (() => Promise<void>) | undefined;
  const now = () => time;
  const store = createCaseStore(now);
  const adapter = createAssessmentAdapter();
  const app = createApp({ origin, now, caseStore: store, ...requestControls, preparer: {
    prepareSubmit: adapter.prepareSubmit,
    prepareAnswer: adapter.prepareAnswer,
    async evaluate(input) {
      evaluations++;
      await beforeEvaluate?.();
      return { decision: await createResourceDomain(input).decide() };
    },
  } });
  t.after(async () => { app.dispose(); await app.settled(); adapter.dispose(); store.dispose(); });
  const get = (path: string, cookie = "") => app(new Request(origin + path, { headers: { cookie } }));
  const post = (path: string, cookie: string, values: Record<string, string>) =>
    app(new Request(origin + path, { method: "POST", headers: { cookie, origin }, body: new URLSearchParams(values) }));
  const create = (cookie: string, patch: Record<string, string> = {}) => post("/cases", cookie, { ...fields, ...patch });
  const edit = (path: string, cookie: string, field: "description" | "polymer" | "process" | "region" | "contamination", value: string, version = 1) =>
    post(path + "/answers", cookie, { baseVersion: String(version), answerMode: "fields", [`field_${field}`]: value });
  const home = async (cookie = "") => {
    const result = await get("/", cookie);
    assert.equal(result.status, 200);
    const header = result.headers.get("set-cookie");
    assert.ok(header);
    const [token] = header.split(";");
    assert.ok(token && token.startsWith("resource_session="));
    return { cookie: token, maxAge: header.match(/; Max-Age=(\d+)(?:;|$)/)?.[1] };
  };
  return { fetch: app, store, get, create, edit, home, setTime: (next: number) => { time = next; },
    evaluations: () => evaluations, beforeEvaluate: (work: () => Promise<void>) => { beforeEvaluate = work; } };
}

const ownerFor = (cookie: string) => `session:${cookie.slice("resource_session=".length)}`;
const caseId = (path: string) => path.slice("/cases/".length);
async function created(result: Response): Promise<string> {
  if (result.status !== 303) assert.equal(result.status, 303, await result.text());
  const path = result.headers.get("location");
  assert.ok(path);
  assert.match(path, /^\/cases\/[\w-]+$/);
  return path;
}
async function readable(result: Response): Promise<string> {
  assert.equal(result.status, 200);
  return result.text();
}
async function exported(app: ReturnType<typeof fixture>, path: string, cookie: string): Promise<CaseInput> {
  const result = await app.get(path + "/input", cookie);
  assert.equal(result.status, 200);
  return result.json();
}

for (const [material, base] of [
  ["plastic", { description: "QA 재현", process: "사출", polymer: "PP", contamination: "없음",
    hazardousContact: "no", massKg: "", region: "울산", assessmentDate: "2026-11-25" }],
  ["metal", { description: "깨끗한 철 스크랩", process: "사업장일반폐기물 금속 절단", polymer: "고철", contamination: "없음",
    hazardousContact: "no", massKg: "", region: "울산", assessmentDate: "2026-11-25" }],
] as const) {
  for (const field of ["process", "polymer", "region"] as const) {
    for (const value of ["", "미상", "모름", "알 수 없음", "unknown"]) {
      test(`#107 ${material} native ${field}=${JSON.stringify(value)} asks the same question as blank`, async t => {
        const app = fixture(t);
        const { cookie } = await app.home();
        const blankPath = await created(await app.create(cookie, { ...base, [field]: "" }));
        const path = await created(await app.create(cookie, { ...base, [field]: value }));
        const blank = await readable(await app.get(blankPath, cookie));
        const html = await readable(await app.get(path, cookie));
        assert.match(html, /<h1>추가 정보 필요<\/h1>/);
        const reasons = (text: string) => text.match(/<section id="case-reasons">([\s\S]*?)<\/section>/)?.[1];
        assert.ok(reasons(blank));
        assert.equal(reasons(html), reasons(blank));
        assert.equal((await exported(app, path, cookie))[field], value === "" ? null : value);
      });
    }
  }
}

for (const [field, question] of [
  ["process", "폐자원이 발생한 공정 또는 발생원은 무엇인가요?"],
  ["region", "폐자원이 발생한 지역은 어디인가요?"],
] as const) {
  test(`native ${field} corrections keep the detail and report waiting for the missing fact`, async t => {
    const app = fixture(t);
    const { cookie } = await app.home();
    const path = await created(await app.create(cookie, { [field]: "" }));
    const views = [
      [path, "누락된 사례 정보를 확인해 답변란에 입력하세요."],
      [path + "/report", "아래 보류 사유에서 누락된 정보를 확인하고 필요한 자료를 준비하세요."],
    ] as const;
    async function assertMissing(raw: string | null) {
      assert.equal((await exported(app, path, cookie))[field], raw);
      for (const [view, action] of views) {
        const html = await readable(await app.get(view, cookie));
        assert.equal(html.match(/<h1>([^<]*)<\/h1>/)?.[1], "추가 정보 필요", view);
        assert.ok(html.match(/<section id="case-reasons">([\s\S]*?)<\/section>/)?.[1]?.includes(question), view);
        assert.match(html, /<li data-guidance-stage="1" data-state="partial">/, view);
        assert.ok(html.includes(`<p id="next-action"><strong>다음 행동:</strong> ${action}</p>`), view);
        if (field === "process") {
          const stage = html.match(/<section id="guidance-stage-1">([\s\S]*?)<\/section>/)?.[1];
          assert.ok(stage?.includes("<li>발생 공정이 미확보입니다.</li>"), view);
        }
      }
    }

    await assertMissing(null);
    const corrections = ["미상", " 미상 ", ""];
    for (const [index, value] of corrections.entries()) {
      assert.equal(await created(await app.edit(path, cookie, field, value, index + 1)), path);
      await assertMissing(value === "" ? null : value);
    }
    assert.equal(await created(await app.edit(path, cookie, field, fields[field], corrections.length + 1)), path);
    assert.equal((await exported(app, path, cookie))[field], fields[field]);
    for (const [view] of views) {
      const html = await readable(await app.get(view, cookie));
      assert.equal(html.match(/<h1>([^<]*)<\/h1>/)?.[1], "기계적 재활용 추천", view);
      assert.match(html, /<li data-guidance-stage="1" data-state="available">/, view);
    }
  });
}

function stageOneRows(html: string, sectionAttributes: string): string[] {
  const stage = html.match(new RegExp(`<section id="guidance-stage-1"${sectionAttributes}>([\\s\\S]*?)</section>`));
  assert.ok(stage?.[1], "stage 1 section is present");
  return [...stage[1].matchAll(/<li>([^<]*)<\/li>/g)].map(([, row]) => row!);
}

const guidanceActor = "synthetic-guidance-owner";
for (const [field, label, reason] of [
  ["region", "발생 지역", "발생 지역이 미확보입니다."],
  ["contamination", "오염 상태", "오염 상태가 미확보입니다."],
] as const) {
  const prefix = `${label}: `;
  const outputRows = (rows: string[]) => rows.filter(row => row.startsWith(prefix));
  const privateRows = (html: string) => stageOneRows(html, ' data-stage-method="1"');

  async function assertStored(app: ReturnType<typeof fixture>, path: string, cookie: string, version: number, raw: string | null) {
    const snapshot = app.store.read(`actor:${guidanceActor}`, caseId(path));
    assert.ok(snapshot);
    assert.equal(snapshot.version, version);
    assert.equal(snapshot.input[field], raw);
    assert.equal((await exported(app, path, cookie))[field], raw);
  }

  test(`signed-in native ${field} edit shows 미확보 in stage 1 and exports the exact spaces`, async t => {
    const app = fixture(t, { actorForRequest: async () => guidanceActor });
    const { cookie } = await app.home();
    const path = await created(await app.create(cookie));
    const blank = "   ";
    assert.equal(await created(await app.edit(path, cookie, field, blank)), path);
    await assertStored(app, path, cookie, 2, blank);

    const detail = await readable(await app.get(path, cookie));
    assert.match(detail, /<p>버전 2<\/p>/);
    const rows = privateRows(detail);
    assert.ok(rows.includes(reason));

    const blankPath = await created(await app.create(cookie, { [field]: blank }));
    const commercial = await readable(await app.get(path + "/report", cookie));
    const control = await readable(await app.get(blankPath + "/report", cookie));
    const decisionHeading = /<h1>([^<]*)<\/h1>/;
    const questions = /<section id="case-reasons">([\s\S]*?)<\/section>/;
    assert.equal(control.match(decisionHeading)?.[1], "추가 정보 필요");
    assert.equal(commercial.match(decisionHeading)?.[1], control.match(decisionHeading)?.[1]);
    const controlQuestions = control.match(questions)?.[1];
    assert.ok(controlQuestions);
    assert.equal(commercial.match(questions)?.[1], controlQuestions);
    const progress = commercial.match(/<section id="case-progress" data-progress-audience="public">([\s\S]*?)<\/details><\/section>/)?.[1];
    assert.ok(progress);
    assert.match(progress, /<li data-guidance-stage="1" data-state="partial">/);
    const commercialRows = stageOneRows(progress, "");
    assert.ok(commercialRows.includes(reason));
    assert.deepEqual(outputRows(commercialRows), []);

    const inquiry = await readable(await app.get(path + "/inquiry", cookie));
    const reported = inquiry.match(/<dl class="inquiry-fields">([\s\S]*?)<\/dl>/)?.[1];
    assert.ok(reported);
    const values = [...reported.matchAll(/<dt>([^<]*)<\/dt><dd>([\s\S]*?)<\/dd>/g)];
    assert.deepEqual(values.filter(([, name]) => name === `${label} (신고)`).map(([, , value]) => value), ["미상"]);

    assert.deepEqual(outputRows(rows), [`${prefix}미확보`]);
  });

  test(`native ${field} blank creation and empty edit store null and retain nonblank reported text`, async t => {
    const app = fixture(t, { actorForRequest: async () => guidanceActor });
    const { cookie } = await app.home();
    const blankPath = await created(await app.create(cookie, { [field]: "   " }));
    await assertStored(app, blankPath, cookie, 1, null);
    assert.deepEqual(outputRows(privateRows(await readable(await app.get(blankPath, cookie)))), [`${prefix}미확보`]);

    const path = await created(await app.create(cookie));
    assert.equal(await created(await app.edit(path, cookie, field, "")), path);
    await assertStored(app, path, cookie, 2, null);
    assert.deepEqual(outputRows(privateRows(await readable(await app.get(path, cookie)))), [`${prefix}미확보`]);

    for (const [index, value] of [`  ${fields[field]}  `, "미상", " 미상 "].entries()) {
      const version = index + 2;
      assert.equal(await created(await app.edit(path, cookie, field, value, version)), path);
      await assertStored(app, path, cookie, version + 1, value);
      for (const view of [path, path + "/report?purpose=research"]) {
        const rows = privateRows(await readable(await app.get(view, cookie)));
        assert.deepEqual(outputRows(rows), [prefix + value], view);
      }
    }
  });
}

for (const [polymer, process, description] of [
  ["고무", "사출", "QA 재현"],
  ["폐섬유", "사출", "QA 재현"],
  ["오니", "폐수처리", "폐수처리 오니"],
] as const) {
  test(`#108 ${polymer} is outside the four supported groups before evaluation`, async t => {
    const app = fixture(t);
    const { cookie } = await app.home();
    const result = await app.create(cookie, { polymer, process, description, massKg: "" });
    assert.equal(result.status, 422);
    const html = await result.text();
    assert.match(html, /지원 범위 밖 · 판정 없음/);
    assert.ok(html.includes("폐플라스틱·금속 스크랩·폐목재·포장재(종이·복합 포함)"));
    assert.equal(app.evaluations(), 0);
    assert.deepEqual(app.store.list(ownerFor(cookie)), []);
  });
}

test("#108 aluminum enters the supported engine and asks about its origin", async t => {
  const app = fixture(t);
  const { cookie } = await app.home();
  const path = await created(await app.create(cookie, { description: "QA 재현", polymer: "알루미늄", massKg: "" }));
  const html = await readable(await app.get(path, cookie));
  assert.match(html, /<h1>추가 정보 필요<\/h1>/);
  assert.ok(html.includes("사업장일반폐기물"));
  assert.doesNotMatch(html, /data-out-of-scope/);
});

for (const description of ["   ", ""]) {
  test(`case list labels a stored description of ${JSON.stringify(description)} with its case ID`, async t => {
    const app = fixture(t);
    const { cookie } = await app.home();
    const path = await created(await app.create(cookie));
    const edit = description === ""
      ? await app.fetch(new Request(origin + path + "/answers", {
        method: "POST", headers: { cookie, origin, "content-type": "application/json" },
        body: JSON.stringify({ baseVersion: 1, patch: { description } }),
      }))
      : await app.edit(path, cookie, "description", description);
    assert.equal(await created(edit), path);

    async function assertLinks(expected: string) {
      const html = await readable(await app.get("/cases", cookie));
      const anchors = [...html.matchAll(/<a href="([^"]+)">([\s\S]*?)<\/a>/g)];
      assert.deepEqual(anchors.filter(([, href]) => href === path).map(([, , label]) => label), [expected]);
      assert.deepEqual(anchors.filter(([, href]) => href === path + "/report").map(([, , label]) => label), ["보고서"]);
    }
    assert.equal((await exported(app, path, cookie)).description, description);
    await assertLinks(caseId(path));
    const restored = "  복구 <사례>  ";
    assert.equal(await created(await app.edit(path, cookie, "description", restored, 2)), path);
    assert.equal((await exported(app, path, cookie)).description, restored);
    await assertLinks("  복구 &lt;사례&gt;  ");
  });
}

test("refresh at 55 minutes reuses the token for its remaining five minutes", async t => {
  const app = fixture(t);
  const initial = await app.home();
  assert.equal(initial.maxAge, "3600");
  app.setTime(at(55));
  assert.deepEqual(await app.home(initial.cookie), { ...initial, maxAge: "300" });
});

for (const name of ["normal", "held", "review"]) {
  test(`public demo ${name} stays readable when the anonymous cookie expires during rendering`, async t => {
    const app = fixture(t);
    const { cookie } = await app.home();
    const path = `/demo/${name}`;
    const publicHtml = await readable(await app.get(path));
    app.setTime(at(60) - 1);
    const pending = app.get(path, cookie);
    // The handler has looked up the cookie and is awaiting the synthetic demo.
    app.setTime(at(60) + 1);
    const result = await pending;
    assert.equal(result.status, 200);
    assert.equal(await result.text(), publicHtml);
  });
}

test("late anonymous detail and list show the session deadline while storage retains its own deadlines", async t => {
  const app = fixture(t);
  const { cookie } = await app.home();
  app.setTime(at(55));
  const path = await created(await app.create(cookie));
  const row = app.store.read(ownerFor(cookie), caseId(path));
  assert.deepEqual([row?.editUntil, row?.expires], [at(85), at(115)]);
  const detail = await readable(await app.get(path, cookie));
  const list = await readable(await app.get("/cases", cookie));
  assert.deepEqual([
    detail.match(/수정 가능 기한 \(UTC\): ([^<]+)/)?.[1],
    list.match(/<th>([^<]+ \(UTC\))<\/th>/)?.[1],
    list.match(/<td data-label="([^"]+ \(UTC\))">([^<]+)/)?.slice(1),
  ], [utc(60), "조회 가능 기한 (UTC)", ["조회 가능 기한 (UTC)", utc(60)]]);
});

test("anonymous read and edit controls include the last session instant, then isolate the replacement session", async t => {
  const app = fixture(t);
  const { cookie } = await app.home();
  app.setTime(at(55));
  const path = await created(await app.create(cookie));
  const paths = [path, path + "/report", path + "/input", "/cases"];
  app.setTime(at(60));
  const last = await Promise.all(paths.map(p => app.get(p, cookie)));
  assert.deepEqual(last.map(result => result.status), [200, 200, 200, 200]);
  assert.match(await last[0]!.text(), /action="[^"]+\/answers"/);
  assert.equal(await created(await app.edit(path, cookie, "polymer", "PP")), path);
  app.setTime(at(60) + 1);
  for (const p of paths) assert.equal((await app.get(p, cookie)).status, 403, p);
  const replacement = await app.home(cookie);
  assert.notEqual(replacement.cookie, cookie);
  assert.match(await readable(await app.get("/cases", replacement.cookie)), /저장된 사례가 없습니다\./);
  assert.equal((await app.get(path, replacement.cookie)).status, 404);
});

test("anonymous case reads cannot return bytes after the session expires during the request", async t => {
  let expireAtResponse = false;
  const app = fixture(t, { checkRequest: () => {
    if (expireAtResponse) app.setTime(at(60) + 1);
  } });
  const { cookie } = await app.home();
  app.setTime(at(55));
  const path = await created(await app.create(cookie));
  expireAtResponse = true;
  for (const route of ["/cases", path, path + "/input", path + "/report"]) {
    app.setTime(at(60) - 1);
    const result = await app.get(route, cookie);
    assert.equal(result.status, 403, route);
    assert.ok(!(await result.text()).includes(fields.description), route);
  }
});

test("an early anonymous case stops editing at its stored cutoff while it remains readable", async t => {
  const app = fixture(t);
  const { cookie } = await app.home();
  const path = await created(await app.create(cookie));
  app.setTime(at(30) - 1);
  const editable = await readable(await app.get(path, cookie));
  assert.equal(editable.match(/수정 가능 기한 \(UTC\): ([^<]+)/)?.[1], utc(30));
  app.setTime(at(30));
  assert.doesNotMatch(await readable(await app.get(path, cookie)), /action="[^"]+\/answers"/);
  assert.equal((await app.edit(path, cookie, "polymer", "PP")).status, 404);
});

test("an actor retains case deadlines with a shorter credential and an anonymous cookie", async t => {
  const app = fixture(t, { actorForRequest: async () => ({ actorId: "synthetic-owner", validUntil: at(65) }) });
  const { cookie } = await app.home();
  app.setTime(at(55));
  const path = await created(await app.create(cookie));
  assert.equal((await readable(await app.get(path, cookie))).match(/수정 가능 기한 \(UTC\): ([^<]+)/)?.[1], utc(85));
  assert.ok((await readable(await app.get("/cases", cookie))).includes(`<td data-label="보관 만료 (UTC)">${utc(115)}</td>`));
  app.setTime(at(60) + 1);
  assert.equal((await app.get(path + "/input", cookie)).status, 200);
  app.setTime(at(65));
  assert.equal((await app.get(path, cookie)).status, 403);
});

test("an anonymous edit suspended in evaluation cannot commit after session expiry", async t => {
  const app = fixture(t);
  const { cookie } = await app.home();
  app.setTime(at(55));
  const path = await created(await app.create(cookie));
  const before = app.store.read(ownerFor(cookie), caseId(path));
  const entered = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  app.beforeEvaluate(async () => { entered.resolve(); await resume.promise; });
  app.setTime(at(60) - 1);
  const pending = app.edit(path, cookie, "description", "만료 직전 합성 수정");
  await Promise.race([entered.promise, pending.then(result => assert.fail(`Edit returned ${result.status} before evaluation`))]);
  app.setTime(at(60) + 1);
  resume.resolve();
  assert.deepEqual([(await pending).status, app.store.read(ownerFor(cookie), caseId(path))], [403, before]);
});

test("an anonymous edit whose body arrives after expiry never enters evaluation", async t => {
  const app = fixture(t);
  const { cookie } = await app.home();
  app.setTime(at(55));
  const path = await created(await app.create(cookie));
  const pulled = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const body = new ReadableStream({
    async pull(controller) {
      pulled.resolve();
      await resume.promise;
      controller.enqueue(new TextEncoder().encode("baseVersion=1&answerMode=fields&field_polymer=PP"));
      controller.close();
    },
  });
  app.setTime(at(60) - 1);
  const request = new Request(origin + path + "/answers", { method: "POST", body,
    headers: { cookie, origin, "content-type": "application/x-www-form-urlencoded" } });
  const pending = app.fetch(request);
  await Promise.race([pulled.promise, pending.then(result => assert.fail(`Edit returned ${result.status} before reading its body`))]);
  app.setTime(at(60) + 1);
  resume.resolve();
  assert.deepEqual([(await pending).status, app.evaluations()], [403, 1]);
});

for (const [bare, polymer] of [
  ["PA", "PA (glass fiber reinforced)"], ["PC", "PC (glass fiber reinforced)"],
  ["PA", "pa (GLASS FIBER REINFORCED)"], ["PP", "PP (glass fiber reinforced)"],
  ["PA", "PA (유리섬유 보강)"], ["PC", "PC (유리섬유 보강)"],
] as const) {
  test(`native creation preserves ${polymer}`, async t => {
    const app = fixture(t);
    const { cookie } = await app.home();
    const path = await created(await app.create(cookie, { polymer }));
    assert.equal((await exported(app, path, cookie)).polymer, polymer);
  });

  test(`native edit from ${bare} preserves ${polymer} at version 2`, async t => {
    const app = fixture(t);
    const { cookie } = await app.home();
    const path = await created(await app.create(cookie, { polymer: bare }));
    assert.equal(await created(await app.edit(path, cookie, "polymer", polymer)), path);
    assert.match(await readable(await app.get(path, cookie)), /<p>버전 2<\/p>/);
    assert.equal((await app.get(path + "/report", cookie)).status, 200);
    assert.equal((await exported(app, path, cookie)).polymer, polymer);
  });
}

const paperLabel = "종이 라벨이 붙은 사출 용기 파쇄품";
async function assertMissingResin(app: ReturnType<typeof fixture>, path: string, cookie: string, version: number) {
  const detail = await readable(await app.get(path, cookie));
  assert.match(detail, /<h1>추가 정보 필요<\/h1>/);
  assert.ok(detail.includes("확인된 재질·품목과 이를 확인한 자료(라벨·재질 명세·발생 이력 등)가 있나요?"));
  assert.ok(detail.includes(`<p>버전 ${version}</p>`));
}

for (const description of [fields.description, paperLabel, "PC 하우징 파쇄품, 금속 나사 제거", "하우징 파쇄품, 금속 나사 제거"]) {
  test(`blank resin stays missing for ${description}`, async t => {
    const app = fixture(t);
    const { cookie } = await app.home();
    const path = await created(await app.create(cookie, { polymer: "", description }));
    await assertMissingResin(app, path, cookie, 1);
    const input = await exported(app, path, cookie);
    assert.deepEqual([input.polymer, input.description], [null, description]);
  });
}

test("native edit saves the exact paper-label description without inferring resin", async t => {
  const app = fixture(t);
  const { cookie } = await app.home();
  const path = await created(await app.create(cookie, { polymer: "" }));
  assert.equal(await created(await app.edit(path, cookie, "description", paperLabel)), path);
  await assertMissingResin(app, path, cookie, 2);
  const input = await exported(app, path, cookie);
  assert.deepEqual([input.polymer, input.description], [null, paperLabel]);
});

test("an explicit unknown stays unknown with a removed screw in the description", async t => {
  const app = fixture(t);
  const { cookie } = await app.home();
  const path = await created(await app.create(cookie, { polymer: "미상", description: "PC 하우징 파쇄품, 금속 나사 제거" }));
  assert.equal((await exported(app, path, cookie)).polymer, "미상");
  assert.doesNotMatch(await readable(await app.get(path, cookie)), /기계적 재활용 추천/);
});

for (const [polymer, description, material] of [
  ["glass", "공정에서 PC 장비 사용", "유리"], ["폐유리", fields.description, "유리"],
  ["PCELL (glass fiber reinforced)", fields.description, "유리"], ["glass PC", fields.description, "유리"],
  ["", "glass, PC 장비에서 발견", "유리"], ["", "폐유리", "유리"],
  ["", "폐지 종이 재단 부산물", "종이"], ["", "금속 나사", "금속"],
  ["", "종이 라벨이 붙은 유리 용기 파쇄품", "유리"],
  ["", "종이 라벨이 붙은 종이 용기 파쇄품", "종이"],
  ["", "종이 라벨이 붙은 판재", "종이"], ["", "금속 나사 제거", "금속"],
  ["", "하우징 파쇄품, 금속 나사 제거 예정", "금속"],
  ["금속", "하우징 파쇄품, 금속 나사 제거", "금속"],
] as const) test(`native scope preserves the reported ${material} input for ${polymer || description}`, async t => {
  const app = fixture(t);
  const { cookie } = await app.home();
  const result = await app.create(cookie, { polymer, description });
  if (material === "유리") {
    assert.equal(result.status, 422);
    assert.ok((await result.text()).includes(`입력에 ${material} 재질`));
    assert.deepEqual(app.store.list(ownerFor(cookie)), []);
    assert.equal(app.evaluations(), 0);
  } else {
    const path = await created(result);
    const input = await exported(app, path, cookie);
    assert.deepEqual([input.polymer, input.description], [polymer || null, description]);
    assert.equal(app.evaluations(), 1);
    assert.doesNotMatch(await readable(await app.get(path, cookie)), /data-out-of-scope/);
  }
});

test("rejected native material edit preserves the entire snapshot and skips evaluation", async t => {
  const app = fixture(t);
  const { cookie } = await app.home();
  const path = await created(await app.create(cookie, { polymer: "PA" }));
  const before = app.store.read(ownerFor(cookie), caseId(path));
  const evaluations = app.evaluations();
  const result = await app.edit(path, cookie, "polymer", "glass");
  assert.equal(result.status, 422);
  assert.match(await result.text(), /입력에 유리 재질/);
  assert.deepEqual(app.store.read(ownerFor(cookie), caseId(path)), before);
  assert.equal(app.evaluations(), evaluations);
});

const designatedDenials = ["지정폐기물 해당 사항 없음", "지정폐기물 해당사항 없음", "지정폐기물 가능성 없음",
  "지정폐기물 의심 없음", "지정폐기물\t 가능성\t 없음.  "];
const contactDenial = "유해물질 접촉 의심 없음";
const decide = (patch: Partial<CaseInput>) => createResourceDomain({ ...facts, ...patch }).decide();

function recommendation(result: DecisionResult) {
  assert.equal(result.state, "compared");
  return result.recommendations?.map(({ routeId, grade }) => ({ routeId, grade }));
}

for (const denial of designatedDenials) test(`complete PET retains its conditional recommendation with ${JSON.stringify(denial)}`, async () => {
  const prefix = `${facts.description}, `;
  const control = recommendation(await decide({ description: prefix + "지정폐기물 해당 없음" }));
  assert.deepEqual(control, [{ routeId: "mechanical-recycling", grade: "public-conditional" }]);
  assert.deepEqual(recommendation(await decide({ description: prefix + denial })), control);
});

test("the contact denial drops the suspicion reason while evidence lookup still sees the original contamination", async () => {
  const input = { ...facts, contamination: contactDenial };
  const domain = createResourceDomain(input);
  const legal = domain.assess().legal;
  assert.deepEqual(legal, lookupLegalEvidence(input));
  const recyclingCode = (id: string) => id.endsWith("-annex4-code");
  assert.ok(lookupLegalEvidence(facts).citations.some(citation => recyclingCode(citation.sourceId)));
  assert.ok(legal.issues.some(issue => issue.kind === "context-ambiguous" && issue.sourceId && recyclingCode(issue.sourceId)));
  assert.ok(!legal.citations.some(citation => recyclingCode(citation.sourceId)));
  const result = await domain.decide();
  const reasons = result.state === "needs-review" ? result.reasons : [];
  assert.ok(!reasons.includes(safetyReasons.contactSuspected));
});

for (const denial of [...designatedDenials, contactDenial]) test(`missing resin retains ordinary alternatives with ${JSON.stringify(denial)}`, async () => {
  const control = await decide({ polymer: null });
  assert.equal(control.state, "needs-information");
  assert.ok(control.questions.includes(resinQuestion));
  const routeIds = control.conditionalAlternatives?.map(alt => alt.routeId);
  assert.deepEqual(routeIds, ["mechanical-recycling", "other-recovery", "disposal"]);
  const result = await decide({ polymer: null, description: denial });
  const alternatives = result.state === "compared" ? undefined : result.conditionalAlternatives;
  assert.deepEqual(alternatives?.map(alt => alt.routeId), routeIds);
  assert.ok(alternatives?.every(alt => alt.state === "informational" && alt.condition.code !== "hazard-classification"));
  assert.equal(result.state, "needs-information");
  assert.deepEqual(result.questions, control.questions);
});

for (const [description, reason, hazardAlternatives] of [
  ["지정폐기물 의심", safetyReasons.designatedSuspected, true],
  ["지정폐기물 가능성 있음", safetyReasons.designatedSuspected, true],
  ["유해물질 접촉 의심", safetyReasons.contactSuspected, true],
  ["유해물질 접촉 있음", safetyReasons.contactSuspected, false],
  ["confirmed hazardous waste", safetyReasons.designatedSuspected, true],
  ["suspected hazardous contact", safetyReasons.contactSuspected, true],
] as const) test(`affirmative ${description} retains the safety hold`, async () => {
  const result = await decide({ description });
  assert.equal(result.state, "needs-review");
  assert.ok(result.reasons.includes(reason));
  assert.ok(!("recommendations" in result));
  if (hazardAlternatives) assert.deepEqual(result.conditionalAlternatives?.map(alt => [alt.routeId, alt.condition.code]),
    [["disposal", "hazard-classification"]]);
});

for (const [name, patch] of [
  ["affirmative before denial", { description: "지정폐기물 의심, 지정폐기물 의심 없음" }],
  ["denial before affirmative", { description: "지정폐기물 의심 없음, 지정폐기물 의심" }],
  ["affirmative description and denial process", { description: "지정폐기물 의심", process: "지정폐기물 의심 없음" }],
  ["denial description and affirmative process", { description: "지정폐기물 의심 없음", process: "지정폐기물 의심" }],
  ["denial split across fields", { description: "지정폐기물 의심", process: "없음" }],
  ["applicability split from a bare denial", { description: "지정폐기물 해당", process: "없음" }],
  ["qualified denial", { description: "지정폐기물 의심 없음으로 단정할 수 없음" }],
  ["denial framed as a question", { description: "지정폐기물 의심 없음?" }],
  ["continued assertion", { description: "지정폐기물 의심 없음, 추가 검토 필요" }],
] as const) test(`${name} retains the designated-waste suspicion reason`, async () => {
  const result = await decide(patch);
  assert.equal(result.state, "needs-review");
  assert.ok(result.reasons.includes(safetyReasons.designatedSuspected));
});

test("structured hazardous contact still triggers classification despite a denial", async () => {
  const result = await decide({ description: contactDenial, hazardousContact: "yes" });
  assert.equal(result.state, "needs-review");
  assert.ok(result.reasons.includes(safetyReasons.contactClassification));
  assert.deepEqual(result.conditionalAlternatives?.map(alt => [alt.routeId, alt.condition.code]), [["disposal", "hazard-classification"]]);
});

test("a denial does not answer the structured contact question", async () => {
  const result = await decide({ description: contactDenial, hazardousContact: "unknown" });
  assert.equal(result.state, "needs-information");
  assert.ok(result.questions.includes(safetyReasons.contactUnknown));
});

test("ambiguous visual inspection still prompts the contamination question", async () => {
  const result = await decide({ contamination: "육안 검사 결과 이물질 확인되지 않음" });
  assert.equal(result.state, "needs-information");
  assert.ok(result.questions.includes(safetyReasons.contaminationUnknown));
});
