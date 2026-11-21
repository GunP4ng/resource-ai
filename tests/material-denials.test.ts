import assert from "node:assert/strict";
import { test } from "node:test";
import type { CaseInput } from "../src/contracts.ts";
import { createResourceDomain } from "../src/domain.ts";
import { createResourceApp } from "../src/session.ts";
import { safetyReasons } from "../src/o-safety-reasons.ts";

const base = { photoRefs: [], hazardousContact: "no", assessmentDate: "2026-11-15" } as const;
const cases: readonly { readonly issue: number; readonly code: string; readonly input: CaseInput }[] = [
  { issue: 121, code: "51-29-02", input: { ...base, caseId: "denial-copper", polymer: "구리",
    description: "동관 절단 공정의 깨끗한 구리 오프컷", process: "사업장일반폐기물 동관 절단 가공 공정",
    contamination: "오일·도료·이물질 없음, 단일 재질로 분리 보관", massKg: 180, region: "경기" } },
  { issue: 121, code: "51-20-22", input: { ...base, caseId: "denial-wood", polymer: "무처리 폐목재",
    description: "제재소에서 발생한 무처리 원목 자투리와 대패밥", process: "사업장일반폐기물 원목 제재 가공 부산물",
    contamination: "무처리 원목 상태, 도장·접착·방부·오일 처리 없음", massKg: 700, region: "강원" } },
  { issue: 122, code: "51-28-02", input: { ...base, caseId: "denial-paper", polymer: "무코팅 골판지",
    description: "제품 포장 후 분리한 무코팅 골판지 상자", process: "사업장일반폐기물 제품 포장 및 박스 조립 공정",
    contamination: "건조하고 깨끗함, 코팅·비닐·테이프 없음", massKg: 320, region: "대전" } },
];

for (const { issue, code, input } of cases) {
  test(`#${issue} ${input.caseId} explicit denial has the same conditional decision as none`, async () => {
    const original = structuredClone(input);
    const control = await createResourceDomain({ ...input, contamination: "없음" }).decide();
    assert.equal(control.state, "compared");
    const result = await createResourceDomain(input).decide();
    assert.equal(result.state, "compared");
    assert.deepEqual(result, control);
    assert.ok(result.recommendations?.[0]?.legalCitations.some(citation => citation.claim.includes(code)));
    assert.equal(result.humanApproval, "pending");
    assert.deepEqual(input, original);
  });

  test(`#${issue} ${input.caseId} native form preserves the exact denial and displays its own code`, async () => {
    const origin = "http://localhost:3000";
    const app = createResourceApp({ origin });
    try {
      const home = await app.fetch(new Request(origin));
      const cookie = home.headers.get("set-cookie")?.split(";")[0];
      assert.ok(cookie);
      const { caseId: _caseId, photoRefs: _photos, massKg, ...fields } = input;
      const response = await app.fetch(new Request(origin + "/cases", { method: "POST",
        headers: { origin, cookie, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(Object.entries({ ...fields, massKg }).map(([key, value]) => [key, String(value ?? "")])) }));
      assert.equal(response.status, 303);
      const path = response.headers.get("location");
      assert.ok(path);
      const detail = await app.fetch(new Request(origin + path, { headers: { cookie } }));
      assert.equal(detail.status, 200);
      const html = await detail.text();
      assert.equal(html.match(/<h1>([^<]*)<\/h1>/)?.[1], "기계적 재활용 추천");
      assert.ok(html.includes(code));
      const exported: unknown = await (await app.fetch(new Request(origin + path + "/input", { headers: { cookie } }))).json();
      assert.ok(exported && typeof exported === "object" && "contamination" in exported);
      assert.equal(exported.contamination, input.contamination);
    } finally { await app.close(); }
  });

  test(`#${issue} ${input.caseId} either order of affirmation and denial remains unresolved`, async () => {
    const positives = issue === 121 ? ["오일 있음", "도료 있음", "페인트 잔류 있음", "접착 있음"]
      : ["PP 코팅 있음", "코팅 있음", "비닐 있음", "테이프 있음"];
    for (const positive of positives) {
      for (const contamination of [`${input.contamination}, ${positive}`, `${positive}, ${input.contamination}`]) {
        const domain = createResourceDomain({ ...input, contamination });
        const decision = await domain.decide();
        assert.notEqual(decision.state, "compared", contamination);
        if (issue === 121) {
          assert.equal(decision.state, "needs-review");
          assert.ok(decision.reasons.includes(safetyReasons.materialTreatment));
        } else {
          assert.ok(domain.assess().questions.some(question => question.includes("코팅")));
          assert.equal(domain.assess().legal.citations.some(citation => citation.kind === "waste-code"), false);
        }
      }
    }
  });

  test(`#${issue} ${input.caseId} a denial in one field cannot erase another field or structured contact`, async () => {
    const positive = issue === 121 ? "오일 접촉 있음" : "PP 코팅 있음";
    for (const field of ["description", "process"] as const) {
      const decision = await createResourceDomain({ ...input, [field]: `${input[field]}, ${positive}` }).decide();
      assert.notEqual(decision.state, "compared", field);
    }
    for (const hazardousContact of ["yes", "unknown"] as const) {
      const decision = await createResourceDomain({ ...input, hazardousContact }).decide();
      assert.notEqual(decision.state, "compared", hazardousContact);
    }
  });
}

test("#121 and #122 incomplete denials and contradictory list items never declare a clean case", async () => {
  for (const { issue, input } of cases) {
    const values = issue === 121
      ? ["오일·도료 없음 추정", "오일·도료 없음?", "오일 있음·도료 없음", "도료 없음·오일 있음"]
      : ["코팅·비닐 없음 추정", "코팅·비닐 없음?", "코팅 있음·비닐 없음", "비닐 없음·코팅 있음"];
    for (const contamination of values) {
      assert.notEqual((await createResourceDomain({ ...input, contamination }).decide()).state, "compared", contamination);
    }
  }
  const paper = cases.find(item => item.issue === 122)?.input;
  assert.ok(paper);
  assert.notEqual((await createResourceDomain({ ...paper, polymer: "골판지 (PP 코팅)" }).decide()).state, "compared");
});
