import { expect, test } from "bun:test";
import type { CaseInput } from "../src/contracts.ts";
import { loadEvidenceRegistry, lookupLegalEvidence } from "../src/evidence.ts";
import { parseCaseInput } from "../src/input.ts";
import entries from "../data/sources/evidence-candidates.json" with { type: "json" };
import hdpe from "../data/candidates/oyeonseok-2026-11-10/oys-20261110-002-hdpe-parison.json" with { type: "json" };
import ldpe from "../data/candidates/oyeonseok-2026-11-10/oys-20261110-004-ldpe-film.json" with { type: "json" };

const input: CaseInput = {
  caseId: "legal-source-reproduction", description: "실제 법령 조회 재현용 입력; 실제 사업장 사례 아님",
  photoRefs: [], process: "사출", polymer: "PP", contamination: "없음",
  hazardousContact: "no", massKg: null, region: "울산", assessmentDate: "2026-11-05",
};

test("traces a conditional industrial resin reference to actual annex PDF bytes", () => {
  const result = lookupLegalEvidence(input, undefined, { intendedUse: "general-resin" });
  const code = result.citations.find((item) => item.sourceId === "legal-290881-annex4-code");
  expect(code?.quote).toContain("51-03-01");
  expect(code?.locator).toContain("6쪽");
  expect(code?.originalSha256).toBe("1144ca217ceb485cfb8bc92a007337c4fb6cab12830a7aed3c6c031c815430a0");
  expect(result.citations.some((item) => item.sourceId === "legal-290881-annex4-3-types")).toBe(true);
  expect(result.citations.find((item) => item.sourceId === "legal-290881-annex4-2-r3-3")?.quote).toContain("원료물질로 제조하는 유형");
  expect(result.citations.find((item) => item.sourceId === "legal-290881-annex5-3-common")?.locator).toBe("별표 5의3 제1호다목, PDF 1쪽");
  expect(result.issues).toEqual([]);
  expect(result.reviewRequirements).toContain("사업장일반폐기물 해당 여부와 지정폐기물 제외를 별도 확인해야 한다.");
});

test.each([
  ["사출 아님", "없음", "no", "context-ambiguous"],
  ["합성수지 화학합성", "없음", "no", "unrelated"],
  ["사출", "폐유 혼합", "no", "unrelated"],
  ["사출", "없음", "unknown", "hazardous-contact-unconfirmed"],
  ["사출", "없음", "yes", "hazardous-contact-unconfirmed"],
] as const)("holds the code reference for process=%s contamination=%s contact=%s", (process, contamination, hazardousContact, reason) => {
  const result = lookupLegalEvidence({ ...input, process, contamination, hazardousContact });
  expect(result.citations.filter((item) => item.kind === "waste-code")).toEqual([]);
  expect(result.issues.some((item) => item.kind === reason)).toBe(true);
});

test("does not apply the archived 290881 annex before its effective date", () => {
  const assessmentDate = "2026-09-30";
  const result = lookupLegalEvidence({ ...input, assessmentDate });
  expect(result.citations.filter((item) => item.sourceId.startsWith("legal-290881-"))).toEqual([]);
  expect(result.issues.some((item) => item.kind === "out-of-period")).toBe(true);
});

test.each(["2026-11-10", "2026-11-11"])("uses the archived revision through its November 11 effective end: %s", (assessmentDate) => {
  const result = lookupLegalEvidence({ ...input, assessmentDate }, undefined, { intendedUse: "general-resin" });
  expect(result.citations.some((item) => item.sourceId === "legal-290881-annex4-code")).toBe(true);
  expect(result.citations.some((item) => item.sourceId.startsWith("legal-291947-"))).toBe(false);
  expect(result.issues.some((item) => item.kind === "currentness-unverified")).toBe(false);
  expect(result.citations.find((item) => item.sourceId === "legal-290881-annex4-code")?.verifiedThrough).toBe("2026-11-14");
});

test("selects the registered 291947 revision at the 2026-11-12 boundary", () => {
  const result = lookupLegalEvidence({ ...input, assessmentDate: "2026-11-12" }, undefined, { intendedUse: "general-resin" });
  expect(result.citations.some((item) => item.sourceId === "legal-291947-annex4-code")).toBe(true);
  expect(result.citations.some((item) => item.sourceId.startsWith("legal-290881-"))).toBe(false);
  expect(result.citations.find((item) => item.sourceId === "legal-291947-annex4-code")?.originalSha256)
    .toBe("cbfff5b2561b1ed566142de2d6549c02f86265ba510a987a74e3585a757624b3");
  expect(result.issues).toEqual([]);
});

