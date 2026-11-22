# H #32 deadline·종료 감사 계약 재현 인계

기준은 PR38이 병합된 main `cc6bf1c213ac80f9e171a876544fb52e448acb1e`다. [#32](https://github.com/GunP4ng/resource-ai/issues/32)와 [팀장 최신 배분](https://github.com/GunP4ng/resource-ai/issues/6#issuecomment-6829016514)에 따라 기존 결정적 시계 수정의 증거를 모으고, 종료 감사의 절대 deadline 경계 검사를 보완한다. 생산 코드·공통 계약·O 코드·기한 정책은 변경하지 않는다. #32의 종료나 목표 OS 인수를 대신 결정하지 않는다.

## 기존 실패와 이미 반영된 수정

- 원래 실패는 [main74c8c3d CI](https://github.com/GunP4ng/resource-ai/actions/runs/42801572542)의 550 pass / 1 fail이었다. 20ms 벽시계 검사에서 종료 감사 여유까지 소진하면 `timeout` 대신 `provider`가 나온다. 같은 생산 정책에서 이 동작은 감사 실패를 숨기지 않는 결과다.
- 이후 [PR38 문서 head의 CI54](https://github.com/GunP4ng/resource-ai/actions/runs/43243656648)도 같은 검사에서 557 pass / 1 fail, 22.83ms/provider였다. H 후보 검사 3개는 통과했다. 실패를 삭제하거나 재시도로 숨기지 않았다.
- 기존 PR33의 `edfe02acb44ceebb99fbe1adaf7ca3397754d6a7`을 재사용한 선택적 `clock`과 결정적 pending-configuration timeout/cancellation 검사가 현재 main에 이미 있다. [PR33](https://github.com/GunP4ng/resource-ai/pull/33)의 squash는 `aef5ceee296b86febdc8c8da7a647a715d47c4f0`이다. 이번에는 이를 다시 구현하지 않는다.
- [기존 공개 검증 기록](../data/h-candidates/2026-11-12/validation.json)의 `finalCISchedulingRegression`에 실패·통제된 25ms event-loop 지연·동일20ms/18ms+2ms 예산·전송0·타이머0·수정 전후를 구분했다. [수정 후 CI63](https://github.com/GunP4ng/resource-ai/actions/runs/43251389762)은 653 pass / 0 fail이며 source/Node/Bun/O 검사·두 build·smoke도 통과했다. PR38 squash와 검증 head의 Git tree는 같다.

## 이번에 추가한 결정적 계약 검사

기존 [tests/operations.test.ts](../tests/operations.test.ts)의 fixture와 실제 `createOperationalRunner`를 사용한다. 합성 설정 조회를 멈춘 뒤 수동 시계로 작업을18ms에 만료시키고, 같은20ms 예산 안에서 종료 감사를 아래처럼 진행한다.

| 종료 감사 조건 | 외부에 반환할 실패 | 검사 의미 |
| --- | --- | --- |
| 19ms에 완료 | `timeout` | 남은 감사 여유 안에서 원래 작업 실패 보존 |
| 타이머 실행 전이라도 정확히20ms에 완료 | `provider` | 늦은 callback 완료가 절대 deadline을 이길 수 없음 |
| 취소 신호를 무시하고20ms까지 미완료 | `provider` | 외부 sink가 멈춰도 runner가 무제한 대기하지 않음 |

세 경우 모두 종료 감사 신호 중단·활성 타이머0, 승인 요청0·실제 transport0을 확인한다. 감사에 전달한 작업 outcome은 `timeout`, usage는 `null`, requests는 빈 배열이다. 늦게 설정/감사 callback을 완료해도 승인·전송이 새로 시작되지 않는다. 감사 callback을 호출한 기록을 durable 저장 성공으로 간주하지 않는다.

새 테스트 이름은 `terminal audit completion before or at the absolute deadline distinguishes timeout from audit failure`다. 기존 `deadline and caller cancellation terminate pending configuration, without later dispatch`의 timeout/cancel·usage=null·no-late-dispatch 검사를 그대로 유지한다. timeout 확대·retry·skip·기대값 완화는 없다.

현재 생산 코드의 `createOperationalRunner`는 부모 요청의 `end`와 `clock`을 우선하고, `requestDeadline`의 작업 기한 뒤 `work.close()`로 늦은 작업을 차단한다. 종료 감사는 기존 `end - clock.now()` 안에서만 기다리며 만료/실패는 `SessionFailure("provider")`다. 이 정책을 바꾸면 H/O 계약 검토가 필요하다. 이번 테스트는 처음부터 기존 정책대로 통과한 **추가 계약 검사**이며 새로운 생산 결함을 수정했다고 주장하지 않는다.

## 실행과 증거 범위

지원 환경은 Linux x64 로컬 파일시스템, Node24, 고정 Bun1.4.2와 기존 lock 의존성이다. 합성 설정·응답과 격리된 임시 agent 경로, tests 전용 주입 runner를 사용한다. 실제 계정 인증 파일·로그인·외부 모델/사진은 접근하지 않는다. 기존 Azure 명칭의 fixture는 합성 provider 경계 검사이며 기본 구독 모델 설정 변경이 아니다.

```sh
# Tests inject their own synthetic runner; no model-runner environment switch is needed.
bun test --timeout 30000 tests/operations.test.ts
bun run typecheck
bun run typecheck:o-tests
bun node_modules/typescript/bin/tsc --noEmit -p tests/tsconfig.h.json
bun run build
bun run build:app
bun test --timeout 30000
bun run smoke
```

실제 로컬 Node24.22.2/Bun1.4.2 실행은 관련 테스트 **21 pass / 0 fail**, 전체 **654 pass / 0 fail, 31개 파일**, 위 모든 타입 검사·두 build·smoke 통과다. 실행한 소스와 제출 파일은 LF 정규화 SHA로 대조했다. 생산 `src/operations.ts`는 `0f12d063661e5a1b8447ed725d9dd89dda59e305c0e474d652cd8134e002cfdc`, 테스트는 `eca7be81875f9c4283e627595c6d7c5baa94a9abb292f8a7d81d31a1471c48d5`다. 전체 테스트 로그 SHA는 `f905aad247d84678355932035a53d2a9616e61d2535b75304a09696e51caba7e`다.

최종 head와 GitHub 실행 주소·결과는 PR 본문에 별도로 기록한다. 첫 정적 검사에서는 테스트 callback의 선택적 `AbortSignal`을 필수값으로 넘긴 TS2345가 검출됐다. 실제 신호 존재 단언을 추가해 수정했으며 생산 인터페이스를 변경하지 않았다. 해당 실패 로그도 로컬 증거에 보존한다.

이 검사는 직접 runner의 결정적 시간·감사 계약이다. 기존 HTTP504/408/502·사례 보존 검사는 전체 suite에서 유지하되 새 테스트 자체를 HTTP/실제 제공자 인수로 표시하지 않는다. CI의 PR merge ref·source SHA·원래 실패와 수정 후 결과를 구분해 인계한다. 현재 Windows 네이티브 전체 실행·실제 결제/정산·전원 장애·운영 감사 sink 인수는 수행하지 않았으며 지원 OS와 대상 CI의 최종 수용은 팀장이 판단한다. 실제 금융 원장/감사 공급자 선택과 이중 예약 방지는 별도 #12 운영 인수다.
