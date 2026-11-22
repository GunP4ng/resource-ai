# Re:Source AI

공장에서 나온 폐플라스틱, 금속 스크랩, 폐목재, 포장재를 입력하면 어떻게 재활용하거나 처리할지 추천하는 AI 에이전트 앱이다. 추천마다 법령 원문 근거를 붙이고, 자료가 있는 재질은 비용과 탄소도 비교한다.

AXR AI Bootcamp Innovation Challenger 2026 Microsoft 주제 "Re:Source AI - Microsoft AI 기반 산업자원 순환·재활용 에이전트 개발" 제출작이다.

## 푸는 문제

중소 제조업체 환경 담당자는 공정에서 나온 부산물을 재활용할 수 있는지, 어디에 맡길지, 비용과 탄소가 얼마인지 직접 판단해야 한다. 법령은 별표 여러 개에 흩어져 있고 업체, 단가, 탄소 계수도 따로 찾아야 한다.

Re:Source AI는 주제 자료의 흐름을 화면 하나로 묶는다.

식별·분류 → 재사용·재활용 가능성 → 규정 검토 → 활용 업종·업체 → 비용·탄소 비교 → 처리 방안

## 할 수 있는 일

- 재질, 공정, 오염 상태를 넣으면 재활용 경로를 추천한다. 맨 위에 결론 한 줄과 다음에 할 일이 나온다.
- 폐기물관리법 시행규칙 별표 4·4의2·4의3·5의3에서 해당 조문 위치와 원문을 붙인다. 평가 기준일에 맞는 시행본을 고른다(2026-11-11까지 290881, 11-12부터 291947).
- 바로 추천하기 어려운 사례에는 "분리·세척하면 원료 재활용 검토"처럼 조건별 대안과 먼저 확인할 자료를 보여 준다.
- 유해물질 접촉, 지정폐기물 의심, 도료·방부제·오일·납·도금 같은 위험 표현, 입력 모순이 있으면 보류한다. 안전 사유를 맨 앞에 두고, 입력에서 찾은 위험 표현을 함께 보여 준다. "오일 없음"처럼 없다고 적은 내용은 그대로 받아들이고, 뜻이 불분명한 잔류 표현은 다시 묻는다.
- 6단계마다 이 사례에서 채워졌는지, 비었다면 왜 비었는지 보여 준다.
- PET·HDPE는 질량을 넣으면 재활용·매립·소각의 비용과 탄소를 비교한다. 모르는 값이 있어도 결론이 바뀌지 않는 범위를 같이 보여 준다(예: 소각 단가가 0원/t 이상이면 순위 그대로).
- 공개 처분 문의처와 재활용업 허가 목록을 후보로 보여 주고, 업체에 보낼 문의서를 A4 한 장으로 뽑는다.
- 질량을 몰라도 추천이 먼저 나온다. 질량은 계산용 선택 질문으로 받는다.
- 철스크랩, 폐신문지, 폐골판지는 [한국환경공단 2026년 10월 가격조사](data/reference/keco-material-price-reference-20261122.json)의 전국 매입가격을 참고값으로 보여 준다.

## 실행

Bun 1.4.2 이상이 필요하다(Linux x64에서 확인). senpi SDK는 Node 24 이상을 쓴다.

```sh
bun install --frozen-lockfile --ignore-scripts
bun run app
```

senpi에서 구독 계정에 로그인한 뒤 브라우저에서 `http://localhost:3000`을 연다. 포트는 `PORT`로 바꾼다.

검사와 평가 재현:

```sh
bun run typecheck
bun run build
bun run smoke
bun test --timeout 30000 ./tests
bun scripts/measure-guidance.ts --out /absolute/path/to/new-evidence-directory
```

마지막 명령은 아래 평가 결과(18건, 131건)를 다시 만들고 해시와 함께 저장한다.

11/25 발표 데모 순서는 [데모 대본](docs/demo-2026-11-25/README.md)에 있다.

### 실행 모드

| `RESOURCE_MODEL_RUNNER` | 동작 |
|---|---|
| `subscription` (기본값) | senpi 로그인(`chatgpt-subscription`)으로 구독 모델을 부른다. 인증이 없으면 제출이 HTTP 503으로 끝난다. `RESOURCE_AUTH_PATH`, `RESOURCE_MODEL_ID`로 인증 파일과 모델을 고른다. |
| `azure` | Azure OpenAI runner를 쓴다. `.env.example`의 키, endpoint, deployment 설정이 필요하다. |
| `operational` | 인증된 운영자의 요청별 권한·한도·감사 설정을 사용한다. [운영 설정](docs/o-operational-handoff.md)이 필요하다. |

모델은 제안하고 앱이 검증한다. 판정, 인용, 계산은 앱 규칙이 확인하고, 모델 제안과 앱이 받아들이거나 막은 내용은 단계별 기록으로 남는다.

### 사례 저장

기본 앱은 익명 세션이라 다시 켜면 사례가 사라진다. 로컬 계정으로 SQLite에 저장하려면:

