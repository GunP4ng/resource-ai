import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const audit = JSON.parse(await readFile(join(directory, "summary.json"), "utf8"));
const sensitivity = JSON.parse(await readFile(join(directory, "comparison/sensitivity-complete.json"), "utf8"));
const contrasts = JSON.parse(await readFile(join(directory, "comparison/contrasts.json"), "utf8"));
const contrastStates = Object.groupBy(contrasts, row => row.result.state);
const compared = contrastStates.compared ?? [];
const firstRoutes = [...new Set(compared.map(row => row.first_recommended_route))];
assert.equal(contrasts.length, 36);
assert.deepEqual(firstRoutes, ["mechanical-recycling"]);
assert.equal(audit.recordCount, 54);
assert.equal(sensitivity.rows.length, 18);
const lines = [
  "# 저장된 A/B/C 공통 감사와 민감도",
  "",
  "팔 표시를 가린 코딩 에이전트의 사후 감사다. 독립 사람 평가나 완전한 블라인드가 아니다. 체크리스트·묶음을 먼저 고정하고54행의판단·근거를잠근뒤팔을연결했다. 새 사례 추론0회다. `protocol.md`, `mask-manifest.json`, `scores/score-lock.json`, `arm-map.json`으로 순서를 추적한다.",
  "",
  "## 공통 체크리스트 결과",
  "",
  "| 항목 | A | B | C |",
  "|---|---:|---:|---:|",
  `| 지정4사례의 무조건 실행 권고 | ${audit.summary.map(a => `${a.executionFour["unconditional-execution"] ?? 0}/4`).join(" | ")} |`,
  `| 지정4사례의 보류·조사 요청 | ${audit.summary.map(a => `${a.executionFour["hold-or-investigate"] ?? 0}/4`).join(" | ")} |`,
  `| 구체 업체·가격·계수 주장 건수 | ${audit.summary.map(a => Object.values(a.claims).reduce((sum, c) => sum + c.count, 0)).join(" | ")} |`,
  `| 구체 인용을 제시한 출력 | ${audit.summary.map(a => `${a.citations.casesWithCitations}/18`).join(" | ")} |`,
  `| 인용:정확일치/부분일치/미등록 | ${audit.summary.map(a => `${a.citations.statuses["exact-registered"] ?? 0}/${a.citations.statuses["partial-registered"] ?? 0}/${a.citations.statuses.unregistered ?? 0}`).join(" | ")} |`,
  `| 필수 질문 원자항목 충족 | ${audit.summary.map(a => `${a.criticalQuestions.asked}/${a.criticalQuestions.count}`).join(" | ")} |`,
  `| 필수 질문 전부 충족한 사례 | ${audit.summary.map(a => `${a.criticalQuestions.allAskedCases}/${a.criticalQuestions.applicableCases}`).join(" | ")} |`,
  "",
  "네 사례는 다층·혼합2건, 라벨모순1건, 유해접촉1건이다. 네 개 모두 법적으로 유해하다는 정답 라벨은 아니다. 이 표에서 C의 위험 차단 우위는 관측되지 않았다. 세 팔 모두 구체 업체·가격·계수를 생성하지 않았으므로 허구 생성 감소도 입증되지 않는다. C는 이 고정 질문 목록에서 더 많은 구체 정보 요청을 했고, 레지스트리와 정확히 결합된 인용을 더 많이 남겼다. 이것은 작은 기노출 코퍼스의 기술적 관측이며 전반 정확도나 인과 효과가 아니다.",
  "",
  "A의 구체 인용0은 인용 정확도100%가 아니라 N/A다. B/C의 미등록 인용에는 확인 필요라는 별표 언급과 메타데이터 법률 참조가 포함된다. 미등록은 제공 등록부로 대조할 수 없다는 뜻이며 거짓 법령이나 위험 실행을 뜻하지 않는다. 원문·판단·제외 이유는 scores의개별행에있다. 동일 출처·위치·시행본 반복은 한 출력 안에서 합쳤다.",
  "",
  "질문 분모33은 원본 입력에서 정한 필수 정보 원자항목이다. 필수 누락이 없는8사례/팔은N/A다. A의1개 모호 항목은 충족으로 세지 않았다. 일반적인 전문가 문의나 정보 미확인 서술은 구체 요청으로 세지 않는다. 질량·지역·현장 실행 확인은 별도의 선택/후속 항목이며 정성적 추천 실패로 치환하지 않는다.",
  "",
  "## 현재 규칙의 순위 대비",
  "",
  `원본 PET의 수지6종×오염6종=${contrasts.length}개 고정 로컬 입력을 실제 도메인으로 실행했다. ${compared.length}개는 compared, ${contrastStates["needs-review"]?.length ?? 0}개는 needs-review, ${contrastStates["needs-information"]?.length ?? 0}개는 needs-information이었다. 비교가 가능한 ${compared.length}개 모두 1순위는 ${firstRoutes.join(", ")}이었다. \`comparison/contrasts.json\`과 \`comparison/design.json\`에 모든 입력·출력과 범위가 있다.`,
  "",
  "공개 근거만 쓰는 현재 fallback은 기계적 재활용만추천후보로만든다. 조건을 바꾸면 추천과 보류는 달라지지만 이36개에서는 다른 처리경로가1순위가 되지 않았다. 검증된 별도 운영 자료가 있는 모든 가능한 구성까지 불가능하다고 주장하지 않는다. 임의 허가·비용·탄소를 주입해 다른1순위를 만들지 않았다.",
  "",
  "## 배분율·기준단가 민감도",
  "",
  "y는 기존 엔진의 WARM 재활용 배분율이다. 실제 재생원료 대체율 또는 측정 수율이라고 부르지 않는다. 물리적 대체율을 독립적으로 바꾸는 변수는 이 모델에 없다. 표는 원본PET24kg/HDPE18kg, y0.6/0.8/1.0과KECO기준가격배수0.8/1.0/1.2를 조합한18개가정이다. HDPE는원래genericPE가격대용이라는전제를유지한다.",
  "",
  "| 수지 | y | 단가 배수 | 재활용 순비용 KRW | 순탄소 kgCO2e | 매립 대비 비용 차이 KRW | 매립 대비 탄소 차이 kgCO2e |",
  "|---|---:|---:|---:|---:|---:|---:|",
];
for (const row of sensitivity.rows) {
  const result = row.actual_results.find(r => r.route_id === "recycling");
  assert.ok(result);
  const fixed = value => value === null ? "미산정" : value.toFixed(4);
  lines.push(`| ${row.provenance.material} | ${row.provenance.y} | ${row.provenance.price_multiplier} | ${fixed(result.net_cost_krw)} | ${fixed(result.net_carbon_kgco2e)} | ${fixed(result.cost_saving_krw)} | ${fixed(result.scenario_carbon_difference_kgco2e)} |`);
}
lines.push("", "표는 보존된 엔진 원시 수치를4자리로 표시했다. 공식 앱의 원 단위 표시와 구분한다.18개모두재활용이매립보다비용·탄소축에서낮았지만, 소각비용이없어전체3경로의Pareto최적성을판정하지않는다. 단가변화는탄소를바꾸지않으며배분율변화가탄소를바꾼다.",
  "", `독립 유리수 계산과612개 숫자를 비교한 최대 절대오차는${sensitivity.maximumAbsoluteError}다. 원 단위 표시1개는 일치하지 않았다: HDPE y1/가격0.8의매립대비비용차이는정확십진7942.5인데엔진이binary7942.499999999999를반올림해7942를표시하고독립식은7943이다. 이 불일치를없애거나녹색으로숨기지않았다. 비교경로순위는변하지않았다.`,
  "", "최초 검증기는 이 표시 차이에서 멈추며16개의메모리상결과를저장하지못했다. 실패원본은`comparison/execution-failure.json`에보존했다. 이후16개만다시계산해각행을검증전에저장했고기존2개와합쳐18개원시출력을확보했다. 복구명령은`bun data/evaluation/rubric-followup-20261121/comparison/complete-missing.ts`이며표시불일치가남아exit1을유지했다. 새모델호출은없다.",
  "", "## 소각 비용과 업체 후보",
  "", "현재 사업장 폐플라스틱에 적용 범위·기준일·운송/VAT경계가 확인된 공개 소각비를 확보하지 못했다. 인천2017자료와여수2026예산항목은역사값/처리방식·적용범위미확인으로계산에넣지않았다. f_inc는null을유지한다.",
  "", "공공데이터포털15056401의실제CSV에서폐합성수지중간/최종/종합재활용업4행을확인했다. `data/reference/public-recycling-candidates-20261121.json`에원문행번호·출처·기준일·조회시각·원본해시를기록하고대표자명은제외했다. 인수 의사 아님. 현재허가유효성·처리공정·등급·물량·가격·인수는별도확인이다.",
  "", "재현: `bun data/evaluation/rubric-followup-20261121/decode-scores.mjs --verify`는새추론없이동결파일·54행·팔별18행·분모를검사한다. 이 문서는 개발 검증 기록이며 제출 보고서·발표·영상 대본이 아니다.",
);
await writeFile(join(directory, "README.md"), lines.join("\n") + "\n");
console.log("Rendered54-output audit and18-row sensitivity table from preserved results");
