import assert from "node:assert/strict";
import { test } from "node:test";
import type { CaseInput } from "../src/contracts.ts";
import { createResourceDomain } from "../src/domain.ts";
import { materialHazardTerms } from "../src/material-context.ts";
import { createLocalAuth } from "../src/o-auth.ts";
import { buildCaseGuidance } from "../src/o-case-guidance.ts";
import { createCaseStore } from "../src/o-case-store.ts";
import { createMemoryRuntimeDatabase } from "../src/o-runtime-db.ts";
import { safetyReasons } from "../src/o-safety-reasons.ts";
import { renderReport } from "../src/report.ts";
import { createSyntheticResourceApp } from "./synthetic-runtime.ts";

const base: CaseInput = {
  caseId: "material-communication", description: "구리 절단 스크랩", photoRefs: [],
  process: "사업장일반폐기물 금속 절단", polymer: "구리", contamination: "없음",
  hazardousContact: "no", massKg: 180, region: "경기", assessmentDate: "2026-11-22",
};

function assertDetectedTerms(html: string, expected: readonly string[], view = ""): void {
  const paragraphs = [...html.matchAll(/<p class="detected-hazard-terms">([\s\S]*?)<\/p>/gu)].map(match => match[1]);
  assert.deepEqual(paragraphs, expected.length
    ? [`입력에서 감지한 표현: ${expected.join(" · ")}. 해당 물질·처리 이력의 확인 자료가 필요합니다.`]
    : [], view);
}

