# 테스트 전용 실행과 화면 검사

실제 앱은 `bun run app`으로 실행하며 기본 runner는 `subscription`이다. `RESOURCE_MODEL_RUNNER=local`은 시작 단계에서 거부한다. runner가 빠진 앱 조립이나 비활성 운영 설정도 사례 제출을 HTTP 503으로 거절한다. 저장된 과거 사례 조회와 독립 결정 엔진은 유지한다.

외부 모델 호출 없는 1440/390 화면·인쇄 QA는 저장소 루트에서 다음처럼 실행한다.

```sh
PORT=4857 RESOURCE_MODEL_RUNNER=subscription bun tests/synthetic-app.ts
```

접속 주소는 `http://localhost:4857`이다. 이 tests 전용 진입점은 `tests/synthetic-runtime.ts`의 runner를 프로그램 인자로 주입한다. 이 fixture는 제안·추적 ID·사용량 없이 빈 결과를 반환하고 기존 host 결정 엔진이 판정한다. 운영 환경변수로 합성 runner를 선택하는 기능은 없다. 실제 HTTP bridge, 입력 검증, 저장, 정리, 종료 경로는 `scripts/app.ts`를 사용한다. presentation은 `synthetic`, runtime runner 표시는 기존 `unspecified`이며 실제 provider 성공을 의미하지 않는다.

인증된 연구 화면·SQLite 복구 QA에는 별도 임시 상태 디렉터리를 사용한다.

```sh
QA_ROOT=$(mktemp -d)
bun scripts/o-account.ts create --state-dir "$QA_ROOT/state" --username operator
PORT=4857 RESOURCE_MODEL_RUNNER=subscription \
RESOURCE_APP_AUTH=local-operator RESOURCE_STATE_DIR="$QA_ROOT/state" \
bun tests/synthetic-app.ts
```

계정 명령의 비밀번호 프롬프트에 입력한 뒤 `/login`에서 로그인한다. `local-operator`는 앱의 인증·저장 방식이며 모델 모드와 무관하다. 테스트 중 생성한 상태를 재사용하면 저장된 사례 조회를 확인할 수 있다. QA를 마치면 해당 서버를 Ctrl+C로 종료한다.

패키징 회귀는 동일 fixture로 빌드된 launcher를 지정한다.

```sh
bun run build:app
PORT=4857 RESOURCE_MODEL_RUNNER=subscription \
bun tests/synthetic-app.ts "$PWD/dist/app/app.js"
```

테스트가 `createAssessmentAdapter`, `createResourceApp`, `createOperationalApp`의 모델 없는 성공 경로를 사용해야 한다면 `tests/synthetic-runtime.ts`의 `createSyntheticAssessmentAdapter`, `createSyntheticResourceApp`, `createSyntheticOperationalApp`을 사용한다. 실패·미구성 계약을 검사하는 테스트는 실제 production factory를 직접 사용한다. 기존 runner/transport를 주입하는 테스트는 그 계약을 그대로 유지한다.

`scripts/measure-guidance.ts`는 모델 실행을 거치지 않는 결정 엔진 측정이다. 이 변경은 입력·판정·안전 기준·인용·비용·탄소 계산을 변경하지 않는다.
