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

const treatmentDenials = ["오일 안 묻음", "방부 미처리", "무도장", "미도장", "오일 미사용", "방부제 미사용"];
const verticalBoundaries = ["\n", "\r\n", "\r", "\v", "\f", "\u0085", "\u2028", "\u2029"];
const horizontalVariants = ["오일\t안  묻음", "방부\u3000미처리", "오일\u3000미사용"];
const denialFixtures = cases.filter(({ issue }) => issue === 121);
const copper = cases[0]!.input;
const wood = cases[1]!.input;
const plainWood = { ...wood, polymer: "목재", description: "제재소에서 나온 목재 자투리", contamination: "방부 미처리" };
const historyQuestion = "목재의 도장·접착·방부·오일 처리가 없다는 이력 자료가 있나요? 오염 없음만으로 무처리 목재를 확정하지 않습니다.";
const originQuestion = "원목 제재·가공 부산물인지 사용한 포장재·가구·건설 목재인지 알려 주세요. 도장·접착·방부·오일 처리 이력도 확인해 주세요.";

function cleanVariants(denial: string): string[] {
  return [denial, ...[", ", ...verticalBoundaries.slice(0, 3)].flatMap(separator =>
    [`오염 없음${separator}${denial}`, `${denial}${separator}오염 없음`])];
}

for (const { input, code } of denialFixtures) {
  test(`#137 ${input.caseId} complete denials preserve the full conditional decision`, async () => {
    const control = await createResourceDomain({ ...input, contamination: "없음" }).decide();
    assert.equal(control.state, "compared");
    assert.equal(control.humanApproval, "pending");
    const route = control.routes.find(item => item.route === "mechanical-recycling");
    assert.equal(route?.eligibility.state, "conditional");
    assert.match(route.eligibility.conditions.join(" "), new RegExp(`${code}.*${code === "51-20-22" ? "R-3-4" : "R-3-3"}`));
    for (const contamination of [
      "오일 없음", "오일 없다", ...treatmentDenials.flatMap(cleanVariants), ...horizontalVariants,
      "오일 안 묻음, 방부 미처리, 무도장",
    ]) {
      const facts = { ...input, contamination };
      const original = structuredClone(facts);
      assert.deepEqual(await createResourceDomain(facts).decide(), control, JSON.stringify(contamination));
      assert.deepEqual(facts, original);
    }
  });
}

type NativeDenialCase = {
  readonly label: string;
  readonly input: CaseInput;
  readonly outcome: "clear" | "review" | "unknown";
  readonly terms?: readonly string[];
  readonly treatment?: boolean;
  readonly questions?: readonly string[];
  readonly code?: string;
};

const nativeDenials: NativeDenialCase[] = [];
for (const { input, code } of denialFixtures) {
  for (const contamination of [...treatmentDenials.flatMap(cleanVariants), ...horizontalVariants, "오일 없음", "오일 없다"]) {
    nativeDenials.push({ label: `${input.caseId} clear ${JSON.stringify(contamination)}`,
      input: { ...input, contamination }, outcome: "clear", code });
  }
  for (const [denial, positive, term] of [
    ["오일 안 묻음", "도료 묻음", "도료"],
    ["오일 미사용", "오일 사용", "오일"],
    ["미도장", "도장됨", "도장"],
    ["방부 미처리", "방부 처리됨", "방부"],
    ["무도장", "도료 일부 남음", "도료"],
    ["방부제 미사용", "오일이 묻은 상태", "오일"],
  ] as const) {
    const variants = [
      { contamination: `${denial}, ${positive}` }, { contamination: `${positive}, ${denial}` },
      ...(["description", "process", "polymer"] as const).map(field =>
        ({ contamination: denial, [field]: `${input[field]}, ${positive}` })),
    ];
    for (const variant of variants) {
      nativeDenials.push({ label: `${input.caseId} ${JSON.stringify(variant)}`,
        input: { ...input, ...variant }, outcome: "review", terms: [term] });
    }
  }
  for (const [term, values] of [
    ["도장", ["무도장, 아님", "추정, 무도장", "미도장\n확인 예정", "무도장\n여부 미상",
      "무도장,\n\n여부 미상", "무도장재", "미도장품", "무도장이 아님", "무 도장", "무도장; 오염 없음"]],
    ["방부", ["방부 미처리 여부 미확인", "방부 미처리된 것으로 추정", "방부 미 처리", "방부 미\r\n처리"]],
    ["오일", ["오일, 미사용", "오일,\n미사용", "오일 안 묻음?", "오일 미사용량",
      "오일 묻음", "미사용 오일 묻음", "미사용 설비에서 오일 사용", "오일 사용 후 안 묻음",
      ...verticalBoundaries.map(separator => `오일 안${separator}묻음`)]],
  ] as const) {
    for (const contamination of values) {
      nativeDenials.push({ label: `${input.caseId} dirty ${JSON.stringify(contamination)}`,
        input: { ...input, contamination }, outcome: "review", terms: [term] });
    }
  }
  for (const contamination of ["미사용", "미처리 여부 모름"]) {
    nativeDenials.push({ label: `${input.caseId} incomplete ${contamination}`,
      input: { ...input, contamination }, outcome: "unknown", questions: [safetyReasons.contaminationUnknown] });
  }
  for (const hazardousContact of ["yes", "unknown"] as const) {
    nativeDenials.push(
      { label: `${input.caseId} contact ${hazardousContact}`,
        input: { ...input, hazardousContact, contamination: "무도장" },
        outcome: hazardousContact === "yes" ? "review" : "unknown" },
      { label: `${input.caseId} contact ${hazardousContact} with oil`,
        input: { ...input, hazardousContact, contamination: "무도장", description: `${input.description}, 오일 사용\r없음` },
        outcome: "review", terms: ["오일"] },
    );
  }
}

