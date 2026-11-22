import assert from "node:assert/strict";
import { test } from "node:test";
import type { CaseInput } from "../src/contracts.ts";
import { createResourceDomain } from "../src/domain.ts";
import { materialHazardTerms } from "../src/material-context.ts";
import { buildCaseGuidance } from "../src/o-case-guidance.ts";
import { safetyReasons } from "../src/o-safety-reasons.ts";
import { renderReport } from "../src/report.ts";
import { createResourceApp } from "../src/session.ts";

const base: CaseInput = {
  caseId: "material-communication", description: "구리 절단 스크랩", photoRefs: [],
  process: "사업장일반폐기물 금속 절단", polymer: "구리", contamination: "없음",
  hazardousContact: "no", massKg: 180, region: "경기", assessmentDate: "2026-11-22",
};

for (const [description, contamination, expected] of [
  ["구리 절단편, 납 검출, 도금 있음", "납·도금 없음", ["납", "도금"]],
  ["구리 절단편, 납 없음, 도금 있음", "없음", ["도금"]],
  ["구리 절단편, 도금 있음, 납 없음", "없음", ["도금"]],
  ["무도금 구리판 절단편", "납 없음", []],
  ["무도금 구리판 절단편", "도금 있음", ["도금"]],
  ["납품용 수납 부품의 납작한 구리 조각", "없음", []],
  ["구리 절단편, 얼룩 없음, 끈적한 막", "없음", []],
  ["구리 절단편, <img src=x onerror=alert(1)>납 검출", "없음", ["납"]],
  ["구리 절단편, ＰＣＢ 함유", "없음", ["PCB"]],
] as const) {
  test(`detected expressions follow the actual field-local hazard scan: ${description}`, async () => {
    const input = { ...base, description, contamination };
    const original = structuredClone(input);
    const result = await createResourceDomain(input).decide();
    const decision = structuredClone(result);
    const terms: string[] = [];
    let injectedImages = 0, reasons = "";
    await new HTMLRewriter()
      .on(".detected-hazard-terms", { text(chunk) { terms.push(chunk.text); } })
      .on("#case-reasons", { text(chunk) { reasons += chunk.text; } })
      .on("#case-reasons img", { element() { injectedImages++; } })
      .transform(new Response(renderReport(result, { mode: "offline" }, { audience: "commercial" },
        { evaluatedInput: input }))).text();
    assert.deepEqual(materialHazardTerms(input), expected);
    assert.equal(terms.length > 0, expected.length > 0);
    for (const term of expected) assert.ok(terms.join("").includes(term));
    if (expected.length) {
      assert.equal(result.state, "needs-review");
      assert.ok(reasons.includes(safetyReasons.materialTreatment));
    }
    assert.equal(injectedImages, 0);
    assert.deepEqual(input, original);
    assert.deepEqual(result, decision);
  });
}

test("reports without evaluated input and historical reports do not infer detected expressions", async () => {
  const input = { ...base, description: "구리 스크랩, 납 검출" };
  const result = await createResourceDomain(input).decide();
  for (const [presentation, view] of [
    [{ mode: "offline" }, {}],
    [{ mode: "offline", historical: true }, { evaluatedInput: { ...input, description: "도금 있음" } }],
  ] as const) {
    let terms = 0, reasons = "";
    await new HTMLRewriter().on(".detected-hazard-terms", { element() { terms++; } })
      .on("#case-reasons", { text(chunk) { reasons += chunk.text; } })
      .transform(new Response(renderReport(result, presentation, { audience: "commercial" }, view))).text();
    assert.equal(terms, 0);
    assert.ok(reasons.includes(safetyReasons.materialTreatment));
  }
});

for (const [polymer, description, process] of [
  ["구리", "구리 스크랩", "사업장일반폐기물 금속 절단"],
  ["무처리 폐목재", "무처리 원목 자투리", "사업장일반폐기물 원목 제재 가공 부산물"],
  ["무코팅 골판지", "무코팅 골판지 상자", "사업장일반폐기물 제품 포장"],
] as const) {
  test(`shared checks and guidance use Korean material wording for ${polymer}`, async () => {
    const input = { ...base, polymer, description, process };
    const result = await createResourceDomain(input).decide();
    assert.equal(result.state, "compared");
    const guidance = await buildCaseGuidance(input, result);
    const before = structuredClone({ result, guidance });
    let text = "";
    await new HTMLRewriter().on("#checks, #case-progress", { text(chunk) { text += chunk.text; } })
      .transform(new Response(renderReport(result, { mode: "offline" }, {
        audience: "authenticated-research", research: null, guidance,
      }))).text();
    assert.doesNotMatch(text, /\b(?:unknown|strict|guidance)\b/u);
    assert.doesNotMatch(text, /해당 수지|계수의 수지/u);
    assert.ok(text.includes("재질·품목"));
    assert.deepEqual({ result, guidance }, before);
  });
}

test("native detail and commercial report show only evaluated positive terms and preserve exported input", async () => {
  const origin = "http://localhost:3000";
  const app = createResourceApp({ origin });
  try {
    const home = await app.fetch(new Request(origin));
    const cookie = home.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    const fields = { description: "구리 스크랩, 납 없음, 도금 있음", process: base.process ?? "",
      polymer: "구리", contamination: "납·도금 없음", hazardousContact: "no",
      massKg: "180", region: "경기", assessmentDate: base.assessmentDate };
    const created = await app.fetch(new Request(origin + "/cases", { method: "POST",
      headers: { origin, cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields) }));
    assert.equal(created.status, 303);
    const path = created.headers.get("location");
    assert.ok(path);
    const exported = await (await app.fetch(new Request(origin + path + "/input", { headers: { cookie } }))).json();
    for (const suffix of ["", "/report"]) {
      let terms = "", label = "";
      await new HTMLRewriter().on(".detected-hazard-terms", { text(chunk) { terms += chunk.text; } })
        .on('label[for="field_polymer"]', { text(chunk) { label += chunk.text; } })
        .transform(await app.fetch(new Request(origin + path + suffix, { headers: { cookie } }))).text();
      assert.ok(terms.includes("도금"));
      assert.equal(terms.includes("납"), false);
      if (suffix === "") assert.ok(label.includes("재질·품목"));
    }
    assert.deepEqual(exported, { ...fields, caseId: path.split("/").at(-1), massKg: 180, photoRefs: [] });
  } finally { await app.close(); }
});
