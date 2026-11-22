import assert from "node:assert/strict";
import { test } from "node:test";
import { renderReport } from "../src/report.ts";
import { readCaseResearchCatalog, buildCaseResearchAttachment } from "../src/o-case-research.ts";
import { revision } from "../src/o-validation.ts";
import { lookupLegalEvidence } from "../src/evidence.ts";
import { loadEvidenceRegistry } from "../src/evidence-registry.ts";
import registryJson from "../data/sources/evidence-candidates.json" with { type: "json" };
import recyclingDirectory from "../data/reference/public-recycling-candidates-20261121.json" with { type: "json" };

const catalog = readCaseResearchCatalog();
for (const sourceCaseId of ["OYS-20261110-001", "OYS-20261110-002", "OYS-20261110-003"] as const) {
  test(`research display preserves serialized values, null reasons and directory rows: ${sourceCaseId}`, async () => {
    // Given a verified attachment and a deliberately different display sentinel.
    const data = await catalog;
    const source = data.calculations.data.cases.find(c => c.case_id === sourceCaseId);
    assert.ok(source);
    const input = { ...source.original, caseId: "report-bound-case" };
    const attachment = buildCaseResearchAttachment({ actorId: "private-actor", input, inputRevision: revision(input) }, sourceCaseId, data);
    const research = { artifactSha256: "a".repeat(64), attachment };
    const decision = { state: "needs-information", caseId: input.caseId, questions: ["질량 확인"], evidence: [] } as const;
    // When the caller explicitly selects the authenticated server-only channel.
    const html = renderReport(decision, { mode: "offline" }, { audience: "authenticated-research", research });
    // Then every stored result and original directory row survives without arithmetic.
    for (const result of attachment.calculations.results) {
      for (const display of Object.values(result.display)) if (display !== null) assert.ok(html.includes(display));
    }
    assert.equal((html.match(/data-research-result=/g) ?? []).length, 3);
    assert.equal((html.match(/data-directory-row=/g) ?? []).length, 8);
    assert.equal((html.match(/data-recycling-directory-row=/g) ?? []).length, 4);
    assert.ok(html.includes(recyclingDirectory.source.url));
    assert.ok(html.includes("명부 기준일 2025년 11월 21일 · 조회 2026년 11월 21일 01:05"));
    assert.ok(html.includes(recyclingDirectory.source.rawSha256));
    for (const row of recyclingDirectory.rows) {
      let rowText = "";
      await new HTMLRewriter().on(`[data-recycling-directory-row="${row.rowNumber}"]`, {
        text(chunk) { rowText += chunk.text; },
      }).transform(new Response(html)).text();
      assert.ok(rowText.includes(row.name));
      assert.ok(rowText.includes(row.activity));
      assert.ok(rowText.includes(row.wasteScope));
      assert.ok(rowText.includes(row.address));
      assert.ok(rowText.includes("인수 의사는 문의로 확인"));
      assert.ok(rowText.includes("확인 필요: 현재 허가·영업 상태, 사례 지역·운송·재질·품목·오염 조건 적합성"));
    }
    assert.match(html, /공개 자료 기반 계산값\(관측값 아님\)/);
    assert.match(html, /상업 이용·재배포 권리가 확인되지 않아/);
    assert.match(html, /소각 등재 업체의 에너지 회수 여부와 실제 시설 위치는 업체에 확인/);
    assert.match(html, /기계적 재활용 시설 근거가 아직 없어/);
    assert.equal(attachment.processors.source.sourceDate, "2025-12-22");
    const directoryDate = "2025년 12월 22일";
    assert.doesNotMatch(html, new RegExp(`등재일\\s*${directoryDate}`), "the dataset date is not a company's registration date");
    assert.ok(html.includes(`명부 기준일 ${directoryDate}`));
    assert.match(html, /업체별 등재·갱신일 없음/);
    let provenanceText = "";
    await new HTMLRewriter()
      .on("#research-calculations > details", { text(chunk) { provenanceText += chunk.text; } })
      .transform(new Response(html)).text();
    assert.ok(provenanceText.includes(attachment.calculations.cases[0].material_mapping_assumption), "original assumption remains in research provenance");
    for (const limitation of attachment.calculations.limitations) assert.ok(provenanceText.includes(limitation), "original limitation remains in research provenance");
    for (const input of attachment.calculations.inputs) {
      let original = "";
      let open = false;
      await new HTMLRewriter().on(`[data-research-input="${input.input_id}"] details`, {
        element(element) { open ||= element.hasAttribute("open"); },
        text(chunk) { original += chunk.text; },
      }).transform(new Response(html)).text();
      assert.equal(open, false, "dense original inputs stay collapsed");
      for (const field of [input.input_id, input.unit, input.assumption_reason ?? input.transform, input.period, input.geography, input.tax_basis]) {
        assert.ok(original.includes(field), `original input provenance preserved: ${input.input_id}`);
      }
    }
    assert.match(html, /2026-11-10/);
    if (sourceCaseId.endsWith("003")) assert.match(html, /질량 없음/);
    if (sourceCaseId.endsWith("002")) assert.match(html, /generic PE/);
    const commercial = renderReport(decision, { mode: "offline" });
    assert.doesNotMatch(commercial, /data-research-result|data-directory-row|data-recycling-directory-row|WARM|Wonju|private-actor/);
    assert.ok(!commercial.includes(research.artifactSha256));
  });
}

