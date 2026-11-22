import assert from "node:assert/strict";
import { test } from "node:test";
import type { CaseInput } from "../src/contracts.ts";
import { createResourceDomain } from "../src/domain.ts";
import { lookupLegalEvidence } from "../src/evidence.ts";
import { createApp } from "../src/app.ts";
import { createSyntheticAssessmentAdapter as createAssessmentAdapter } from "./synthetic-runtime.ts";
import { createCaseStore } from "../src/o-case-store.ts";

const input: CaseInput = { caseId: "synthetic-111", description: "사출 스크랩", process: "사출",
  polymer: "PP", contamination: "없음", hazardousContact: "no", massKg: null, region: "울산",
  assessmentDate: "2026-11-25", photoRefs: [] };

for (const [bare, aliases] of [
  ["PP", ["pp", "폴리프로필렌", "PP(폴리프로필렌)", "PP (폴리프로필렌)", "폴리프로필렌(PP)", "Polypropylene", "ＰＰ", "단일 PP (다층 아님)", "PP non-mixed"]],
  ["PET", ["PET(폴리에틸렌테레프탈레이트)", "polyethylene terephthalate"]],
  ["HDPE", ["HDPE(고밀도 폴리에틸렌)", "high density polyethylene"]],
] as const) {
  for (const polymer of aliases) test(`#111 ${polymer} has the same conditional recommendation as ${bare}`, async () => {
    const facts = { ...input, polymer };
    const before = structuredClone(facts);
    const control = await createResourceDomain({ ...input, polymer: bare }).decide();
    assert.equal(control.state, "compared");
    const decision = await createResourceDomain(facts).decide();
    assert.deepEqual(decision, control);
    assert.deepEqual(facts, before);
  });
}

for (const [bare, korean, english] of [
  ["PP", "폴리프로필렌", "polypropylene"],
  ["PE", "폴리에틸렌", "polyethylene"],
  ["PET", "폴리에틸렌테레프탈레이트", "polyethylene terephthalate"],
  ["HDPE", "고밀도 폴리에틸렌", "high density polyethylene"],
  ["LDPE", "저밀도 폴리에틸렌", "low density polyethylene"],
  ["PS", "폴리스티렌", "polystyrene"],
  ["EPS", "발포 폴리스티렌", "expanded polystyrene"],
  ["PVC", "폴리염화비닐", "polyvinyl chloride"],
  ["ABS", "아크릴로니트릴부타디엔스티렌", "acrylonitrile butadiene styrene"],
  ["PA", "폴리아미드", "polyamide"],
  ["PC", "폴리카보네이트", "polycarbonate"],
] as const) {
  for (const polymer of [korean, english, bare.toLowerCase(), `${bare} (${korean})`, `${english}(${bare})`]) {
    test(`#111 recognized resin ${polymer} retains ${bare} evidence and questions`, async () => {
      const control = createResourceDomain({ ...input, polymer: bare });
      const domain = createResourceDomain({ ...input, polymer });
      assert.deepEqual(domain.assess().questions, control.assess().questions);
      assert.deepEqual(domain.assess().legal, control.assess().legal);
      assert.deepEqual(await domain.decide(), await control.decide());
    });
  }
}

for (const [polymer, patch, code] of [
  ["steel(철)", { process: "사업장일반폐기물 금속 절단" }, "51-29-01"],
  ["nonferrous scrap(비철금속)", { process: "사업장일반폐기물 금속 절단" }, "51-29-02"],
  ["aluminium(알루미늄)", { process: "사업장일반폐기물 금속 절단" }, "51-29-02"],
  ["copper(구리)", { process: "사업장일반폐기물 금속 절단" }, "51-29-02"],
  ["untreated wood(무처리 원목)", { process: "사업장일반폐기물 원목 제재" }, "51-20-22"],
  ["sawdust(톱밥)", { process: "사업장일반폐기물 무처리 원목 제재" }, "51-20-22"],
  ["wood packaging(목재 포장재)", { process: "사업장일반폐기물 무처리 포장재 사용" }, "51-20-23"],
  ["paper(종이)", { process: "사업장일반폐기물 포장재 사용", description: "무코팅 종이" }, "51-28-02"],
  ["cardboard(골판지)", { process: "사업장일반폐기물 포장재 사용", description: "무코팅 골판지" }, "51-28-02"],
  ["beverage carton(종이팩)", { process: "사업장일반폐기물 음료 포장재 사용", description: "PE 복합층" }, "51-28-01"],
] satisfies readonly (readonly [string, Partial<CaseInput>, string])[]) {
  test(`#111 ${polymer} uses the existing stream and its own evidence`, async () => {
    const facts = { ...input, ...patch, polymer };
    const lookup = lookupLegalEvidence(facts);
    assert.ok(lookup.citations.some(citation => citation.kind === "waste-code" && citation.claim.includes(code)));
    assert.ok(!lookup.citations.some(citation => citation.claim.includes("51-03-01")));
    assert.equal((await createResourceDomain(facts).decide()).state, "compared");
    const held = await createResourceDomain({ ...facts, hazardousContact: "yes" }).decide();
    assert.equal(held.state, "needs-review");
  });
}

