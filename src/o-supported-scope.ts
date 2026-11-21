import type { CaseInput } from "./contracts.ts";
import { escapeHtml, page } from "./report-html.ts";

const plastic = /\b(?:PET|HDPE|LDPE|PP|PE|PS|PVC|ABS)\b|플라스틱|합성수지|수지|비닐/iu;
const unknown = /^(?:미상|미확인|불명|모름|unknown)$/iu;
const outside = [
  { label: "목재", pattern: /폐목재|목재|\bwood\b/giu },
  { label: "금속", pattern: /금속|고철|철\s*스크랩|알루미늄|구리|\b(?:metal|steel|aluminum|aluminium|copper)\b/giu },
  { label: "유리", pattern: /폐유리|유리(?!섬유)|\bglass\b/giu },
  { label: "종이", pattern: /폐지|종이|\bpaper\b/giu },
  { label: "유기성 폐기물", pattern: /음식물|가축분뇨|\b(?:food waste|organic waste)\b/giu },
] as const;

/** Reported nonplastic material only. Unknowns and ambiguous plastic mixtures are not classified. */
export function unsupportedScope(input: Pick<CaseInput, "polymer" | "description">): string | null {
  const reported = input.polymer?.trim();
  if (reported && unknown.test(reported)) return null;
  if (!reported && /(?:재질|소재|수지)\s*(?:미상|미확인|불명|모름)|\b(?:unknown material|material unknown)\b/iu.test(input.description)) return null;
  const text = reported || input.description;
  if (plastic.test(text)) return null;
  for (const group of outside) {
    for (const match of text.matchAll(group.pattern)) {
      const before = text.slice(Math.max(0, match.index - 12), match.index);
      const after = text.slice(match.index + match[0].length);
      if (/\b(?:not|no)\s*$/iu.test(before) || /^\s*(?:이|가)?\s*(?:아닌|아님|아니다|아니라)/u.test(after)) continue;
      return group.label;
    }
  }
  return null;
}

export function unsupportedScopePage(material: string, caseId?: string): string {
  return page("지원 범위 밖", `<section data-out-of-scope><h1>지원 범위 밖 · 판정 없음</h1>
    <p>입력에 ${escapeHtml(material)} 재질이 명시되어 있습니다. 현재 앱은 폐플라스틱에 한정한 조건부 검토를 제공합니다.</p>
    <p>이번 요청에서는 새 판정·순위·처리 코드를 생성하지 않았습니다.${caseId ? " 기존 사례와 판정은 수정하지 않았습니다." : ""}</p>
    <ul><li>재질·발생 공정·오염·유해물질 접촉 자료를 먼저 확인하세요.</li>
    <li>해당 폐기물을 지원하는 전문 검토 경로에서 분류·허가·처리 조건을 확인해야 합니다.</li>
    <li>혼합재나 재질 미상을 플라스틱으로 추정하지 않습니다.</li></ul>
    <p><a class="primary-action" href="${caseId ? `/cases/${encodeURIComponent(caseId)}` : "/"}">입력 확인하기</a></p></section>`);
}
