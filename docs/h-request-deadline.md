# H 운영 요청 deadline 및 공급자 책임

PR #24의 P2 수정 범위다. 합성 입력과 대체 transport로 검증하며 실제 Azure 호출, 운영 사진·사례 검증 완료를 뜻하지 않는다.

## 요청 시간과 오류 계약

`createOperationalApp.fetch` 진입 시 `performance.now()` 기준으로 절대 종료 시각을 한 번 정한다. 인증, JSON/form 본문 읽기, ResourceProvider, H adapter, runner가 같은 예산을 사용한다. 인증이 150ms를 사용한 200ms 요청에는 50ms만 남는다. 내부 단계 타이머가 있어도 외부 deadline을 연장하지 않는다.

`requestDeadline`은 원래 `Request.signal`을 종료까지 연결하고, 각 비동기 경계에서 남은 시간을 확인한다. `createAssessmentAdapter`의 선택적 서버 훅 `checkRequest`는 사례 revision을 저장하기 직전에도 확인한다. 취소를 무시한 callback의 늦은 결과는 새 전송이나 H 사례 저장으로 이어지지 않는다. HTTP는 callback 완료를 무한 대기하지 않는다. 타이머·리스너·활성 요청은 완료/실패/취소/dispose에서 정리한다.

| 상황 | HTTP | 정책 |
| --- | --- | --- |
| 전체 요청 deadline 또는 runner 실행 제한 초과 | 504 | 인증 중 발생한 전체 deadline도 포함 |
| 원래 Request의 명시적 취소 | 408 | 리소스/runner/transport에도 중단 전달 |
| 인증 actor 없음 | 403 | 후속 앱·모델 실행 없음 |
| 인증 서비스 자체 예외 | 503 | 시간 초과와 구분, 진단 원문 비노출 |
| Azure 운영 설정/승인 없음 | 기존 503 | 유료 전송 없음 |
| 종료 감사 기록 실패 | 기존 provider 오류 502 | 실행 성공으로 반환하지 않음; 상위 deadline/취소가 먼저 발생했다면 504/408 유지 |

기존 공개 `SessionFailureCode` 11종, O4 오류 매핑, strict JSON/HTML form 변환 경계, AsyncLocalStorage actor를 유지한다. 인증 deadline의 이전 503 기대값은 전체 요청 timeout인 504로 바로잡았다. 실제 인증 서비스 예외의 503은 별도로 검사한다.

단조 시계는 wall clock 변경의 영향을 피하지만 JavaScript 이벤트 루프를 막는 동기 작업을 선점할 수는 없다. callback은 취소를 준수해야 한다. 비협조적인 외부 시스템의 작업·과금까지 HTTP timeout으로 되돌리는 보장은 없다.

## runner와 종료 감사

runner 진입 시 남은 요청 예산의 10%(최대 1초)를 종료 감사에 남겨 둔다. 실행 제한은 설정된 runner 제한과 이 종료 시각 중 이른 쪽이다. 종료 감사는 원래 요청 종료 시각과 최대 1초 중 짧은 잔여 시간만 사용한다. 별도의 전체 제한시간을 다시 시작하지 않는다. runner 단독 사용도 진입 시 정한 종료 시각 안에서 실행과 감사를 나눈다.

상위 취소는 runner와 transport에 전달한다. 전송 승인, dispatch 감사, 사진 재검증 이후에도 deadline을 확인해 늦은 새 dispatch를 막는다. 사용자 취소 HTTP 응답은 즉시 반환할 수 있으며 runner의 terminal audit 정리는 원래 deadline까지만 허용한다. sink가 취소를 무시해도 HTTP 응답을 붙잡지 못한다. 시간이 이미 소진된 terminal event는 중단된 signal로 전달될 수 있지만, 저장 확인 성공으로 취급하지 않는다.

감사 자료의 의미:

