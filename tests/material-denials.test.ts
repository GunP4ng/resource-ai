import assert from "node:assert/strict";
import { test } from "node:test";
import type { CaseInput } from "../src/contracts.ts";
import { createResourceDomain } from "../src/domain.ts";
import { createResourceApp } from "../src/session.ts";
import { safetyReasons } from "../src/o-safety-reasons.ts";

const base = { photoRefs: [], hazardousContact: "no", assessmentDate: "2026-11-15" } as const;
const ambiguousUnplatedDescriptions = [
  "구리판 절단편, 무도금\n여부 미상",
  "구리판 절단편, 무도금\n아님",
  "무도금 구리판 절단편, 추정일 뿐 확인되지 않음",
] as const;
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

for (const substance of ["절삭유", "윤활유", "작동유", "유압유", "그리스", "기름", "유분", "오일", "유류",
  "절삭액", "냉각수", "방청제", "도금", "납", "납땜", "땜납", "카드뮴", "크롬", "석면", "중금속", "PCB", "pcb", "ＰＣＢ"]) {
  test(`${substance} affirmation survives denials in every material field and either order`, async () => {
    for (const { input } of cases) {
      const denied = { ...input, contamination: `${substance} 없음` };
      assert.equal((await createResourceDomain(denied).decide()).state, "compared", `${input.caseId}: explicit absence`);
      for (const field of ["description", "process", "contamination"] as const) {
        for (const value of [`${denied[field]}, ${substance} 다량 부착`, `${substance} 다량 부착, ${denied[field]}`]) {
          const facts = { ...denied, [field]: value };
          const original = structuredClone(facts);
          const result = await createResourceDomain(facts).decide();
          assert.equal(result.state, "needs-review", `${input.caseId}: ${field}: ${value}`);
          assert.ok(result.reasons.includes(safetyReasons.materialTreatment));
          assert.deepEqual(facts, original);
        }
      }
    }
  });
}

test("unrecognized material contamination asks instead of relying on missing legal citations", async () => {
  for (const { input } of cases) {
    for (const contamination of ["푸른 잔류막", "오일 없음, 푸른 잔류막", "푸른 잔류막, 오일 없음", "미상", "모름"]) {
      const facts = { ...input, contamination };
      const original = structuredClone(facts);
      const result = await createResourceDomain(facts).decide();
      assert.equal(result.state, "needs-information", `${input.caseId}: ${contamination}`);
      assert.ok(result.questions.includes(safetyReasons.contaminationUnknown));
      assert.deepEqual(facts, original);
    }
    for (const contamination of ["없음", "무오염", "깨끗", "청정", "none", "clean"]) {
      assert.equal((await createResourceDomain({ ...input, contamination }).decide()).state, "compared");
    }
  }
});

test("lead word boundaries preserve ordinary words while unresolved contamination asks", async () => {
  const copper = cases[0]?.input;
  assert.ok(copper);
  for (const [description, state, reason] of [
    ["납품용 구리 자투리", "compared", null],
    ["납작한 구리 조각", "compared", null],
    ["수납용 부품의 구리 자투리", "compared", null],
    ["구리 절단편, 수납으로 오염된 표면", "needs-information", safetyReasons.contaminationUnknown],
    ["구리 절단편, 납으로 오염된듯한 표면", "needs-review", safetyReasons.materialTreatment],
    ["구리 절단편, 납으로\n오염된 표면", "needs-review", safetyReasons.materialTreatment],
  ] as const) {
    const result = await createResourceDomain({ ...copper, description }).decide();
    assert.equal(result.state, state, description);
    if (reason !== null) {
      assert.ok(result.state !== "compared");
      const reasons: readonly string[] = result.state === "needs-review" ? result.reasons : result.questions;
      assert.ok(reasons.includes(reason), description);
    }
  }
});

test("residual history questions keep complete denials and untreated controls local to their field", async () => {
  for (const { input } of cases) {
    for (const field of ["description", "process"] as const) {
      for (const denial of ["잔류물 없음", "오염 없음", "약제 없음", "표면처리 없음"]) {
        assert.equal((await createResourceDomain({ ...input, [field]: `${input[field]}, ${denial}` }).decide()).state, "compared");
        const result = await createResourceDomain({ ...input,
          [field]: `${input[field]}, ${denial}, 성분 모를 잔류막` }).decide();
        assert.equal(result.state, "needs-information");
        assert.ok(result.questions.includes(safetyReasons.contaminationUnknown));
      }
    }
  }
});

const nativeDescriptions = [
  ["표면이 납으로 오염된 구리 절단편", "검토 필요"],
  ["구리 절단편, 납 오염", "검토 필요"],
  ["동관 절단 공정의 구리 오프컷, 땜납 다량 부착", "검토 필요"],
  ["동관 절단 공정의 구리 오프컷, 납땜 다량 부착", "검토 필요"],
  ["무도금 구리판 절단편", "기계적 재활용 추천"],
  ["구리판 절단편, 도금 없음", "기계적 재활용 추천"],
  ["합성 구리 스크랩, 절삭유 다량 부착", "검토 필요"],
  ...ambiguousUnplatedDescriptions.map(description => [description, "검토 필요"] as const),
] as const;

