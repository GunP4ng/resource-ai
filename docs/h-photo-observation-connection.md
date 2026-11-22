# H2 사진 관찰 후보와 H4 기존 실행 경로 연결

기준 main은 `478339723e81f4302e481d52c2ace0d25ad8a26d`, H 작업 브랜치는 `hyeobikong/h2-photo-observations`다. 실제 모델 호출 없이 구현 가능한 연결을 실제 서비스 인수와 분리한다. 기존 runner·사진 저장소·승인/감사·O 앱을 재구현하지 않는다.

## 연결한 동작

`createSubscriptionRunner`/`createAzureRunner`의 기존 이미지 요청 경로를 사용한다. 실제 이미지가 첨부될 때만 같은 실행의 최종 JSON에 아래 H 내부 관찰 결과를 요청한다. 분석을 위한 별도 2차 호출이나 vision 서비스를 만들지 않는다. 기존 도구 턴·요청 한도와 승인/감사 동작은 유지한다.

```json
{
  "decision": { "state": "needs-review", "caseId": "host-case-id", "reasons": ["검토 필요"], "evidence": [] },
  "photoObservations": {
    "images": [
      { "imageIndex": 0, "usable": true, "resinCandidates": ["PET"], "visibleFeatures": ["미확인 관찰"] }
    ]
  }
}
```

이 예시는 프로토콜 설명용 합성 응답이며 실제 사진 판정·승인·모델 실행 결과가 아니다. `decision`은 기존 `DecisionResult` 제안 그대로이고 H3가 서버 근거로 다시 검증한다. 이미지가 없는 실행과 관찰 결과가 없는 기존 DecisionResult-only 응답도 기존 동작을 유지하며 사진 추론을 수행했다고 표시하지 않는다.

`src/photo-observations.ts`의 `photoObservationParser`는 외부 값을 unknown으로 받아 허용한 필드·실제 타입·배열 길이·이미지 인덱스·텍스트 한도를 검사한다. 각 첨부 이미지가 정확히 한 번 있어야 한다. 모델이 사례 ID/revision·photoRef·SHA·소유권·동의·유해접촉·폐기물 코드·처리 적합성을 정할 필드는 없다. 배열은 한 번 읽은 제한된 인덱스 사본을 검사하며 사용자 정의 iterator를 실행하지 않는다.

호스트가 검증해 첨부한 순서와 해시로만 photoRef/SHA를 결합한다. 결과는 해당 `CaseInput`의 정확한 revision에 묶어 깊게 동결하고, 같은 프로세스 안의 호스트 생성 객체만 수용한다. 직렬화한 복제품·다른 사례·질량 등 입력 수정 뒤의 이전 결과는 `assertPhotoObservations`가 거부한다. 이 내부 객체는 공통 입력 형식이나 외부 승인 DTO가 아니다.

## H2/H3와 기존 앱에 반영

`CaseRunResult.photoObservations` → `createAssessmentAdapter` → `createResourceDomain` → `assessCase`/`decideCase`로 전달된다. 공통 `src/contracts.ts`·O의 `AssessmentEnvelope`·공개 `SessionFailureCode`는 변경하지 않는다.

- `candidates.resins`는 계속 입력의 보고값과 `basis: reported-input`만 유지한다.
- 추가 진단 `candidates.photoResins`는 `basis: unverified-photo`, 정확한 photoRef/SHA와 함께 분리한다. `photoInference: unverified-model-observations`는 미확인 제안을 수신했다는 뜻이며 정확도/실제 서비스 검증 성공 표시가 아니다.
- 수지가 미상이거나 사진 후보가 입력과 다르면 라벨·재질 명세/필요한 시험 자료의 확인 질문을 만든다. 보이지 않는 사진은 재촬영·명세 질문을 만든다. 입력 polymer/hazardousContact/mass 등은 덮어쓰지 않는다.
- 사진 후보만으로 법적 코드·유해성·처리 적합성·업체·비용·탄소를 확정하지 않는다. 코드 후보는 기존 J 인용 경로만 사용한다. 입력과 일치하는 관찰은 독립적으로 검토된 기존 비교 결과를 바꾸지 않고, 충돌/누락 질문은 기존 보류 게이트에 반영한다.
- H4는 관찰 결과가 잘못됐으면 기존 `invalid-model-output`으로 실패한다. 변경된 입력의 예전 관찰 또는 위조된 내부 결과도 반영하지 않는다. 기존 앱의 실패 시 보고서·case revision 보존 경계를 유지한다.