// Round 1 exposed the plain-wood paperwork path and incorrect mixed term attribution.
for (const suffix of ["전표 미처리", "목재 미처리 여부 확인서 발급 요청", "원목 상태 확인서 미제출", "원목 상태 미확인",
  "추정, 목재 미처리", "목재 미처리, 여부 미확인", "원목 상태", "방부 미처리", "미처리 원목", "원목 미처리", "untreated wood"]) {
  nativeDenials.push({ label: `plain wood process ${suffix}`, input: { ...plainWood, process: `${wood.process}, ${suffix}` },
    outcome: "review", terms: ["방부"], questions: [originQuestion, historyQuestion] });
}
for (const contamination of ["방부 미처리", "오염 없음, 무도장", "무도장, 원목 상태", "방부 미처리, 원목 상태 미확인",
  "방부 미처리, 원목 미처리 여부 확인서 발급 요청", "무도장, 추정, 원목 미처리", "방부 미처리, 무처리 원목 상태"]) {
  nativeDenials.push({ label: `plain wood contamination ${contamination}`, input: { ...plainWood, contamination },
    outcome: "review", terms: [contamination.includes("방부") ? "방부" : "도장"], questions: [originQuestion, historyQuestion] });
}
for (const positive of ["도료 있음", "도료 일부 있음"]) {
  for (const contamination of [`오일 안 묻음, ${positive}`, `${positive}, 오일 안 묻음`]) {
    nativeDenials.push({ label: `mixed paint ${contamination}`, input: { ...copper, contamination },
      outcome: "review", terms: ["도료"] });
  }
}
nativeDenials.push(
  { label: "mixed paint with complete adhesive denial",
    input: { ...copper, contamination: "오일 안 묻음, 도료 있음, 접착제 없음" }, outcome: "review", terms: ["도료"] },
  { label: "mixed paint with punctuated adhesive denial",
    input: { ...copper, contamination: "오일 안 묻음, 도료 있음, 접착제 없음." }, outcome: "review", terms: ["도료"] },
  ...["...", "…"].map(suffix => ({
    label: `mixed paint with an opaque ellipsis ${suffix}`,
    input: { ...copper, contamination: `오일 안 묻음, 도료 있음, ${suffix}` },
    outcome: "review" as const, terms: ["오일", "도료"],
  })),
  { label: "legacy oil denial beside paint", input: { ...copper, contamination: "오일 없음, 도료 일부 있음" },
    outcome: "review", terms: ["도료"] },
  { label: "paint denial between split oil assertions", input: { ...copper, contamination: "오일 사용\n무도장\n없음" },
    outcome: "review", terms: ["오일"] },
  { label: "plain wood with preservative denial in process",
    input: { ...plainWood, process: `${wood.process}, 방부 미처리`, contamination: "무도장" },
    outcome: "review", terms: ["방부"], questions: [originQuestion, historyQuestion] },
  { label: "plain wood with unknown condition in description",
    input: { ...plainWood, description: `${plainWood.description}, 원목 상태 미확인`, contamination: "방부 미처리, 무처리 원목 상태" },
    outcome: "review", terms: ["방부"], questions: [originQuestion, historyQuestion] },
  { label: "untreated label without a supported wood stream",
    input: { ...wood, process: "사업장일반폐기물 포장 공정", contamination: "무도장" },
    outcome: "unknown", questions: [originQuestion, safetyReasons.contaminationUnknown] },
);