- `requests[].transportStarted`는 transport 함수 호출 여부이며 Azure 수신·처리·청구 확정이 아니다. dispatch 이벤트는 전송 직전이므로 이 값이 false다.
- 응답 헤더를 받은 경우에만 status/request ID를 기록한다. 종료 시 모르면 null이다. 늦게 도착한 헤더로 이미 전달한 감사 snapshot을 변경하지 않는다.
- 완료된 SDK 통계가 없으면 usage는 null이다. 0원/0 token으로 추정하지 않는다.
- `images`는 전송 경로에 넘긴 검증 바이트의 SHA/MIME이다. 전송이 끝났거나 비용이 확정됐다는 뜻은 아니다.
- terminal audit가 실패하면 성공 응답을 반환하지 않는다. `finish.outcome`은 실행 결과이며 sink의 저장 확인 자체를 뜻하지 않는다.

## 별도 운영 설계 사항: 사진 권한 revision

현재 H adapter는 평가가 성공한 뒤에만 내부 입력/revision을 바꾸며 O4는 실패한 수정의 기존 보고서를 보존한다. 504/408 이후 늦은 ResourceProvider 결과, 다른 세션 접근도 회귀 테스트로 확인한다. 그러나 ResourceProvider나 사진 권한 공급자가 외부 저장소에 쓴 상태를 H가 rollback하지는 않는다.

운영 공급자는 수정 중인 입력을 요청별 임시 revision으로 분리하고, 인증된 actor/사례와 연결해야 한다. 평가 중의 revision을 곧바로 전역 current revision으로 게시하는 방식은 안전한 통합으로 간주하지 않는다. 성공 확정 시 commit, 실패·취소 시 rollback/만료하는 경계와 동시 수정 정책은 O의 사례 저장소/인증 공급자와 합의해야 한다. 현재 인터페이스는 외부 저장소까지 묶는 원자적 transaction을 제공하지 않는다. 이 통합은 미완료이며 사진을 가진 실제 수정 사례로 인수 검증해야 한다. tombstone 보존·용량 정책은 변경하지 않았다.

## 별도 운영 설계 사항: 감사와 비용 정산

`authorizeDispatch` 공급자는 요청별 승인·비용 예약을 원자적으로 수행해야 한다. start/dispatch 감사 실패는 전송을 막지만, 그 전에 생성된 예약의 해제까지 현재 runner가 수행하지는 않는다. 전송 후 terminal audit가 실패하면 이미지 증거와 최종 비용이 영속 저장됐다고 주장할 수 없다.

운영자는 runId/caseRevision/attempt/approvalId 및 확인된 request ID로 예약·실제 Azure 사용량·감사 기록을 대조할 수 있어야 한다. 감사 sink의 영속성/멱등성/접근 통제, 예약 만료·해제·추가 정산, terminal 실패 시 이미지 증거 보존 경로는 운영 공급자 책임이다. HTTP 504/408/502만으로 미과금 또는 재시도 안전을 가정해서는 안 된다. 이번 수정은 비용 정산 API나 외부 원자적 transaction을 추가하지 않는다.

## 회귀 검증 근거

`tests/deadline.test.ts`는 실제 Request/Response로 인증 150ms + 전체 200ms 사례와 275ms 검토 기준을 검사한다. 별도 수동 단조 시계로 199ms 대기/200ms 종료를 확정해 스케줄링 편차와 예산 계산을 구분한다. SDK 시작 후 시나리오는 초기화에 여유를 주고 수동 시계로 전송·감사 종료 시점을 제어한다.

인증 403/503/408/504, JSON/form 본문 정체, AbortSignal 무시, 전송 중 취소, 추가 dispatch 차단, usage/request ID 미확인, terminal audit 정체/실패, 이전 보고서/revision 보존, 세션 격리, 타이머/리스너 정리를 검사한다. `tests/operations.test.ts`의 성공/준비 상태/사진 연결 테스트도 유지한다. 모든 transport는 합성 응답이며 실제 유료 호출은 하지 않는다.