관찰 텍스트는 모두 모델의 미확인 데이터다. `visibleFeatures`는 화학성분/위험/법적 사실이 아니며 입력 사실·승인 자료로 사용하거나 실행 지시로 따르지 않는다. 사진 후보를 확인 질문에 표시하는 기존 O 출력 경계를 사용하며 새로운 외부 입력 필드나 UI 계약을 요구하지 않는다.

## 실제로 검사하는 범위

`tests/photo-observations.test.ts`는 strict unknown 검증, 필수 필드/타입/이미지 인덱스·누락·중복·희소 배열, 모델의 권리/유해접촉/법적 코드 필드 거부, 제한된 배열 사본·iterator 비실행, 동결·입력 비변경·stale/다른 사례/직렬화 위조 거부, 후보와 사실 분리·기존 비교 보존을 검사한다.

`tests/photo-observations-session.test.ts`는 기존 실제 구독 SDK와 메모리 합성 credential/주입 SSE를 사용한다. 실제 직렬화한 이미지 바이트를 제한된 zstd 디코딩 뒤 SHA로 대조하고 요청1회·같은 이미지/사례 revision 연결을 확인한다. 잘못된 응답 뒤 재시도/추가 전송은 없다. 합성 응답 카운터·request ID는 실제 제공자 인수와 구분한다.

같은 파일의 운영 앱 검사는 기존 O fixture의 격리된 합성 계정·비공개 저장소·SQLite·사진 authority·정확한 입력 grant·영속 journal·기존 `createOperatorRuntime`을 사용한다. 전체 디코딩/정제된 사진의 SHA가 SDK 첨부와 일치하고, HTTP303 뒤 후보 질문이 기존 보고서에 보인다. 잘못된 관찰 응답의 HTTP502 뒤 이전 입력·보고서·revision이 그대로인지 검사한다. 인증된 수정 요청의 baseVersion 계약을 그대로 사용한다. 합성 관측은 실제 현장이나 모델의 시각 성능 증거가 아니다.

검증 환경은 Linux x64 로컬 파일시스템, Node24/Bun1.4.2와 고정 lock의 기존 의존성이다. 임시 합성 agent/auth 경로와 주입 transport만 사용한다. 실제 계정/인증정보·외부 모델·승인되지 않은 외부 사진에는 접근하지 않는다.

```sh
bun test --timeout 30000 tests/photo-observations*.test.ts
bun run typecheck
bun run typecheck:o-tests
bun node_modules/typescript/bin/tsc --noEmit -p tests/tsconfig.h.json
bun run build
bun run build:app
bun test --timeout 30000
bun run smoke
```

전체 검증의 실제 수치와 최종 Git SHA는 PR 본문의 실행 기록에 남긴다. 별도 H tsc는 기존 H 테스트 목록을 검사하며, 새 테스트 두 파일은 공통 `typecheck`의 Node 테스트 구성에 포함된다.

## 별도로 남는 실제 운영 인수

실제 사진 사용권/사업장 동의/모델 전송 scope와 유효한 actor/case/revision grant, 계정/provider/model/purpose·기간/요청 한도·대상 OS의 승인, J 현행성과 실제 처리 자료가 필요하다. 이를 합성값으로 채우거나 로컬 통과를 실제 vision 성능·request ID/usage·과금/현장 적합성·Windows 지원 완료로 표시하지 않는다. 운영에서는 기존 승인/감사 경로를 사용한다. 원장·복구/guard/supervisor/보관 공급자 선택과 이중 예약/감사/정산 방지는 #12의 H/O/팀장 인수로 남긴다.
