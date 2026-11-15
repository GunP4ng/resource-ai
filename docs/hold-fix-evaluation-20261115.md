# #13 공개 근거 공급 후 실구독 재실행

**확정 비교는 0/18에서 0/18로 유지됐다.** 공개 법령 원문을 연결해 깨끗한 여섯 후보의 인용은 각각 2개에서 7개로 늘었고, 기존 `context-ambiguous/unrelated` 조회 사유는 제거됐다. 그러나 실제 사례의 처리경로 검토·유효 허가·인수·견적·질량·계수는 공개 규정만으로 증명되지 않았다. 게이트는 바꾸지 않았다.

C의 현재 상태는 **needs-review 15, needs-information 3, compared 0**이다. OYS-20261110-003만 `needs-review → needs-information`으로 바뀌었고, 질문은 “확인된 질량은 몇 kg인가요?”다. 이는 기존 정보요청 우선순위가 드러난 결과이며, 질량 답변만으로 허가·경로·인수·계약이 충족된다는 뜻이 아니다. 깨끗한 여섯 후보는 검토 보류 5, 정보요청 1이며 모두 미비교 상태다.

## 실행과 검증 근거

평가 커밋: `40f8f8a9bb853853888bc56048509f3db8d7728c`. 기반 main: `e03b80e46bbe1bbd91bbbf7c80e168d0989b41c3`. 새 브랜치: `fix/public-case-evidence-20261115`.

기존 러너에 C 선택 옵션이 없어 동일 A/B/C 경로를 한 번 실행했다.

```sh
RESOURCE_MODEL_RUNNER=subscription RESOURCE_MODEL_ID=gpt-6-sol \
  bun scripts/eval-development.ts \
  --cases data/evaluation/development.json \
  --out /home/gunp4ng/working/resource-hold-fix-20261115/evidence/runs \
  --max-cases 18 --max-calls 90 --timeout-ms 60000
```

runId: `916d828b-b52e-4b84-9548-f4087fd30196`. Exit 0, cases 18, calls 72, failures 0. 모델은 `chatgpt-subscription/gpt-6-sol`. 모든 호출의 실제 요청 ID·사용량을 기록했다.

| 팔 | 성공 행 | 호출 수 | 고유 요청 ID | SDK 총 토큰 |
|---|---:|---:|---:|---:|
| A | 18 | 18 | 18 | 9,404 |
| B | 18 | 18 | 18 | 75,305 |
| C | 18 | 36 | 36 | 166,459 |
| 합계 | 54 | 72 | 72 | 251,168 |

54행 모두 요청 모델·성공·사용량·요청 ID를 확인했다. 72개 ID는 모두 서로 다르다. 원본 및 실제 입력 해시는 직전 C와 동일하고 모든 팔에서 사진 전송은 false다. 프롬프트와 러너 해시도 직전과 같다. 실패를 제외하거나 유리한 결과를 고르기 위한 재실행은 없었다. 자동 citationAudit 필드는 기존 러너의 `unverified`를 유지하며 사람 감사 완료로 바꾸지 않았다.

저장소에서 확인할 증거:

- [현재 C 원시 18행](../data/evaluation/hold-fix-20261115/C.jsonl)
- [직전 C 원시 18행](../data/evaluation/hold-fix-20261115/before-C.jsonl), runId `f8e46c4d-0dc1-40b9-af75-cbcc85510faf`
- [사례별 전후 사유·추가/제거 사유·담당 주체](../data/evaluation/hold-fix-20261115/summary.json)
- [18건 보류 조건 분류와 여섯 후보 계산값](../data/evaluation/public-evidence-20261115.json)
- [전체 검사 영수증](../data/evaluation/hold-fix-20261115/checks.json), [원문·산술 대조](../data/evaluation/hold-fix-20261115/source-calculation-check.json)

전체 A/B/C 원시 로그와 테스트 원문은 레인 `evidence/`에 보존했다. 실제 요청 ID가 있다는 사실은 정확도나 현장 적합성의 독립 검증이 아니다.

## 사례별 공개 근거와 외부 조건

공통 외부 조건 **E**는 다음과 같다. (1) 배출자·관할기관의 사업장일반폐기물/지정폐기물 분류·신고 이력, (2) 업체 공정담당자의 실제 공정·산출물·용도·법정 유형 및 기준 충족 자료, (3) 관할기관·업체의 유효 허가·방지시설·보관 조건, (4) 업체의 정확한 수지·형태·오염도·지역·물량에 대한 인수 및 계약, (5) 배출자·운송사·처리업체의 실측 질량·거리·수율·견적, (6) 계수 제공기관·LCA 검토자의 동등 경계 수지별 계수, (7) 현장 책임자의 반출·계약·처리 승인이다.

