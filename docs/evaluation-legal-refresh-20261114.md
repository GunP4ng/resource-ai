# #13 법령 현행성 갱신 후 개발셋 재실행

[7개 인용의 공식 현행성 확인](legal-currency-20261114.md)으로 `verifiedThrough`를 2026-11-14까지 갱신한 뒤, 기존 개발 후보 18건을 실제 `chatgpt-subscription/gpt-6-sol`로 실행했다. 선택된 구독 계정은 `goldpea3`다. 사진 전송은 없고 입력 바이트·프롬프트·러너·서버 판정 규칙을 바꾸지 않았다. 독립 사람 라벨이나 사례별 검토자료를 새로 만들지 않았다.

**결과: 확정 비교(`compared`) 0/18, 검토 보류(`needs-review`) 16/18, 정보 요청(`needs-information`) 2/18.** 깨끗한 단일 수지 후보 6건도 모두 검토 보류다. 법령 날짜 문제는 해소됐지만 사례별 적합성·허가·비교 자료까지 확보된 것은 아니다.

## 실제 실행과 중단 기록

```sh
RESOURCE_MODEL_RUNNER=subscription RESOURCE_MODEL_ID=gpt-6-sol \
  bun scripts/eval-development.ts \
  --cases data/evaluation/development.json \
  --out data/evaluation/legal-refresh-runs \
  --max-cases 18 --max-calls 90 --timeout-ms 60000
```

첫 실행은 감시 도구의 기본 300,000ms 제한으로 종료됐다. 이 실행 전체가 정상 종료됐다고 주장하지 않는다. `c29b5756-56c7-453e-96f5-d179d7b0710d`의 A/B/C 파일에는 각각 앞의 **14건이 완결된 행**으로 남았다. 이 42행은 모두 실행 성공이며 기록된 제공자 호출은 56회다. 원시 파일을 보존하고 읽기 전용으로 고정했다. 중단 순간 진행 중이었을 수 있는 요청의 ID·사용량은 확보되지 않았으므로 성공이나 확정 건수로 만들어 넣지 않는다.

남은 OYS-006/008/009/010 네 사례만 원본 manifest에서 그대로 뽑아 아래 명령으로 이어서 실행했다. 완료된 사례는 반복하지 않았다. 입력 파일·`sourceHash`·권리 정보는 원본과 동일하며, 감시 제한은 3,600,000ms로 명시했다.

```sh
RESOURCE_MODEL_RUNNER=subscription RESOURCE_MODEL_ID=gpt-6-sol \
  bun scripts/eval-development.ts \
  --cases data/evaluation/legal-refresh-remaining.json \
  --out data/evaluation/legal-refresh-runs \
  --max-cases 4 --max-calls 20 --timeout-ms 60000
```

후속 실행 `d49a8fcf-bb42-4d54-8ee1-4148e15373cc`은 종료 코드 0, `cases=4, calls=16, failures=0`이다. 두 실행의 완결 행을 합치면 54행, 기록된 요청 ID 72개이며 전부 서로 다르다. 팔별 사례 ID는 각각 18개이고 중복이 없다. 최초 #13 실행과 입력 SHA 및 실제 입력 SHA가 모두 일치한다. `sourceVersion`은 두 실행에서 동일한 `d75256bbb3abde22f44a5eca073410c458cc5bf288970062b69b71431b50f886`이다.

첫 실행은 커밋 전 갱신 데이터를 읽었으므로 `gitSha=c9dba4b0b72d78c712bbf2f37c31ca5d6feb0442`와 갱신 데이터 해시를 함께 기록한다. 깨끗한 c9dba4b에서 실행했다고 해석하면 안 된다. 후속 실행은 `b6021750454ada2e4a6c15e8d8cbe1035319ce05`다. 두 실행의 `evidenceCandidates` SHA는 모두 `a796b47200eec49155a87ecd20856788b14f5058bd19d7498f0ea488e5e34186`이며 첫 갱신 커밋의 데이터와 일치한다. 평가 코드와 입력은 변경하지 않았다.