// Rounds 2 and 3 reproduced split oil across fields and line endings.
for (const separator of verticalBoundaries) {
  for (const field of ["description", "process", "polymer"] as const) {
    nativeDenials.push({ label: `split oil in ${field} at ${JSON.stringify(separator)}`,
      input: { ...copper, [field]: `${copper[field]}, 오일 사용${separator}없음`, contamination: "무도장" },
      outcome: "review", terms: ["오일"] });
  }
  for (const qualifier of ["", ", 추정"]) {
    nativeDenials.push({ label: `mixed split oil ${JSON.stringify(separator)}${qualifier}`,
      input: { ...copper, contamination: `오일 사용${separator}없음, 무도장${qualifier}` },
      outcome: "review", terms: qualifier ? ["오일", "도장"] : ["오일"] });
  }
}

for (const punctuation of [" ", ", "]) {
  nativeDenials.push({ label: `plain wood qualified process origin ${JSON.stringify(punctuation)}`,
    input: { ...plainWood, process: `사업장일반폐기물${punctuation}원목 제재 가공 부산물, 원목 미처리`,
      description: `${plainWood.description}, 공정란의 원목 미처리는 확인서 발급 요청 문구` },
    outcome: "review", terms: ["방부"], questions: [originQuestion, historyQuestion] });
}
const coated = { ...copper, process: `${copper.process}, PP 코팅 있음` };
nativeDenials.push(
  { label: "ordinary none with bare coating", input: { ...coated, contamination: "없음" }, outcome: "clear", code: "51-29-02" },
  { label: "denial with bare coating", input: { ...coated, contamination: "무도장" }, outcome: "review", treatment: true },
  { label: "exact unplated exemption", input: { ...copper, description: "무도금 구리판 절단편", contamination: "무도장" },
    outcome: "clear", code: "51-29-02" },
  { label: "qualified unplated still holds", input: { ...copper, description: "무도금 구리판 절단편, 추정", contamination: "무도장" },
    outcome: "review", terms: ["도금"] },
  { label: "keep the whole-field hazard veto alongside line scans",
    input: { ...copper, description: "구리 절단편, 오일 없음\r도료 없음", contamination: "무도장" },
    outcome: "review", terms: ["오일", "도료"] },
);

for (const [residue, separator] of [["슬러지 잔류", "\n"], ["분진 잔류", "\r"], ["잔류막", "\n"]] as const) {
  const description = `${copper.description}, ${residue}${separator}없음`;
  const label = JSON.stringify(`${residue}${separator}없음`);
  nativeDenials.push(
    { label: `denial with independent residue ${label}`, input: { ...copper, description, contamination: "무도장" },
      outcome: "unknown", questions: [safetyReasons.contaminationUnknown] },
    { label: `ordinary none with ${label}`, input: { ...copper, description, contamination: "없음" },
      outcome: "clear", code: "51-29-02" },
    { label: `denial with same-line absence ${residue}`,
      input: { ...copper, description: `${copper.description}, ${residue} 없음`, contamination: "무도장" },
      outcome: "clear", code: "51-29-02" },
  );
}

for (const field of ["description", "process", "polymer"] as const) {
  nativeDenials.push({ label: `new forms are contamination-only (${field})`,
    input: { ...copper, [field]: `${copper[field]}, 무도장`, contamination: "없음" },
    outcome: "review", terms: ["도장"], code: field === "polymer" ? undefined : "51-29-02" });
}
nativeDenials.push({ label: "paper keeps its legacy treatment hold",
  input: { ...cases[2]!.input, contamination: "무도장" }, outcome: "review", terms: ["도장"] });