for (const [description, heading] of nativeDescriptions) {
  test(`native copper report and raw export: ${description}`, async () => {
    const origin = "http://localhost:3000";
    const app = createResourceApp({ origin });
    const fields = { polymer: "구리", process: "사업장일반폐기물, 기계 가공 공정에서 나온 구리 절삭 스크랩",
      contamination: "없음", description,
      hazardousContact: "no", massKg: "180", region: "경기", assessmentDate: base.assessmentDate };
    try {
      const home = await app.fetch(new Request(origin));
      const cookie = home.headers.get("set-cookie")?.split(";")[0];
      assert.ok(cookie);
      const created = await app.fetch(new Request(origin + "/cases", { method: "POST",
        headers: { origin, cookie, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields) }));
      assert.equal(created.status, 303);
      const path = created.headers.get("location");
      assert.ok(path);
      const exported = await app.fetch(new Request(origin + path + "/input", { headers: { cookie } }));
      assert.equal(exported.status, 200);
      assert.deepEqual(await exported.json(), { ...fields, caseId: path.split("/").at(-1), massKg: 180, photoRefs: [] });
      for (const suffix of ["", "/report"]) {
        const report = await app.fetch(new Request(origin + path + suffix, { headers: { cookie } }));
        assert.equal(report.status, 200);
        const html = await report.text();
        assert.equal(html.match(/<h1>([^<]*)<\/h1>/)?.[1], heading);
        assert.equal(html.includes(safetyReasons.materialTreatment), heading === "검토 필요");
      }
    } finally { await app.close(); }
  });
}

test("an unplated copper clause preserves independent hazards in every field and either order", async () => {
  const copper = cases[0]?.input;
  assert.ok(copper);
  const input: CaseInput = { ...copper, description: "무도금 구리판 절단편" };
  for (const positive of ["도금 있음", "코팅 있음", "PP 코팅 있음", "도료 있음", "절삭유 다량 부착",
    "표면이 납으로\t오염된 구리 절단편", "땜납 다량 부착", "중금속 부착"]) {
    for (const field of ["description", "process", "contamination"] as const) {
      for (const value of [`${input[field]}, ${positive}`, `${positive}, ${input[field]}`]) {
        const decision = await createResourceDomain({ ...input, [field]: value }).decide();
        assert.equal(decision.state, "needs-review", `${field}: ${value}`);
        assert.ok(decision.reasons.includes(safetyReasons.materialTreatment), `${field}: ${value}`);
      }
    }
  }
  const contact = await createResourceDomain({ ...input, hazardousContact: "yes" }).decide();
  assert.equal(contact.state, "needs-review");
  assert.ok(contact.reasons.includes(safetyReasons.contactClassification));
  assert.ok(!contact.reasons.includes(safetyReasons.materialTreatment));
  const unknown = await createResourceDomain({ ...input, hazardousContact: "unknown" }).decide();
  assert.equal(unknown.state, "needs-information");
});

test("only complete unplated fields are exempt from the plating hazard", async () => {
  const copper = cases[0]?.input;
  assert.ok(copper);
  for (const description of ["무도금", "무도금 구리판", "무도금 구리판 절단편", "\n\u3000무도금\u3000구리판\u3000절단편\t"]) {
    assert.equal((await createResourceDomain({ ...copper, description }).decide()).state, "compared", description);
  }
  for (const description of ["무도금 아님", "무도금 여부 미상", "무도금 구리판 절단편 추정",
    "무도금 구리판 절단편 및 혼합 스크랩", "무도금 구리판 절단편, 무도금 여부 미상",
    "구리 자투리; 무도금; 도금 없음", "무도금 구리판 절단편, 도금 없음", "도금 없음\n무도금 구리판 절단편"]) {
    const decision = await createResourceDomain({ ...copper, description }).decide();
    assert.equal(decision.state, "needs-review", description);
    assert.ok(decision.reasons.includes(safetyReasons.materialTreatment), description);
  }
  const reviewerDecisions = await Promise.all(ambiguousUnplatedDescriptions.map(async description => {
    const decision = await createResourceDomain({ ...copper, description }).decide();
    return { description, state: decision.state,
      materialTreatment: decision.state === "needs-review" && decision.reasons.includes(safetyReasons.materialTreatment) };
  }));
  assert.deepEqual(reviewerDecisions, ambiguousUnplatedDescriptions.map(description => ({
    description, state: "needs-review", materialTreatment: true,
  })));
  const unconfirmed = await createResourceDomain({ ...copper, contamination: "무도금" }).decide();
  assert.equal(unconfirmed.state, "needs-information");
  assert.ok(unconfirmed.questions.includes(safetyReasons.contaminationUnknown));
});

test("unplated copper wording with unknown polymer and reported PP coating still asks for material details", async () => {
  const copper = cases[0]?.input;
  assert.ok(copper);
  for (const description of ["무도금 구리판 절단편, PP 코팅 있음", "PP 코팅 있음, 무도금 구리판 절단편"]) {
    assert.equal((await createResourceDomain({ ...copper, polymer: null, description }).decide()).state, "needs-information", description);
  }
});