| 팔 | 완결 성공/기록 행 | 기록된 제공자 호출·ID | 오류 행 | SDK 입력/출력/총 토큰 |
| --- | ---: | ---: | ---: | ---: |
| A 일반 모델 | 18/18 | 18 | 0 | 4,567 / 5,359 / 9,926 |
| B 법령 조회 전달 | 18/18 | 18 | 0 | 27,577 / 7,857 / 35,434 |
| C 사례 도구·서버 게이트 | 18/18 | 36 | 0 | 87,964 / 1,876 / 89,840 |

위 표는 저장된 완결 행만 센 값이다. 중단된 진행 중 요청 가능성을 제외한 **기록된 호출 수**이며 청구량이나 계정 전체 사용량이 아니다. A/B의 `decision`은 자유 서술로 보존하며 C의 서버 상태와 같은 의미의 자동 점수로 바꾸지 않았다.

## 사례별 전후 판정

아래 이전 판정은 최초 실행 `a1ac2d7e-4df0-4bdf-8b71-d53f93f88aa9`의 C 원시 행이다. 모든 사례에서 B/C가 채택한 일반 법령 근거는 **0개 → 2개**다. 날짜 이슈 36개는 0개가 됐지만 특화 코드·유형 근거의 `context-ambiguous` 3개, `unrelated` 45개, `context-missing` 6개는 남았다. 이 진단 건수는 사례 수를 분모로 한 정확도 지표가 아니다.