const headings = { clear: "기계적 재활용 추천", review: "검토 필요", unknown: "추가 정보 필요" } as const;
for (const { label, input, outcome, terms = [], treatment = terms.length > 0, questions = [], code } of nativeDenials) {
  test(`#137 native ${label}`, async () => {
    const origin = "http://localhost:3000";
    const app = createResourceApp({ origin });
    try {
      const cookie = (await app.fetch(new Request(origin))).headers.get("set-cookie")?.split(";")[0];
      assert.ok(cookie);
      const { caseId: _caseId, photoRefs, massKg, ...fields } = input;
      const created = await app.fetch(new Request(origin + "/cases", { method: "POST",
        headers: { origin, cookie, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(Object.entries({ ...fields, massKg }).map(([key, value]) => [key, String(value ?? "")])) }));
      assert.equal(created.status, 303);
      const path = created.headers.get("location");
      assert.ok(path);
      const exported = await app.fetch(new Request(origin + path + "/input", { headers: { cookie } }));
      assert.equal(exported.status, 200);
      assert.deepEqual(await exported.json(), { ...fields, caseId: path.split("/").at(-1), massKg, photoRefs });
      for (const suffix of ["", "/report"]) {
        const response = await app.fetch(new Request(origin + path + suffix, { headers: { cookie } }));
        assert.equal(response.status, 200);
        const html = await response.text();
        const observed = {
          heading: html.match(/<h1>([^<]*)<\/h1>/u)?.[1],
          terms: html.match(/class="detected-hazard-terms">입력에서 감지한 표현: ([^.]+)\./u)?.[1]?.split(" · ") ?? [],
          treatment: html.includes(safetyReasons.materialTreatment),
          contact: html.includes(safetyReasons.contactClassification),
          unknownContact: html.includes(safetyReasons.contactUnknown),
          codes: ["51-29-02", "51-20-22", "51-28-02"].filter(value => html.includes(value)),
          missingQuestions: questions.filter(question => !html.includes(question)),
        };
        assert.deepEqual(observed, { heading: headings[outcome], terms, treatment,
          contact: input.hazardousContact === "yes", unknownContact: input.hazardousContact === "unknown",
          codes: code ? [code] : [], missingQuestions: [] }, suffix || "detail");
      }
    } finally { await app.close(); }
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

test("material word boundaries preserve ordinary words while unresolved contamination asks", async () => {
  const copper = cases[0]?.input;
  assert.ok(copper);
  for (const [description, state, reason] of [
    ["납품용 구리 자투리", "compared", null],
    ["납작한 구리 조각", "compared", null],
    ["수납용 부품의 구리 자투리", "compared", null],
    ["구리 막대 절단편", "compared", null],
    ["마지막 공정의 구리 자투리", "compared", null],
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

const nativeCases = [
  ["표면이 납으로 오염된 구리 절단편", "검토 필요"],
  ["구리 절단편, 납 오염", "검토 필요"],
  ["동관 절단 공정의 구리 오프컷, 땜납 다량 부착", "검토 필요"],
  ["동관 절단 공정의 구리 오프컷, 납땜 다량 부착", "검토 필요"],
  ["무도금 구리판 절단편", "기계적 재활용 추천"],
  ["구리판 절단편, 도금 없음", "기계적 재활용 추천"],
  ["합성 구리 스크랩, 절삭유 다량 부착", "검토 필요"],
  ["합성 구리 스크랩, 끈적한 막", "추가 정보 필요"],
  ["합성 구리 스크랩, 얼룩 없음", "기계적 재활용 추천"],
  ["합성 구리 스크랩, 얼룩 없음, 끈적한 막", "추가 정보 필요"],
  ["구리 스크랩, 잔여물 있음", "추가 정보 필요"],
  ["구리 스크랩, 잔류 물질 있음", "추가 정보 필요"],
  ["구리 스크랩, 잔여 물질 있음", "추가 정보 필요"],
  ["비철 스크랩, 잔여 물질 있음", "추가 정보 필요"],
  ["비철 금속, 잔여 물질 있음", "추가 정보 필요"],
  ["잔여 물질 있음", "추가 정보 필요"],
  ["구리 스크랩, 잔여 물질 없음", "기계적 재활용 추천"],
  ["구리 스크랩, 잔여물은 없음", "추가 정보 필요"],
  ["구리 스크랩, 잔여 물질 있으면 분리", "기계적 재활용 추천"],
  ["세척하면, 잔여 물질 있음", "기계적 재활용 추천"],
  ["구리 스크랩, 잔여 물질 있음?", "기계적 재활용 추천"],
  ["구리 스크랩, 잔여 물질 있음, 추정", "기계적 재활용 추천"],
  ["구리 스크랩, 잔여 물질 있음, 납 검출", "검토 필요"],
  ["납 검출, 구리 스크랩, 잔여 물질 있음", "검토 필요"],
  ["구리판, 얼룩 없음", "기계적 재활용 추천"],
  ["합성 구리 스크랩", "기계적 재활용 추천", "막·잔여물·이물 없음"],
  ...ambiguousUnplatedDescriptions.map(description => [description, "검토 필요"] as const),
] as const;

for (const [description, heading, contamination = "없음"] of nativeCases) {
  test(`native copper report and raw export: ${description}`, async () => {
    const origin = "http://localhost:3000";
    const app = createResourceApp({ origin });
    const fields = { polymer: "구리", process: "사업장일반폐기물, 기계 가공 공정에서 나온 구리 절삭 스크랩",
      contamination, description,
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
        assert.equal(html.includes(safetyReasons.contaminationUnknown), heading === "추가 정보 필요");
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
