# Re:Source AI

중소 제조업체 환경 담당자를 위한 **근거 기반 폐플라스틱 의사결정 지원** 설계와 구현.
AXR AI Bootcamp Innovation Challenger 2026 Microsoft 주제를 대상으로 한다.

**현재 상태: 로컬 사례·답변·보고서 앱과 도메인 검증이 구현되어 있다. 운영 인증·검토 자료·실제 제공자 검증은 별도 인수 대상이다.**
O4는 신뢰된 서버 인증을 주입하면 사례 소유권과 비공개 사진 저장·미리보기·철회를 제공한다. 기본 launcher는 익명 텍스트 앱이며 사진 모델 전송을 활성화하지 않는다.

## 추천 구조

작은 사용자 앱 → 하나의 senpi SDK 세션 → 구독 모델(기본 `chatgpt-subscription` / `gpt-6-sol`, Azure는 opt-in) + 독립 도메인 도구 → 출처·조건·불확실성이 있는 비교 보고서.
판정·업체·비교 도구는 앱의 사례별 세션에만 주입된다. 공식 extension은 CLI용 상태 조회 도구 `resource_project_status` 1개만 등록한다. skill/MCP/Foundry 네이티브 조합을 비교한 뒤 이 구조를 택했다.

## 시작

팀원은 [docs/team-tasks.md](docs/team-tasks.md)부터 읽고 자기 담당 작업을 시작한다.

검증 환경: Linux x64, Bun 1.4.2. senpi의 Node 요구는 >=24다.

```sh
bun install --frozen-lockfile --ignore-scripts
bun run typecheck
bun run build
bun run smoke
```

smoke는 소스와 빌드된 extension을 **실제 senpi loader**로 열고, SDK에서 Azure provider와 명시적 도구 선택을 확인한다. 모델에 프롬프트를 보내지 않아 Azure 키나 유료 호출은 필요하지 않다. 생성한 임시 상태는 종료 시 삭제한다. 사용자 global senpi 설정을 사용하지 않는다.

현재 도구 `resource_project_status`는 `stage=review-bound-host-comparison`, `decisionEngine=server-reviewed-inputs-required`, `azureLiveVerified=false`를 반환한다(`src/extension.ts`). 등록 진단일 뿐이며 제품 데모나 성능 결과로 제시하지 않는다. (2026-11-12 정정: 이전 문구의 `stage=scaffold`, `decisionEngine=not-implemented`는 초기 골격 값이다.)

도메인 구현을 시작할 때 `src/contracts.ts`부터 합의하고, `data/*.example.json`을 실제 데이터와 구분한다. `.env.example`에는 변수명만 있으며 실제 키를 커밋하지 않는다.

## 앱의 구독 모델 runner

`bun run app`은 기본으로 `chatgpt-subscription` / `gpt-6-sol`을 사용한다.
기존 senpi 로그인 `auth.json`을 SDK가 읽으며 Azure 환경변수는 필요하지 않다.
로그인은 senpi에서 먼저 완료한다. 앱은 로그인 화면을 띄우거나 비밀값을 입력받지 않는다.
`RESOURCE_AUTH_PATH`로 서버가 소유한 auth.json 경로를 지정할 수 있고,
`RESOURCE_MODEL_ID`로 설치된 SDK의 모델을 선택할 수 있다.
인증이나 모델이 없으면 제출은 HTTP 503(`not-configured`)으로 끝난다.
구독이 설정돼 있으면 제출 시 실제 모델 요청이 발생하므로 승인된 사례만 사용한다.

`RESOURCE_MODEL_RUNNER=local bun run app`은 모델 호출 없이 기존 질문/답변/보류 흐름을 실행한다.
`RESOURCE_MODEL_RUNNER=azure bun run app`은 기존 Azure runner를 명시적으로 선택한다.
이때만 `.env.example`의 Azure 키·endpoint·deployment 설정이 필요하다.
공유 운영 배포의 요청별 승인/감사·사진 동의·운영 자료 공급은 별도 인수 대상이며
이 loopback launcher가 그 통합 완료를 의미하지 않는다.
테스트는 합성 OAuth와 주입 HTTP/SSE만 사용하며 실제 유료 요청을 보내지 않는다.