공통 보류 조건은 사례 revision에 묶인 처리경로 검토, 실제 재활용 공정·산출물·용도·세부기준 충족, 시설 허가·인수, 비교에 필요한 견적·질량·계수 자료 미확보다. 일반 조문 두 개만으로 이를 충족했다고 승격하지 않았다. `scripts/eval-development.ts`는 기존처럼 `createResourceDomain(facts)`를 호출하며 별도 `DomainResources.routeReviews`·비교 자원을 공급하지 않는다. [오연석 #54](https://github.com/GunP4ng/resource-ai/issues/54)는 조회 시 OPEN이고 이 사례별 자료 패키지를 인계하는 작업이다.

| 사례 ID | 이전 C → 이번 C | 남은 사유 |
| --- | --- | --- |
| HYEOB-20261112-001 | needs-review → needs-review | HDPE·압출 자투리 분쇄 조건은 등록된 개별 인용과 모호하게 일치; 공통 검토자료 없음 |
| HYEOB-20261112-002 | needs-review → needs-review | PET·성형 자투리 선별은 현재 PP/PE 사출·압출 인용의 적용 범위 밖; 공통 검토자료 없음 |
| HYEOB-20261112-003 | needs-review → needs-review | 혼합·라벨 불일치, 층별 재질·분리 가능 자료 및 적용 근거 미확인 |
| HYEOB-20261112-004 | needs-review → needs-review | 오염·접촉 이력, SDS·잔류물·세척 확인 자료 미확인 |
| HYEOB-20261112-005 | needs-review → needs-review | 혼합·라벨 불일치, 접촉 이력·질량·지역 등 누락 및 적용 근거 미확인 |
| HYEOB-20261112-006 | needs-review → needs-review | 사례에 맞는 코드·유형 및 시설 허가·인수 등 공통 검토자료 미공급 |
| HYEOB-20261112-007 | needs-review → needs-review | 재사용·재활용·회수·처분의 구체적 방식·용도와 사례별 기준 충족 미확인 |
| HYEOB-20261112-008 | needs-review → needs-review | 오염·접촉 이력, SDS·잔류물 확인과 사례별 적합성 자료 없음 |
| HYEOB-20261112-009 | needs-review → needs-information | 날짜 문제 해소 후 공정·수지·오염·접촉·질량·지역 6개 정보 질문으로 전환; 확정 비교 아님 |
| HYEOB-20261112-010 | needs-review → needs-information | 같은 6개 필수 정보 질문; 내장 지시를 근거나 승인으로 취급하지 않음 |
| OYS-20261110-001 | needs-review → needs-review | PET 및 영문 공정·오염 조건이 특화 인용과 일치하지 않음; 공통 검토자료 없음 |
| OYS-20261110-002 | needs-review → needs-review | HDPE 및 영문 공정·오염 조건이 특화 인용과 일치하지 않음; 공통 검토자료 없음 |
| OYS-20261110-003 | needs-review → needs-review | PP이지만 영문 공정·오염 조건 불일치, 질량 미확인 및 공통 검토자료 없음 |
| OYS-20261110-004 | needs-review → needs-review | LDPE 및 영문 공정·오염 조건 불일치; 공통 검토자료 없음 |
| OYS-20261110-006 | needs-review → needs-review | 혼합·다층·라벨 불일치와 수지·오염·접촉·질량 질문, 적용 근거 미확인 |
| OYS-20261110-008 | needs-review → needs-review | 유해물질 접촉 보고, 지정폐기물·SDS·잔류물·질량 및 적용 기준 검토 필요 |
| OYS-20261110-009 | needs-review → needs-review | 접촉 이력 및 재사용·재활용 방식·용도·기준과 검토자료 미확인 |
| OYS-20261110-010 | needs-review → needs-review | 오염·접촉·질량·지역 및 가격·계수·단위 근거 미확인 |

정상 후보 6건은 H001/H002/O001/O002/O003/O004다. 6건 모두 `compared`가 되지 않았다. 입력을 한국어로 고쳐 맞추거나 HDPE/LDPE/PET에 PP/PE 인용을 확대하지 않았고 검토자료를 합성하지 않았다. 따라서 `candidates_now_passing=0`이다. 이것은 이번 서버 판정 결과이며 정확도 점수나 현장 적합성 판정이 아니다.

## 검증과 원시 증거

- `bun test --timeout 30000`: **790 pass / 0 fail**, 37개 파일.
- `bun run typecheck`: 종료 코드 0.
- `bun run build`: 종료 코드 0.
- 2026-11-14 실제 조회: 일치하는 PP·사출 입력의 일반 근거 5개, 이슈 0개. 2026-11-15 조회: 근거 0개, `currentness-unverified` 5개. 유효기간 바깥 날짜는 계속 보류한다.
- 최초 전체 테스트에서 구 11월 6일 만료 전제와 H009/H010의 전부 검토 보류 전제가 낡았음을 확인했다. 만료 입력은 11월 15일로 이동하고 H 판정은 정확한 8건 검토 보류·2건 정보 요청으로 검증한다. 기존 assertion을 삭제·skip하지 않았다.
- 기존 제공자 timeout 테스트는 5초 timeout을 세 번 순차 실행하므로 기본 5초 테스트 제한에 걸렸다. 테스트나 제공자 timeout을 줄이지 않고 실행기의 제한만 30초로 지정해 전부 통과했다.

원시 결과: [첫 14건](../data/evaluation/legal-refresh-runs/c29b5756-56c7-453e-96f5-d179d7b0710d/) · [나머지 4건](../data/evaluation/legal-refresh-runs/d49a8fcf-bb42-4d54-8ee1-4148e15373cc/) · [전후 비교·요청 ID 요약](../data/evaluation/legal-refresh-runs/summary.json) · [중단 기록](../data/evaluation/legal-refresh-runs/interruption.json) · [후속 manifest](../data/evaluation/legal-refresh-remaining.json).

법령 원본 조회·검사 로그·정리 기록은 lane의 `evidence/`에 보존한다. 평가 프로세스는 종료됐고 중단된 테스트·평가의 임시 사례 디렉터리도 정리했다. 첫 원시 실행의 중단 기록은 숨기지 않는다.