```sh
bun scripts/o-account.ts create --state-dir /absolute/path/resource-state --username operator
RESOURCE_APP_AUTH=local-operator RESOURCE_STATE_DIR=/absolute/path/resource-state bun run app
```

`/login`에서 로그인하면 `/cases`에서 사례를 다시 연다. 연구용 계산과 모델 검증 기록은 로그인한 연구 화면에서 본다. 사진을 모델로 보내는 기능은 기본으로 꺼져 있다. 자세한 설정은 [런타임 통합 문서](docs/o-runtime-integration.md)와 [사진 실행 범위](docs/photo-execution-scope.md)에 있다.

HTTPS 프록시 뒤에 배포할 때는 `RESOURCE_PUBLIC_ORIGIN=https://resource-ai.o-r.kr`처럼 공개 출처를 지정한다. 앱은 루프백에 계속 바인딩하고, 브라우저 요청 출처와 `Secure` 세션 쿠키는 공개 HTTPS 주소를 기준으로 처리한다. 기존 운영자 세션은 한 번 다시 로그인한다.

## 구조

```text
브라우저(입력 폼·결과·인쇄)
  └─ 앱 서버 scripts/app.ts
       ├─ 입력 검증·추가 질문 (src/input.ts)
       ├─ 판정 규칙·안전 보류 (src/assessment.ts, src/recommendation.ts)
       ├─ 재질·위험 표현 해석 (src/material-context.ts)
       ├─ 법령 근거 조회 (src/evidence.ts ← data/reference/legal)
       ├─ 업체·비용·탄소 계산 (data/reference, 공개 시나리오)
       └─ 모델 runner: subscription | azure | operational (senpi SDK 세션)
```

설계 비교는 [아키텍처 문서](docs/architecture.md)에 있다.

## 평가 결과

평가에는 합성·공개 개발 입력을 썼다.

- 기존 18건의 판정은 추천 8, 추가 정보 필요 6, 검토 필요 4다. 재질을 넓힌 뒤에도 그대로다([기록](data/evaluation/material-expansion-20261122/summary.json)).
- 같은 18건을 일반 모델(A), 검색을 붙인 모델(B), Re:Source(C)에 넣고 방식 이름을 가린 채 채점했다. 꼭 물어야 할 확인 질문 33개 중 A는 3개, B는 0개, C는 28개를 짚었다([채점 기록](data/evaluation/rubric-followup-20261121/README.md)).
- 유해·모순 사례 4건은 세 방식 모두 보류했다. 없는 업체, 가격, 계수를 만든 방식은 없었다.
- 금속·목재·종이·복합 포장재 [안전 시험셋 131건](data/evaluation/material-safety-20261122/README.md)이 모두 기대대로 나온다. 위험 표현, 없다고 쓴 표현, 둘이 섞인 표현, 잔류 표현을 담았다. 이 셋을 만들면서 "푸른 잔류막", "납으로 오염"처럼 추천으로 빠지던 입력을 찾아 막았다.
- [실제 구독 모델 실행 기록](data/evaluation/live-material-20261122/README.md): 정상 금속, 납 오염 금속, 원목 3건을 기본 runner(`gpt-6-sol`)로 돌렸다. 정상 2건은 조건부 추천, 납 오염은 보류다. 요청 6번 모두 HTTP 200, 재시도 0번이다. 세 건 모두 모델이 앱이 제시한 판정을 골랐다.

측정 방법은 [평가 문서](docs/evaluation.md)와 [검증 기록](docs/verification.md)에 있다.

## 범위

- 대상 재질은 폐플라스틱, 철·비철 스크랩, 폐목재, 종이·복합 포장재다. PVC는 경로 근거가 부족해 보류한다.
- 비용·탄소 계산은 PET·HDPE에 쓴다. 탄소 계수는 미국 EPA WARM이고, 국내 GIR·KEITI 값은 참고로 함께 보여 준다. 금액을 고시로 정하는 처리비는 근거 조례 조항을 보여 준다.
- 질량은 한 사례에 1,000,000 kg까지 받는다. 더 많으면 나눠서 넣는다.
- 업체는 공개 목록에서 찾은 후보다. 실제 인수 여부와 견적은 문의서로 업체에 확인한다.

## 데이터 출처

- 법령: 국가법령정보센터 폐기물관리법 시행규칙 별표 원문(`data/reference/legal`)
- 탄소: US EPA WARM, 온실가스종합정보센터(GIR) 국가 계수, 한국환경산업기술원(KEITI) 환경성적표지
- 가격·업체: 한국환경공단 재활용 가격조사, 공개 처분·재활용업 목록(`data/reference`)

출처별 라이선스와 조회일은 [데이터 출처 문서](docs/data-sources.md)에 있다.

## 팀

| 이름 | 역할 |
|---|---|
| 이태용 | 팀장. 총괄, 범위 조정, 통합 검토 |
| 윤정준 | 법령 원문, 시행본 관리, 근거 조회 |
| 이상협 | 입력, 추가 질문, 판정, 구독 runner 연결 |
| 오연석 | 업체, 비용, 탄소, 앱 화면 |

작업 분담은 [팀 작업 문서](docs/team-tasks.md)에 있다.