for (const [description, contamination, expected, state] of [
  ["구리 절단편, 납 검출, 도금 있음", "납·도금 없음", ["납", "도금"], "needs-review"],
  ["구리 절단편, 납 없음, 도금 있음", "없음", ["도금"], "needs-review"],
  ["구리 절단편, 도금 있음, 납 없음", "없음", ["도금"], "needs-review"],
  ["무도금 구리판 절단편", "납 없음", [], "compared"],
  ["납품용 수납 부품의 납작한 구리 조각", "없음", [], "compared"],
  ["구리 절단편, 얼룩 없음, 끈적한 막", "없음", [], "needs-information"],
  ["구리 절단편, <img src=x onerror=alert(1)>납 검출", "없음", ["납"], "needs-review"],
  ["구리 절단편, ＰＣＢ 함유", "없음", ["PCB"], "needs-review"],
] as const) {
  test(`detected expressions follow the actual field-local hazard scan: ${description}`, async () => {
    const input = { ...base, description, contamination };
    const original = structuredClone(input);
    const result = await createResourceDomain(input).decide();
    const decision = structuredClone(result);
    const html = renderReport(result, { mode: "offline" }, { audience: "commercial" }, { evaluatedInput: input });
    let injectedImages = 0, reasons = "";
    await new HTMLRewriter()
      .on("#case-reasons", { text(chunk) { reasons += chunk.text; } })
      .on("#case-reasons img", { element() { injectedImages++; } })
      .transform(new Response(html)).text();
    assert.deepEqual(materialHazardTerms(input), expected);
    assertDetectedTerms(html, expected);
    assert.equal(result.state, state);
    assert.equal(reasons.includes(safetyReasons.materialTreatment), state === "needs-review");
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

const unplated = "무도금 구리판 절단편";
for (const [description, contamination, expected, state] of [
  ["구리 스크랩, 납 없음, 도금 있음", "납·도금 없음", ["도금"], "needs-review"],
  [unplated, "페인트 있음", ["페인트"], "needs-review"],
  [unplated, "코팅 있음", [], "needs-review"],
  [unplated, "PP 코팅 있음", [], "needs-review"],
  [unplated, "도금 있음", ["도금"], "needs-review"],
  [unplated, "페인트 있음, 납 검출", ["페인트", "납"], "needs-review"],
  ["구리판 절단편", "코팅 있음", [], "needs-information"],
  [unplated, "없음", [], "compared"],
] as const) {
  test(`signed-in form preserves terms, state and input: ${description} / ${contamination}`, async () => {
    const origin = "http://localhost:3000";
    const db = createMemoryRuntimeDatabase();
    const localAuth = createLocalAuth(db, { origin });
    const caseStore = createCaseStore(Date.now, undefined, db);
    const app = createSyntheticResourceApp({ origin, localAuth, caseStore, presentationMode: "offline" });
    const fields = { description, contamination, polymer: "구리",
      process: state === "compared" ? "사업장일반폐기물 metal recycling & <batch>" : base.process ?? "",
      hazardousContact: "no" as const, massKg: "180", region: "경기", assessmentDate: base.assessmentDate };
    try {
      const username = "operator", password = "material communication test password";
      const { actorId } = await localAuth.create(username, password);
      const postForm = (path: string, values: Record<string, string>, cookie?: string) => app.fetch(new Request(origin + path, {
        method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) },
        body: new URLSearchParams(values),
      }));
      const login = await postForm("/login", { username, password });
      assert.equal(login.status, 303);
      const cookie = login.headers.get("set-cookie")?.split(";")[0];
      assert.ok(cookie);
      const created = await postForm("/cases", fields, cookie);
      assert.equal(created.status, 303);
      const path = created.headers.get("location");
      assert.ok(path);
      const caseId = path.split("/").at(-1);
      assert.ok(caseId);
      const get = async (suffix: string) => {
        const response = await app.fetch(new Request(origin + path + suffix, { headers: { cookie } }));
        assert.equal(response.status, 200, suffix);
        return response;
      };
      const exported = { ...fields, caseId, massKg: 180, photoRefs: [] };
      assert.deepEqual(await (await get("/input")).json(), exported);
      const decision = caseStore.read(`actor:${actorId}`, caseId)?.assessment.decision;
      assert.equal(decision?.state, state);
      assert.equal(decision.state === "needs-review" && decision.reasons.includes(safetyReasons.materialTreatment),
        state === "needs-review");

      const detail = await (await get("")).text();
      const commercial = await (await get("/report")).text();
      const research = await (await get("/report?purpose=research")).text();
      let label = "";
      await new HTMLRewriter().on('label[for="field_polymer"]', { text(chunk) { label += chunk.text; } })
        .transform(new Response(detail)).text();
      assert.ok(label.includes("재질·품목"));
      for (const [view, html] of [["detail", detail], ["commercial", commercial], ["research", research]] as const) {
        assert.equal(html.includes(safetyReasons.materialTreatment), state === "needs-review", view);
        assertDetectedTerms(html, expected, view);
      }
      assert.deepEqual(materialHazardTerms(exported), expected);

      if (state === "compared") {
        const process = "사업장일반폐기물 metal recycling &amp; &lt;batch&gt;";
        const inquiry = await (await get("/inquiry")).text();
        assert.ok(inquiry.includes(`<dt>발생 공정 (신고)</dt><dd>${process}</dd>`));
        assert.doesNotMatch(commercial, /<li>발생 공정:|<li>조건부 추천:/u);
        for (const [view, html] of [["detail", detail], ["research", research]] as const) {
          const stage1 = html.match(/<section id="guidance-stage-1"[^>]*>([\s\S]*?)<\/section>/u)?.[1] ?? "";
          const stage2 = html.match(/<section id="guidance-stage-2"[^>]*>([\s\S]*?)<\/section>/u)?.[1] ?? "";
          assert.match(stage2, /<li>조건부 추천: 기계적 재활용<\/li>/u, view);
          assert.match(stage2, /<li>추천·가정별 안내는 엄격 적격성이나 처리 실행 승인과 다릅니다\.<\/li>/u, view);
          assert.doesNotMatch(stage1, /<batch\b/u, view);
          assert.equal(stage1.match(/<li>발생 공정: ([^<]*)<\/li>/u)?.[1], process, view);
        }
      }
    } finally {
      await app.close();
      caseStore.dispose();
      db.close();
    }
  });
}
