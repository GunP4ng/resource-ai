# H 후보·질문 개선·운영 의존성 인계

기준 main은 `74c8c3d9a3bae87b560f72e05068f991ca255265`이며 작업 브랜치는 `hyeobikong/h2-candidate-handoff`다. 기존 H 운영 PR #33과 사진 ZIP PR #35는 별도다. 이 변경은 H의 평가 후보와 질문 개선·재현 자료를 전달하며 기존 PR을 재구현하거나 병합하지 않는다.

근거: [H2 #6](https://github.com/GunP4ng/resource-ai/issues/6), [팀장 최신 배분](https://github.com/GunP4ng/resource-ai/issues/12#issuecomment-6765265158), [담당 업무](team-tasks.md#h2), [평가 계획](evaluation.md). #8은 PR25 병합 때 자동 CLOSED 됐으며 실제 구독/H/O 운영 인수는 미완료로 #12에서 추적한다. 이슈 종료를 실제 실행 인수로 해석하지 않는다.

## 지금 전달하는 실물

[H 후보 묶음](../data/h-candidates/2026-11-12/README.md)에 합성 CaseInput 10개, 라이선스 선언을 확인한 공개 사진의 정제 PNG 10장, source/rights snapshot과 SHA, 필드별 가정/미상, 임시 출처 그룹 6개를 제공한다. 국내 현장 사실·독립 정답·인수·split은 미정이다. 같은 업로더 코호트는 같은 사업장 증명과 다르며 보수적인 임시 그룹으로 표시했다.

H 후보 10건과 사용자가 전달한 700개 이미지 ZIP은 별도 자료다. [PR #35](https://github.com/GunP4ng/resource-ai/pull/35)의 권리/진위 미확인 수집본을 이 후보의 출처 허락이나 현장 사례로 계산하지 않는다.

### H2 두 가지 질문 누락 개선

`src/assessment.ts`의 내부 `contextQuestions`가 이미 채워진 문자열에서도 명시적으로 보고한 혼합·다층·라벨 충돌과 미확인 오염/접촉 이력을 질문으로 남긴다. `assessCase`가 이를 H1 질문과 중복 제거해 합치고, 기존 `decideCase`/`createAssessmentAdapter` 경로로 보여 준다.

입력의 수지·hazardousContact를 고치거나 사진에서 수지·화학성분을 추정하지 않는다. 자유 수지 문자열의 허용 목록·공통 DTO·판정 state는 추가하지 않았다. 알려진 단일 수지, 검사한 명시적 부정 문장, 오염 이력이 해결된 답변의 불필요한 질문을 회귀로 확인했다. 자유 문장 전반을 이해하는 자연어 판별기는 아니다.

| 회차 | 같은 H 후보/테스트에서 관찰한 문제 | 변경·실제 결과 |
| --- | --- | --- |
| 기준선 | 후보003/005의 혼합·구성 질문, 004/008의 이전 내용물·잔류 확인 질문 누락 | main 구현에 새 회귀를 적용: 53 pass / 2 fail |
| 1 | 혼합·다층·라벨 불일치 질문 누락 | 구성·명세·분리 여부 질문: 54 pass / 1 fail |
| 2 | 채워진 오염 답변 안의 미확인을 해결된 사실로 취급 | 물질명/SDS·이전 내용물·잔류/세척 자료 질문: 55 pass / 0 fail |

[improvement-cycles.json](../data/h-candidates/2026-11-12/improvement-cycles.json)에 동일 10건 입력·manifest SHA·구현 SHA·회차별 질문/상태를 기록했다. 10건 모두 `needs-review`를 유지한다. 팀장 실행의 18건 A/B/C 실험·독립 성능 수치·잠금 평가를 수행한 것으로 계산하지 않는다. 해당 18건 영향은 미검증이다.

### 실제 로컬 실행 증거

- `scripts/h-candidates.ts`: 공통 `parseCaseInput`과 실제 `assessCase`/adapter 실행, 입력 비변경·4개 경로 unknown·source/사진/라이선스 SHA·파싱 확인.
- `scripts/h-photo-offline.ts`: 기존 `createSubscriptionRunner`/`openCaseSession`, `chatgpt-subscription`/`gpt-6-sol` 사용. 실제 저장소 디코딩과 기존 SDK의 zstd SSE 직렬화 바이트를 주입 transport에서 복원·해시 대조한다. 실제 credential store는 읽지 않고 메모리 합성 credential만 쓴다.
- 동일 사진의 공정·오염·접촉 조건 변화, 모델 동의 철회 뒤 모델 접근 거부/preview 보존, 저장 동의 철회 거부, 만료 삭제를 실행했다. 합성 과거 날짜 대조는 기존 J 확인 기한을 갱신하지 않는다.
- 실제 loopback HTTP/HTML form의 제출303→질문 표시→답변303→해결된 질문 제거, 타 세션404를 확인했다. O 앱 코드는 수정하지 않았다.
- 합성 인증·권한·응답·usage와 실제 바이트/HTTP 동작을 구분한다. 외부 모델 호출·실제 계정 로그인·현장 사진 접근은 0건이다.

사진 저장소→SDK 직렬화와 사진 없는 HTTP/form은 별도 검사다. 운영 O 앱의 업로드 UI→승인된 실제 모델 전송→보고서까지 완주한 증거는 아니다. O가 앱에 입력할 때는 제공 JSON의 후보 `caseId`를 제출 필드에서 제외하고 서버 발급 caseId/revision과 후보 ID를 매핑한다. JSON 숫자/null/배열을 자동 보정하지 않으며, 사진은 해당 서버 사례의 권한/동의/모델 scope를 거쳐 발급된 photoRef만 연결한다.

## 사람별 다음 작업과 연결 조건

| 상대 | H가 이번에 넘기는 것 | 상대에게 필요한 것 / 완료 판단 |
| --- | --- | --- |
| 윤정준 | 후보10·저작자/권리 snapshot·사진/원본-파생 SHA·필드별 가정·출처 그룹·검토 질문 | 전체30건의 출처/중복 그룹 검토, H 후보에 대한 독립 사람 라벨, 실제 공정/사업장 적용·현재 법령의 sourceId/locator/SHA와 현행성 반영 범위 |
| 오연석 | CaseInput JSON10·실제 adapter/HTTP 입출력·사진 바이트 증거·질문/보류 이유·재현 명령 | H 후보에 대한 독립 사람 라벨, 정확한 actor/case/revision·운영 grant와 자료 package, 같은 authority 조립 및 실행/실패/usage 표시 |
| 팀장 | 두 회차 질문 개선·소스/코퍼스 버전·입출력/실패 경계·J/O 의존성 | 후보 인수와 불일치 조정·그룹 단위18/12 배정, 18건 실험/최초 잠금 평가, 실제 계정/provider/model/purpose/한도/OS·현장/사진 사용 승인 |
| 이상협 후속 | O 후보10건의 예비 검토와 현재 H 실행 관측, J 날짜 경계 영향 확인 | 예비 검토를 독립 사람 라벨로 서명하지 않음. 사용자/검토자의 별도 독립 확인과 자료 확보 후 H2 실제 사진 추론·운영 인수·실패/감사 실행 계속 |

O 후보의 원본은 [PR #34](https://github.com/GunP4ng/resource-ai/pull/34), head `2777dfe193fa72cdb399be4c34dcaa820963fad1`이다. [peer-review.json](../data/h-candidates/2026-11-12/peer-review.json)에 10개 원본 SHA와 항목별 AI 보조 예비 검토, 실제 H 파싱/질문/판정 관측을 구별해 남겼다. 사람 검토자·자격·독립 라벨·인수는 null이다. 모델 출력이나 host 출력을 정답으로 복사하지 않는다.

J의 `docs/j2j3-evidence-20261110` head `84027ad728d212720c77788f39161086baa17ea9` 인계는 실제 후보0/10·manifest 미공급을 명시한다. 법령 QA 조건 변형10개는 하나의 재현 계열이다. 없는 후보 열 건의 라벨을 만들지 않고 후보별 자료를 기다린다. 11/10 공식 조회 증거는 운영 `verifiedThrough=2026-11-05`를 자동 갱신하지 않으며, 현재 H10/O10 입력은 날짜/적용성 근거 미해결을 계속 표시한다.

## H/O 운영 결합에서 아직 결정할 것

현재 기본 공급자/모델은 `chatgpt-subscription`/`gpt-6-sol`이고 Azure는 선택 경로다. `RESOURCE_MODEL_RUNNER=local`은 실제 모델을 호출하지 않는다. 이 인계의 오프라인 스크립트는 기본 launcher의 실제 운영 승인/한도/감사 연결 완료를 뜻하지 않는다.

- O PR34의 `createOperatorRuntime`은 같은 authority의 사례·사진·guarded runner와 자체 `openOperationJournal.authorizeDispatch/record/wrapTransport`를 조립한다. O의 requestAllowance는 요청 횟수 한도이며 금액 예산이 아니다.
- H PR33의 `createOperationalHandoff`/`createOperationalAuditStore`/recovery worker는 별도 구현이다. O launcher에 자동 연결된 것으로 보지 않는다. 두 경로를 무조건 중첩해 이중 예약·감사·정산하지 않는다. 운영 공급자 책임 선택은 H/O/팀장 검토가 필요하다.
- 실제 원자적 예약/해제/reconcile, ledger 정책·복구 공급자와 supervisor, private DB/photo 경로 ACL/sidecar/단일 소유권, 용량/보관/장애 인수를 결정해야 한다. tombstone 보존 정책은 바꾸지 않았다.
- 원본/파생 sourceId·locator·SHA와 부분 지지 관계는 별개다. J의 다중 원문이 fact 일부만 지지하는 묶음을 현 O `evidenceIssue`가 완전 fact로 수용한다고 가정하지 않는다. 공통 계약 변경은 합의 전 수행하지 않는다.

### 실제 실행 전에 받아야 할 최소 항목

1. 팀장: 승인 참조/기간, 정확한 provider/model/purpose·승인 account ID hash·지원 OS, 요청 횟수와 금액 정책·중단/재시도 범위. credential은 비공개 운영 채널로 주입하고 Git/인계 JSON에 넣지 않는다.
2. J/사례 제공자: 적용 가능한 현재 source snapshot·version·locator/SHA, 사례/시설/허가·질량·견적/계수의 별도 검토, 원본-파생/공동 지지 관계와 권리.
3. O/운영자: 정확한 actor/case/input revision/artifact SHA와 사진별 동의·보관·모델 scope/binding·철회/만료, 실제 설치·재평가 명령, 동일 authority, 선택한 예약/감사 공급자와 복구 책임.
4. H 실행 후 인계: case/revision/run/attempt/approval, 실제 전달 사진 SHA와 provider/model, 성공/실패/취소/timeout의 관측 request ID/usage·terminal audit·정산/불확실 상태. 모르면 null로 남기고 0·미과금·환불/재시도 안전으로 해석하지 않는다. 감사 여유도 단일 요청 deadline 안에서 처리한다.

SDK `maxOutputTokens`가 실제 제공자 강제 과금 상한을 보장한다는 증거는 없다. 승인/자료가 없는 지금은 실제 모델을 호출하지 않는다. H2 사진 추론·승인된 현장 사진의 조건 변화 인수와 H4 실제 제공자/운영 인수는 계속 미완료다. #6/#12의 체크박스나 타인 파일을 임의 변경하지 않는다.

## 검증과 동결 인계

이번 Linux x64 / Node24.22.2 / Bun1.4.2에서 source/Node/Bun test를 포함한 `bun run typecheck`, `bun run typecheck:o-tests`, H 테스트 tsc, 두 build, smoke, 전체 **558 pass / 0 fail**을 확인했다. [validation.json](../data/h-candidates/2026-11-12/validation.json)에 명령·소스 SHA·증거 파일 해시를 기록한다. 커밋한 정확한 PR head와 CI 결과는 PR에서 확인한다.

PR33의 H `247fb1b`와 PR34의 O `2777dfe`를 `git merge-tree`로만 결합하고 이번 H 변경을 덮은 별도 임시 트리도 검사했다. 동일 strict 검사·H tsc·두 build·smoke와 **637 pass / 0 fail**을 확인했으며, 최종 H 코드5개의 실제 실행 바이트를 두 검사 트리와 대조했다. 실제 브랜치 병합이나 main 변경은 없다. 결합 통과를 운영 공급자·실제 과금·현장 인수로 확대하지 않는다.

게시 중 추가된 PR36(`e38a021`)의 문서 정정과 PR37(`490935c`)의 발췌문→원본 법령 연결 검증도 대조했다. PR37의 J 코드/테스트2개를 별도 임시 결합 트리에만 반영해 strict 검사·H tsc·두 build·smoke와 **642 pass / 0 fail**을 확인했다. 그 J 코드는 이 브랜치에 이식하지 않았으며 H 코드5개는 동일하다. #8 자동 종료와 실제 인수 미완료를 구별하는 문구, 후보 ID와 앱 발급 사례 ID의 대응, 사진 없는 HTTP 검사와 별도 사진/SDK 검사의 경계를 이 H 문서에 명확히 했다.

현재 Windows 기본 Bun은1.4.4이므로 고정1.4.2 검사는 WSL의 Linux 로컬 파일시스템에서 수행했다. 이전 Windows POSIX 권한/fsync/SIGTERM 실패 기록과 이번 검증을 혼동하지 않는다. 이번 변경에서 Windows 네이티브 전체 검사나 전원 장애 인수를 수행하지 않았다.

11/20 동결 시 이 코퍼스 버전, 코드/규칙·도구·프롬프트·SDK/lock, source/사진 SHA, 실행 명령과 실패 경계를 함께 고정해 팀장에게 넘긴다. 통합 QA·18건 실험·미열람12건 평가·시연 영상/최종 보고서·최종 제출은 팀장 담당이다. 후속 변경 후 기존 공개/잠금 자료 재실행을 새 독립 평가로 표시하지 않는다.
