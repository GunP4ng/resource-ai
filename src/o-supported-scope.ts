import type { CaseInput } from "./contracts.ts";
import { escapeHtml, page } from "./report-html.ts";
import { canonicalMaterial } from "./material-context.ts";
import { isUnknownCaseText } from "./o-validation.ts";

const plastic = /\b(?:PET|HDPE|LDPE|PP|PE|PS|PVC|ABS)\b|플라스틱|합성수지|수지|비닐/iu;
const additionalPlastic = /^(?:PA|PC)\b/iu;
const outside = [
  { label: "유리", pattern: /폐유리|유리(?!섬유)|\bglass\b/giu },
  { label: "유기성 폐기물", pattern: /음식물|가축분뇨|\b(?:food waste|organic waste|organic remains)\b/giu },
  { label: "고무", pattern: /고무|\brubber\b/giu },
  { label: "폐섬유", pattern: /폐섬유|섬유|\b(?:textiles?|fabrics?)\b/giu },
  { label: "오니", pattern: /오니|슬러지|\bsludge\b/giu },
] as const;

/** One support gate for submissions, edits and saved case views; unknown material asks a question. */
export function unsupportedScope(input: Pick<CaseInput, "polymer" | "description">): string | null {
  if (canonicalMaterial(input.polymer) !== null) return null;
  const reported = input.polymer?.normalize("NFKC").trim();
  if (reported && isUnknownCaseText(reported)) return null;
  if (!reported && /(?:재질|소재|수지)\s*(?:미상|미확인|불명|모름)|\b(?:unknown material|material unknown)\b/iu.test(input.description)) return null;
  const text = reported || input.description;
  if (plastic.test(text) || (reported && additionalPlastic.test(reported))) return null;
  for (const group of outside) {
    for (const match of text.matchAll(group.pattern)) {
      const before = text.slice(0, match.index);
      const after = text.slice(match.index + match[0].length);
      if (/\b(?:not|no)\s*$/iu.test(before.slice(-12)) || /^\s*(?:이|가)?\s*(?:아닌|아님|아니다|아니라)/u.test(after)) continue;
      return group.label;
    }
  }
  return null;
}

export function unsupportedScopePage(material: string, caseId?: string): string {
  return page("지원 범위 밖", `<section data-out-of-scope><h1>지원 범위 밖 재질입니다</h1>
    <p>입력에 ${escapeHtml(material)} 재질이 있습니다. 이 앱은 폐플라스틱·금속 스크랩·폐목재·포장재(종이·복합 포함)를 검토합니다.</p>
    <p>이번 요청으로 만든 판정은 없습니다.${caseId ? " 기존 사례와 판정은 그대로입니다." : ""}</p>
    <ul><li>재질·발생 공정·오염·유해물질 접촉 자료를 먼저 확인하세요.</li>
    <li>이 폐기물을 다루는 전문 기관에서 분류·허가·처리 조건을 확인하세요.</li>
    <li>혼합재이거나 재질을 모르면 재질을 확인한 뒤 다시 입력하세요.</li></ul>
    <p><a class="primary-action" href="${caseId ? `/cases/${encodeURIComponent(caseId)}` : "/"}">입력 확인하기</a></p></section>`);
}