깨끗한 여섯 후보에는 모두 별표 4의 `51-03-01` 조건부 코드, 별표 4의2의 R-3-3 정의, 별표 4의3의 코드별 유형, 별표 5의3 공통기준·조건부 폐포장재 기준, 별표 5의4 오염방지·취급 의무를 연결했다. 규정의 내용과 현장의 충족 사실을 분리했다.

| 사례 | 직전 → 현재 C | 공개로 공급한 부분 | 여전히 필요한 부분·제공자 |
|---|---|---|---|
| HYEOB-20261112-001 | needs-review → needs-review | HDPE·압출 자투리 문맥의 조건부 코드/유형 및 별표 기준, 코드 후보 업체, 부분 계산 | E 전체. 배출자·업체가 분쇄물의 미립자 여부, 보관·비산 방지와 실제 공정 확인 |
| HYEOB-20261112-002 | needs-review → needs-review | PET·성형 자투리 문맥의 동일 근거 및 부분 계산 | E 전체. 공정 자투리와 재활용의무대상 폐포장재의 적용 구분은 배출자·업체가 확인 |
| OYS-20261110-001 | needs-review → needs-review | 영문 PET tray trim 문맥의 동일 근거 및 부분 계산 | E 전체. 합성 질량 24kg는 계량 증거가 아님 |
| OYS-20261110-002 | needs-review → needs-review | 영문 HDPE parison 문맥의 동일 근거 및 부분 계산 | E 전체. 합성 질량 18kg, 실제 인수·시설 조건 미확인 |
| OYS-20261110-003 | needs-review → needs-information | 영문 PP runner 문맥의 동일 근거; 질량 미상 그대로 | 배출자가 질량 제공. 이후에도 E 전체 필요; 실제 경로 승인 없음 |
| OYS-20261110-004 | needs-review → needs-review | 영문 LDPE film trim 문맥의 동일 근거 및 부분 계산 | E 전체. 합성 질량 12kg, 실제 인수·시설 조건 미확인 |
| HYEOB-20261112-003 | needs-review → needs-review | 일반 별표 5의3/5의4 의무 추가 | 층별 수지 명세·라벨·분리 가능성은 배출자, E 전체 |
| HYEOB-20261112-004 | needs-review → needs-review | 동일 일반 의무 | 이전 내용물·SDS·잔류·세척 확인은 배출자, E 전체 |
| HYEOB-20261112-005 | needs-review → needs-review | 동일 일반 의무 | 유해 접촉·질량·지역·혼합 구성은 배출자, E 전체 |
| HYEOB-20261112-006 | needs-review → needs-review | 동일 일반 의무 | 실제 처리 방식·시설 허가·인수는 업체/관할기관, E 전체 |
| HYEOB-20261112-007 | needs-review → needs-review | 동일 일반 의무 | 재사용/재활용 용도·방식·기준은 배출자/업체, E 전체 |
| HYEOB-20261112-008 | needs-review → needs-review | 동일 일반 의무 | 폐유·접촉물질·SDS·잔류·세척은 배출자, E 전체 |
| HYEOB-20261112-009 | needs-information → needs-information | 일반 의무를 조회하지만 사실을 추정하지 않음 | 공정·수지/확인자료·오염·유해 접촉·질량·지역의 여섯 답변은 배출자 |
| HYEOB-20261112-010 | needs-information → needs-information | 자료 속 실행 지시를 근거로 승격하지 않음 | 같은 여섯 답변은 배출자. 입력 속 코드 확정·처리 지시는 미실행 |
| OYS-20261110-006 | needs-review → needs-review | 동일 일반 의무 | PP/ABS 라벨 충돌·수지·오염·접촉·질량은 배출자, E 전체 |
| OYS-20261110-008 | needs-review → needs-review | 동일 일반 의무 | 유해 용제 종류·시험·SDS·지정폐기물·잔류·질량은 배출자/시험기관/관할기관, E 전체 |
| OYS-20261110-009 | needs-review → needs-review | 동일 일반 의무 | 유해 접촉·잔류·세척·기능/잔여수명과 용도는 배출자/업체, E 전체 |
| OYS-20261110-010 | needs-review → needs-review | 동일 일반 의무 | 오염·접촉·질량·지역은 배출자; 가격·계수·단위·허가·인수는 E 담당 주체 |