test("renderer uses stored display strings and keeps real zero separate from null", async () => {
  // Given trusted serialized display fields deliberately distinct from numeric inputs.
  const data = await catalog;
  const source = data.calculations.data.cases[0];
  assert.ok(source);
  const input = { ...source.original, caseId: "display-only-case" };
  const attachment = buildCaseResearchAttachment({ actorId: "private-actor", input, inputRevision: revision(input) }, "OYS-20261110-001", data);
  const first = attachment.calculations.results[0];
  assert.ok(first);
  const research = { artifactSha256: "b".repeat(64), attachment: { ...attachment, calculations: { ...attachment.calculations,
    results: [{ ...first, display: { ...first.display, net_cost_krw: "0", net_carbon_kgco2e: "8765.43" } }],
  } } };
  // When the renderer consumes that server-only value object.
  const html = renderReport({ state: "needs-information", caseId: input.caseId, questions: ["확인"], evidence: [] }, { mode: "offline" }, { audience: "authenticated-research", research });
  // Then it does no recalculation or re-rounding of the supplied result display.
  assert.match(html, /<dt>순비용<\/dt><dd>0 원<\/dd>/);
  assert.match(html, /8765\.43 kg CO₂ 환산/);
  assert.doesNotMatch(html, /-13867 원|-27\.51 kg CO₂ 환산/);
});

test("legal quote and PDF page require the exact registered source, SHA and law version", async () => {
  // Given the real 2026-11-10 source case and registered law290881 evidence.
  const data = await catalog;
  const source = data.calculations.data.cases[0];
  assert.ok(source);
  const record = lookupLegalEvidence(source.original).evidence.find(item => item.sourceId === "legal-290881-annex4-code");
  assert.ok(record);
  const registered = loadEvidenceRegistry(registryJson).candidates.find(item => item.record.sourceId === record.sourceId);
  assert.ok(registered?.provenance);
  const decision = { state: "needs-information", caseId: "legal-report", questions: ["확인"], evidence: [record] } as const;
  // When a report links the exact stored quotation, locator and original PDF.
  const html = renderReport(decision, { mode: "offline" });
  assert.match(html, /flSeq=170404737[^"\s]*#page=6/);
  assert.ok(html.includes(registered.provenance.quote));
  assert.ok(html.includes(record.datasetVersion));
  assert.ok(html.includes(record.sha256));
  // Then changes to either the hash or version cannot borrow that quotation/page.
  for (const mutated of [{ ...record, sha256: "0".repeat(64) }, { ...record, datasetVersion: "unregistered-version" }]) {
    const invalid = renderReport({ ...decision, evidence: [mutated] }, { mode: "offline" });
    assert.doesNotMatch(invalid, /<blockquote>|#page=6/);
  }
});
