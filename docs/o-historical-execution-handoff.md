# 과거 실행 근거의 비공개 연구 인계

2026-11-17 기준이다. H 담당 이상협이 제공한 과거 실행 메타데이터를 O 담당의 사례 패키지·앱·보고서에서 읽는다. H의 입력·판정·모델 실행을 다시 구현하거나 원래 실행 환경을 복원하지 않는다.

원본은 [H의 #56 인계 댓글](https://github.com/GunP4ng/resource-ai/issues/56#issuecomment-6927541141)과 그 안의 `h56-real-photo-evidence-v1` JSON이다. #12·#54의 후속 인계가 이 자료를 참조한다. 파일·메타데이터의 수신 검사는 제공자의 진위, 원래 호출의 독립 인증, 사진 재배포 권리나 현장 적용 승인이 아니다.

## 기존 사례 패키지와의 차이

기존 `prepare` → `check` → `install` → 명시적 인증 재평가는 현재 소유 사례의 입력 revision과 자료를 연결한다. 그 경로와 계산·업체·권리 검사는 유지한다.

새 패키지는 별도의 `historical-execution-research` 목적이다. H의 과거 actor/case/revision/photoRef를 기록으로 보존하며 현재 계정·소유 사례·사진·실행 권한을 생성하지 않는다. `o-artifact install`에 넣는 운영 자료가 아니다. 연구 화면 열람만 허용하고 모델 전송·상업 export·권한 복원은 허용하지 않는다. 패키지 자체도 자료 재배포를 승인하지 않는다.

## 확인한 수신 범위

원본 14사례와 28개 요청 기록을 실제 수신 CLI로 검사하고 패키지와 인수 영수증을 다시 읽었다. 원본 보존·직렬화 규칙은 다음과 같다.

| 항목 | 검사와 한계 |
| --- | --- |
| 입력 revision | 보존된 입력으로 기존 canonical SHA-256을 재계산 |
| 공통 판정 해시 | H v1의 `SHA256(JSON.stringify(template))` 사용. 속성 순서를 보존하며 O canonical 해시로 바꾸지 않음 |
| 로컬 파일 해시 | 수신한 댓글 API JSON·실행 JSON의 실제 바이트에서 계산 |
| 패키지 seal | `revision(record)`를 읽을 때 다시 계산. 서명이나 제공자 인증이 아님 |
| 댓글과 실행 JSON | 동일한 근거 문서인지, 댓글·이슈·URL 연결이 일치하는지 검사 |
| 사진·워크북·패치·코드 fingerprint | 원래 선언을 보존. 실제 바이트나 원래 fingerprint 산식을 검증한 것으로 표시하지 않음 |
| 댓글 원본 파일 해시 | 프로필 필드를 제거한 뒤 원본 파일을 복원할 수 없으므로 수신 시점 검사로 표시 |

모든 사례는 당시 `needs-review`이고 검증된 법령 근거가 없다. 수지·공정·오염·유해 접촉·질량·지역은 미확인으로 남는다. 303/200/completed는 인계된 요청 기록의 상태이며 추천 성공률·정확도·독립 정답 수가 아니다.

두 사용량 표현은 같은 요청들의 서로 다른 집계다.

| 표현 | 입력 | 캐시 읽기 | 출력 | 합계 |
| --- | ---: | ---: | ---: | ---: |
| API 요청 합계 | 71,439, 캐시 포함 | 10,240, 입력에 이미 포함 | 8,127 | 79,566 |
| SDK 세션 합계 | 61,199, 캐시 제외 | 10,240, 별도 항목 | 8,127 | 79,566 |

API 입력에 캐시를 다시 더하거나 API·SDK 합계를 합산하지 않는다. 요청 28건과 서로 다른 모델 이미지 해시 14개도 다른 양이다. 청구 확정액을 산출하지 않는다. 수신기는 새 모델 호출을 하지 않는다.

## 비공개 수신 명령

Bun 1.4.2와 기존 잠금 의존성을 사용한다. 실행 캐시와 임시 파일은 기존 작업용 `TMPDIR` 아래에 둔다. `H_SOURCE_COMMENT`는 원본 댓글 API JSON, `H_SOURCE_EVIDENCE`는 원본 실행 JSON의 실제 절대경로다. HTML 화면을 JSON 대신 저장하지 않는다.

```bash
: "${TMPDIR:?준비한 비공개 작업 디렉터리가 필요합니다}"
: "${H_SOURCE_COMMENT:?원본 댓글 API JSON의 절대경로가 필요합니다}"
: "${H_SOURCE_EVIDENCE:?원본 실행 JSON의 절대경로가 필요합니다}"
umask 077
HISTORY_DIR=$(mktemp -d "$TMPDIR/o-history.XXXXXX")
install -m 600 "$H_SOURCE_COMMENT" "$HISTORY_DIR/comment.json"
install -m 600 "$H_SOURCE_EVIDENCE" "$HISTORY_DIR/evidence.json"

bun scripts/o-case-package.ts receive-history \
  --source-comment "$HISTORY_DIR/comment.json" \
  --evidence "$HISTORY_DIR/evidence.json" \
  > "$HISTORY_DIR/history.pending.json" &&
bun scripts/o-case-package.ts history-receipt \
  --artifact "$HISTORY_DIR/history.pending.json" \
  > "$HISTORY_DIR/receipt.json" &&
mv "$HISTORY_DIR/history.pending.json" "$HISTORY_DIR/history.json"
```

이 명령은 수신·인수 영수증을 생성하며 설치나 평가를 실행하지 않는다. 각 성공 종료 뒤에만 다음 명령을 실행한다. 실패 출력은 완성된 패키지가 아니며 stdout은 비어 있다. 경로의 소유자·0700 디렉터리·0600 파일·심볼릭/하드 링크·크기·바이트 변경을 검사한다. 댓글·실행 파일 한도는 각각 256 KiB, 패키지는 1 MiB다. 기존 아티팩트 reader의 기본 한도는 유지한다.

`bun run build:app` 뒤에는 같은 인자를 `dist/app/o-case-package.js`에 전달할 수 있다. 저장소 밖 작업 디렉터리에서도 원본 파일의 절대경로를 사용한다. 원본 데이터·전체 패키지·영수증·인증 DB는 Git에 넣지 않는다.

## 현재 운영자의 읽기 권한

다음 두 설정을 함께 사용한다.

```text
RESOURCE_HISTORY_ARTIFACT=검증한 비공개 history.json의 절대경로
RESOURCE_HISTORY_READER_ACTOR_ID=현재 활성 로컬 운영자 계정의 actor ID
```

`RESOURCE_APP_AUTH=local-operator`, `RESOURCE_MODEL_RUNNER=local`일 때만 마운트한다. 다른 실행 모드나 누락된 설정은 거부한다. 현재 활성 계정은 기존 계정 발급 절차로 준비한다. H 자료의 과거 actor ID를 열람자로 복사하지 않는다.

운영자가 자기 상태 DB의 활성 계정 ID만 확인하는 예시는 다음과 같다. 비밀번호·해시·쿠키를 조회하지 않는다.

```bash
: "${RESOURCE_STATE_DIR:?현재 운영자 상태 디렉터리가 필요합니다}"
: "${H_READER_USERNAME:?열람할 현재 로컬 계정 이름이 필요합니다}"
H_CURRENT_READER_ACTOR_ID=$(RESOURCE_STATE_DIR="$RESOURCE_STATE_DIR" H_READER_USERNAME="$H_READER_USERNAME" bun -e '
  import {openRuntimeDatabase} from "./src/o-runtime-db.ts";
  const db = await openRuntimeDatabase(process.env.RESOURCE_STATE_DIR, {existingOnly:true});
  try {
    const row = db.database.query(
      "SELECT actor_id FROM accounts WHERE username=? AND disabled=0"
    ).get(process.env.H_READER_USERNAME);
    if (!row || typeof row.actor_id !== "string") throw new Error("활성 열람 계정 없음");
    console.log(row.actor_id);
  } finally { db.close(); }
')
```

```bash
RESOURCE_APP_AUTH=local-operator \
RESOURCE_MODEL_RUNNER=local \
RESOURCE_PRIVATE_PHOTOS=off \
RESOURCE_HISTORY_ARTIFACT="$HISTORY_DIR/history.json" \
RESOURCE_HISTORY_READER_ACTOR_ID="$H_CURRENT_READER_ACTOR_ID" \
PORT=4844 bun scripts/app.ts
```

기존 로그인 폼을 사용한다. `/research/history`와 `/research/history/cases/:index`는 GET 전용이다. 현재 세션과 설정된 활성 열람자만 접근하고 렌더링 전후 권한을 확인한다. 일반적인 비공개 연구 기록 링크는 열람 권한이나 자료가 있다는 증명이 아니다. 구성되지 않은 기록은 404, 권한 없는 세션은 403으로 복구 경로를 안내한다.

시작 시 읽고 검증한 자료를 프로세스 동안 고정한다. 파일이나 열람자 설정을 교체하면 앱을 재시작한다. 화면은 H의 과거 식별자를 현재 소유 사례로 만들지 않으며 편집·재평가·전송·다운로드 기능을 제공하지 않는다.

## J/H와 사람이 확인할 것

- **H 인수 결과:** 입력·사진 참조·판정·요청·사용량의 일관성과 수신 필드를 확인한다. 원본 모델 응답, 관찰 DTO/특징, 중간 업로드·저장 receipt, 종료 전 브라우저 검증은 보존되지 않은 것으로 남는다. 원래 사진·워크북·패치 바이트는 열지 않았다.
- **J 확인:** 평가일 `2026-11-16`의 두 법령 `waste-rule-2026-11-12`, `legal-291947-annex5-3-common`은 당시 `currentness-unverified`다. 현재 registry나 최신 시행본을 끼워 넣지 않는다. 보존된 법령 snapshot·당시 현행성 검증이 없는 상태를 표시한다.
- **사람의 독립 검토:** 수집자 외 독립 라벨·불일치 조정·잠금 평가는 원래 담당자와 팀장의 절차로 수행한다. AI 예비검토·이력 인수·동일 사진의 반복 전송은 사람 정답이나 독립 표본이 아니다.
- **권리·현장 확인:** 최종 공개 전 #52/#55 재검토와 사진별 권리·동의·실행 목적 검토는 별도다. 허가·인수·실제 견적·계수 현장 적합성·반출/계약 승인은 기존 실행 전 확인 목록으로 남는다. 기술적 수신이 그 승인을 만들지 않는다.

## 완료 판단과 재현 검사

기존 #52 공개 출처·이미지·계산 자료와 PR73의 공개/합성 패키지 연결은 별도 납품 기록이다. 이번 인수는 계산값을 추가하거나 그 권리 상태를 바꾸지 않는다. #54의 과거 실행 소프트웨어 연결, #12의 화면 인수, #66의 상태 회신과 이슈 종료 결정은 각각 따로 추적한다.

| 추적 | 종료 판단에 사용할 근거와 남은 단계 |
| --- | --- |
| #52 | 기존 PR58·59·69·70·73의 공개 출처·사진·계산 인계 근거를 대조한다. H 자료의 최종 공개 권리는 이번 수신으로 확인되지 않는다. 이슈 종료는 리드 판단 |
| #54 | 기존 현재 사례 설치·명시적 재평가를 보존하고 새 과거 기록을 별도 수신·표시한다. 실제 CLI·권한·HTTP·재시작·화면·회귀와 최종 리뷰를 함께 확인 |
| #12 | 기존 추천·질문·보류/HIG 증거와 새 읽기 전용 화면 증거를 구분한다. 실제 화면 첨부·리드의 화면 인수를 로컬 PNG만으로 완료 처리하지 않음 |
| #66 | 구현 상태·외부 의존성·기존 11/18 인계 및 11/20 동결 기준을 인계한다. 이 문서는 이슈 댓글 작성이나 종료의 증거가 아님 |

수신 단위에서 새 테스트 72개와 기존 관련 테스트 166개가 통과했고 의미 변이 세 종류를 검출·복원했다. 부모는 실제 원본 14건의 CLI 수신·reload와 API/SDK 집계 일치를 확인했다. 통합 화면·권한·재시작·전체 저장소 검사·Astra 최종 승인은 이 단위 결과만으로 통과 처리하지 않는다.

```bash
bun run typecheck
bun run typecheck:o-tests
bun test --timeout 30000 ./tests
bun run build
bun run build:app
RESOURCE_MODEL_RUNNER=local bun run smoke
```

검토용 실제 입력·출력·명령·해시·화면은 비공개 `.omo/o-h14-20261117/`에 보존한다. 공개 문서에는 원본 식별자나 사진을 복사하지 않는다. 전체 인계의 테스트·화면·리뷰 상태는 최종 PR의 검증 기록을 함께 확인한다.