현재 `needs-information` 행의 응답에는 우선 답변할 질문만 보인다. 따라서 사유 배열에서 다른 항목이 사라졌다는 것만으로 그 조건의 충족을 뜻하지 않는다. 모든 경우 원래 경로 검토·비교 자원 게이트는 그대로다.

## 공급한 원문·업체·계산의 한계

법령 sourceId·SHA·시행본·verifiedThrough·원본 URL 및 계산식은 [근거 설명서](public-case-evidence-20261115.md)에 있다. 기존 registry/manifest의 원본 해시·발췌·이용조건 검증을 그대로 거친다.

별표 5의3은 재활용 기준, 5의4는 재활용자 준수사항이다. 새 원문을 얻었다는 것은 어느 현장이나 업체가 조건을 충족했다는 증명이 아니다. R-3-3 폐포장재 조항을 공정 자투리에 무조건 적용하지 않았다.

코드 일치 업체는 춘일실업·오성아이케이진천지점·에스제이물산 세 곳이다. 모두 환경공단 플랫폼의 **회원등록**이며 원 행정기관 허가명부가 아니다. 공식 허가행 확보는 미완료다. 경기도 원문 응답은 데이터 영역 전에서 끝났고 환경공단 대체 자료는 집계였다. 따라서 검증된 현행 허가·수지별 인수 건수는 0이다. 재배포·상업 사용 권리도 미확인으로 두었다.

비용은 2단계의 수집·선별·거리·운송단가 가정을 재사용한 부분 소계다. 탄소는 공식 UK 워크북 셀을 재확인한 운송 진단만 계산했다. 골판지 가격·WARM 계수는 플라스틱에 옮기지 않았다. 순비용·순탄소·절감량·감축량은 모두 null이며 OYS-003의 질량을 임의 보충하지 않았다.

실제 C에는 법령 registry의 원문 근거가 전달됐다. 업체 후보와 부분 계산은 사례별 검토자료에 연결했으며, 검증되지 않은 현장 허가·견적·경로 판정으로 `DomainResources`에 주입하지 않았다. 따라서 비교 수가 늘지 않은 것은 남은 외부 조건과 일치한다.

## 전체 검사와 자체 검토

| 명령/검사 | 결과 |
|---|---|
| `bun test --timeout 30000` | 823 pass / 0 fail, 41 files, exit 0 |
| `bun run typecheck` | 세 tsc 프로젝트 통과, exit 0 |
| `bun run build` | 16 modules, exit 0 |
| 두 공개 패키지의 기존 `prepare` 및 `verify` | 모두 exit 0 |
| 편집한 TS 테스트 LSP | 오류 없음 |
| JSON LSP | Biome 미설치로 실행 불가; JSON 스키마·원문 해시·전체 테스트 통과 |
| 9개 registry 레코드 해시·인용 | 일치 |
| 새 인용 두 개와 원본 PDF | 화면 및 공백 정규화 본문 일치 |
| 여섯 사례 부분 계산 | 독립 Decimal 산술 및 null 유지 확인 |
| `git diff --check` | exit 0 |
| `src/`, `scripts/`, 원본 평가 manifest·입력 | 변경 없음 |

Bun 1.4.4로 실행했으며 packageManager 지정 1.4.2로 실행했다고 주장하지 않는다. 최초 전체 검사에서 819 pass/4 fail을 관찰했다. 법령 갱신으로 낡아진 공개 패키지 캐시를 기존 생성기로 갱신했고, 만료 테스트 날짜를 새 근거 검증기간 다음 날로 옮겼으며, 패키지가 새 발췌·원본 네 개를 보존하는지 확인하도록 직접 관련 기대값을 갱신했다. assertion 삭제·skip·게이트 완화는 없다.

LIGHT 자체 검토: 데이터 및 기존 생성 절차, 직접 낡아진 테스트의 갱신이다. 별도 reviewer gate는 요청되지 않았다. 소스·러너·프롬프트·임계값·필수 검토 조건을 바꾸지 않았고, 전후 원시 입력 해시·실제 요청 ID와 결과를 대조했다. 이 결과를 정확도 향상이나 현장 실행 가능성의 입증으로 주장하지 않는다.