O4 인증·사진 통합 API와 제한은 [O 인수 문서](docs/o-handoff.md#o4-application-transaction-and-photo-boundary-2026-11-06)에 있다.
PR27 사진 모델 동의는 [H 실행 범위 authority](docs/photo-execution-scope.md)의 서버 발급 ticket에 묶인다. 운영 매핑은 기본 제공하지 않으며 `photoPolicy.guardedModel` 문구만으로 사진 전송을 허용하지 않는다. 2026-11-12 정정: PR #28(`2ee1cb2`)로 구독 provider/model/account·목적에 묶인 사진 실행 경로(`SubscriptionTarget`, `src/photo-execution.ts`)가 구현됐다. 단 `bun run app` launcher는 사진 실행 authority를 주입하지 않으므로 기본값은 꺼짐이다. `RESOURCE_PRIVATE_PHOTOS=on`은 비공개 사진 저장만 켜며 모델 전송을 허용하지 않는다. 서버 통합자가 승인된 매핑으로 authority를 발급할 때만 켜진다. 실제 계정·현장 사진 실행은 인수되지 않았다.
네이티브 입력 폼은 사진 없이 사례를 먼저 만들며, 생략된 `photoRefs`는 H의 폼 변환에서 `[]`로 정규화한다. JSON 제출은 여전히 `photoRefs` 배열을 명시해야 한다.
데스크톱/모바일 담당자는 `bun qa-o4.ts`로 `http://localhost:3001`의 **합성 QA 전용** 앱을 실행할 수 있다.
이 harness는 고정 가짜 인증과 worktree의 `.qa-o4-photos` 저장소를 사용하며 모델을 호출하지 않는다. 운영 배포에 사용하지 않는다.

## 읽는 순서

로컬 계정·SQLite 보관을 켜는 실행 경로:

```sh
bun scripts/o-account.ts create --state-dir /absolute/private/resource-state --username operator
RESOURCE_MODEL_RUNNER=local RESOURCE_APP_AUTH=local-operator RESOURCE_STATE_DIR=/absolute/private/resource-state bun run app
```

비밀번호는 터미널에서 숨김 입력한다. `http://localhost:3000/login`에서 로그인하고
`/cases`에서 사례를 복구한다. 사례 화면의 입력 내보내기는 정확한 입력과 revision ETag를
제공한다. 자료 설치·재평가·패키지 CLI·사진 삭제 및 3분/2분 시연 절차는
[런타임 통합 문서](docs/o-runtime-integration.md)에 있다. `bun run demo:o`의 HTML은
핸들러 생성 산출물이며 실제 브라우저 검증이나 영상이 아니다.

1. [대회 근거와 영상 확인](docs/competition-evidence.md)
2. [대안 비교·권장 아키텍처](docs/architecture.md)
3. [senpi 실제 API·Azure 구성](docs/senpi-and-azure.md)
4. [데이터 출처·비용/탄소 방법](docs/data-sources.md)
5. [30건 평가·개선 기록](docs/evaluation.md)
6. [100점 심사 매핑·발표](docs/rubric-and-demo.md)
7. [역할·일정·작업 목록](docs/delivery-plan.md)
8. [검증·독립 검토 결과](docs/verification.md)

## 범위와 정직한 한계

- 법적 폐기물 코드·유해성은 사진만으로 확정하지 않는다.
- 출처/허가/계수가 부족하면 질문·보류·비교 불가로 표시한다.
- 원가·탄소 수치는 실제 quote/계수·단위·경계가 확보된 경우에만 계산한다.
- 대회 제출 형식·최종 업로드 시각·Azure 크레딧 금액은 운영진/팀 계정 확인이 남아 있다.
- 교육용 가상 데이터 정확도는 현장 재활용 판단의 정확도가 아니다.
- 비공개 저장소다. 교육 영상/자막/로그인 화면·실제 키·개인정보를 업로드하지 않는다.