test("uses the reverified 291947 revision on November 15", () => {
  const result = lookupLegalEvidence({ ...input, assessmentDate: "2026-11-15" });
  expect(result.citations.some((item) => item.sourceId === "legal-291947-annex4-code")).toBe(true);
  expect(result.citations.some((item) => item.sourceId.startsWith("legal-290881-"))).toBe(false);
  expect(result.issues.some((item) => item.kind === "currentness-unverified")).toBe(false);
});

test.each([
  ["HDPE blow-moulding", hdpe],
  ["LDPE film extrusion", ldpe],
] as const)("preserves %s source version and original linkage across the legal boundary", (_name, raw) => {
  const parsed = parseCaseInput(raw);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  for (const [assessmentDate, version, verifiedThrough] of [
    ["2026-11-10", "290881", "2026-11-14"],
    ["2026-11-13", "291947", "2026-11-15"],
  ] as const) {
    const result = lookupLegalEvidence({ ...parsed.value, assessmentDate });
    const expected = [
      `legal-${version}-annex4-code`,
      `legal-${version}-annex4-2-r3-3`,
      `legal-${version}-annex4-3-types`,
    ];
    expect(new Set(result.citations.map(citation => citation.sourceId).filter(id => expected.includes(id))))
      .toEqual(new Set(expected));
    for (const sourceId of expected) {
      const citation = result.citations.find(item => item.sourceId === sourceId);
      expect(citation?.verifiedThrough).toBe(verifiedThrough);
      expect(citation?.originalSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(citation?.locator).toBeTruthy();
    }
    expect(result.citations.some(item => item.sourceId.startsWith(`legal-${version === "290881" ? "291947" : "290881"}-`))).toBe(false);
    expect(result.issues).toEqual([]);
  }
});

test("keeps dates after the 291947 verification cutoff under review", () => {
  const result = lookupLegalEvidence({ ...input, assessmentDate: "2026-11-16" });
  expect(result.citations.filter((item) => item.sourceId.startsWith("legal-291947-"))).toEqual([]);
  expect(result.issues.some((item) => item.kind === "currentness-unverified"
    && item.sourceId === "legal-291947-annex4-code")).toBe(true);
});

test("adds the actual food feedstock condition and keeps the linked notice unresolved", () => {
  const general = lookupLegalEvidence(input, undefined, { intendedUse: "general-resin" });
  const food = lookupLegalEvidence(input, undefined, { intendedUse: "food-container" });
  expect(general.citations.some((item) => item.sourceId === "legal-290881-annex5-3-food")).toBe(false);
  expect(food.citations.find((item) => item.sourceId === "legal-290881-annex5-3-food")?.quote).toContain("별도의 시설");
  expect(food.citations.find((item) => item.sourceId === "legal-290881-annex5-3-food")?.locator).toBe("별표 5의3 제2호나목1)다)(3), PDF 7쪽");
  expect(food.citations.find((item) => item.sourceId === "legal-food-notice-2026-scope")?.quote).toContain("공정부산물");
  expect(food.reviewRequirements).toContain("식품용기 재생원료의 적용범위·시설·품질·식약처 인정 증빙 미확인: 적합 판정 보류.");
});

test("rejects an excerpt linked to a different original PDF", () => {
  const entry = entries.find((item) => item.sourceId === "legal-290881-annex4-code");
  if (entry === undefined) throw new Error("source fixture missing");
  const result = loadEvidenceRegistry([{ ...entry, originalSourceId: "legal-290881-annex4-2-pdf" }]);
  expect(result.candidates).toEqual([]);
  expect(result.issues).toEqual([{ kind: "hash-mismatch", sourceId: "legal-290881-annex4-code" }]);
});

test.each([undefined, "", "missing-original", "legal-290881-annex4-code", "keco-price-2026-10"])(
  "rejects an excerpt without an original law source: %s", (originalSourceId) => {
    const entry = entries.find((item) => item.sourceId === "legal-290881-annex4-code");
    if (entry === undefined) throw new Error("source fixture missing");
    const { originalSourceId: _original, ...excerpt } = entry;
    const result = loadEvidenceRegistry([originalSourceId === undefined ? excerpt : { ...excerpt, originalSourceId }]);
    expect(result.candidates).toEqual([]);
    expect(result.issues).toEqual([{ kind: "original-unverified", sourceId: entry.sourceId }]);
  },
);

test("reports no results when intended use excludes every registered candidate", () => {
  const loaded = loadEvidenceRegistry(entries.filter((entry) => entry.sourceId === "legal-290881-annex5-3-food"));
  expect(loaded.candidates).toHaveLength(1);
  const result = lookupLegalEvidence(input, loaded.candidates, { intendedUse: "general-resin" });
  expect(result.evidence).toEqual([]);
  expect(result.issues).toEqual([{ kind: "no-results", sourceId: null }]);
});