for (const polymer of ["PP(PE)", "PP(미확인)", "PP 코팅", "PP (glass fiber reinforced)", "PA (유리섬유 보강)",
  "알 수 없는 새 재질", "wood", "목재", "carton", "packaging", "복합 포장재", "무코팅 종이(PP)", "wood(untreated wood)"]) {
  test(`#111 ambiguous ${polymer} asks without guessing a clean material code`, async () => {
    const facts = { ...input, polymer };
    const decision = await createResourceDomain(facts).decide();
    assert.equal(decision.state, "needs-information");
    assert.ok(decision.questions.length > 0);
    assert.ok(!lookupLegalEvidence(facts).citations.some(citation => citation.kind === "waste-code"));
  });
}

for (const field of ["process", "polymer", "region"] as const) {
  test(`#111 NFKC unknown ${field} uses the #107 questions without changing raw values`, async () => {
    const facts = { ...input, [field]: "ｕｎｋｎｏｗｎ" };
    const control = await createResourceDomain({ ...input, [field]: null }).decide();
    assert.equal(control.state, "needs-information");
    const actual = await createResourceDomain(facts).decide();
    assert.equal(actual.state, "needs-information");
    assert.deepEqual(actual.questions, control.questions);
    assert.equal(facts[field], "ｕｎｋｎｏｗｎ");
  });
}

test("#111 native submit, edit and read accept aliases and preserve raw notation", async t => {
  const origin = "http://localhost:3000";
  const store = createCaseStore();
  const adapter = createAssessmentAdapter();
  const app = createApp({ origin, caseStore: store, preparer: {
    prepareSubmit: adapter.prepareSubmit, prepareAnswer: adapter.prepareAnswer,
    async evaluate(facts) { return { decision: await createResourceDomain(facts).decide() }; },
  } });
  t.after(async () => { app.dispose(); await app.settled(); adapter.dispose(); store.dispose(); });
  const home = await app(new Request(origin));
  const cookie = home.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  const get = (path: string) => app(new Request(origin + path, { headers: { cookie } }));
  const post = (path: string, body: Record<string, string>) => app(new Request(origin + path, {
    method: "POST", headers: { origin, cookie }, body: new URLSearchParams(body),
  }));
  const created = await post("/cases", { description: input.description, process: "사출", polymer: "ＰＰ",
    contamination: "없음", hazardousContact: "no", region: "울산", assessmentDate: input.assessmentDate, massKg: "" });
  assert.equal(created.status, 303);
  const path = created.headers.get("location");
  assert.ok(path);
  assert.match(await (await get(path)).text(), /<h1>기계적 재활용 추천<\/h1>/);
  for (const [index, polymer] of ["PP(폴리프로필렌)", "PP(미확인)", "신규 미확인 기호"].entries()) {
    assert.equal((await post(path + "/answers", { baseVersion: String(index + 1), answerMode: "fields", field_polymer: polymer })).status, 303);
    const detail: Response = await get(path);
    assert.equal(detail.status, 200);
    assert.match(await detail.text(), index === 0 ? /<h1>기계적 재활용 추천<\/h1>/ : /<h1>추가 정보 필요<\/h1>/);
    const exported: CaseInput = await (await get(path + "/input")).json();
    assert.equal(exported.polymer, polymer);
  }
  assert.equal((await post(path + "/answers", { baseVersion: "4", answerMode: "fields", field_polymer: "glass PC" })).status, 422);
});
