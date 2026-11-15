# 팀원별 구현 작업

## 2026-11-15 현재 목표와 남은 인계

[추천 목표](recommendation-goal.md)와 [평가 계획](evaluation.md)을 현재 완료 기준으로 적용한다. 제품은 비교·추천으로 판단을 돕고 반출·계약 승인 여부를 심사하지 않는다. 아래 날짜가 붙은 PR 기록·미체크 항목은 해당 시점의 사실이며 문서 수정만으로 완료로 바꾸지 않는다.

| 담당 | 현재 남은 인계 기준 |
| --- | --- |
| J | 공개 법령·자료의 출처/권리/현행성·locator/SHA와 주장 지지 관계. 현장 사례를 기다리지 않고 공개·합성 사례에서 검증 |
| H | 추천 모드 연결 후 실제 compared 정상 사례, 유해/지정 의심·명백한 금지·인용 실패·입력 모순 차단, 추천을 바꿀 질문. 공개 사진은 권리·동의·모델 전송 권한을 별도로 준수 |
| O | 공개·합성 package의 정확한 actor/case/revision 설치·재평가, 업체 후보와 비용·탄소 라벨, 실행 전 확인 목록, 비교·추천3분/차단·확인2분 데모 연결 |
| 팀장 | 독립 사람 순위·차단 라벨, 추천 산출률/차단 정확도/순위 일치/확인 목록 완전성, 개발·잠금 구분, 최종 보고서·영상 |

#42에 따라 현장 자료·실사진·실제 field package의 제공 위치를 기다리지 않는다. 허가 유효성·업체 인수/계약·실견적/질량/거리·계수 적용 검토·현장 승인은 비교의 선행 차단 조건이 아니라 실행 전 확인 목록이다. 실제 provider 계정/목적/사진 동의·감사 권한은 그대로 필요하다. 11/20 동결과 11/25 발표를 유지하며 현장 성능·독립 라벨 미확보를 공개·합성 실행으로 완료 처리하지 않는다.

기준일 **2026-11-05**. 팀원은 이 문서에서 자기 이름 → 작업 ID → 완료 기준 순서로 읽고 시작한다.
기존 [실행 계획](delivery-plan.md), [아키텍처](architecture.md), [평가 계획](evaluation.md)을 사람별 작업으로 풀었다. PR #15에서 출처·정규화·근거 조회의 첫 구현을 검증했고 PR #17에서 선택된 별표·고시의 조건부 인용을 검토했다. 아래 체크박스와 진행표는 검증된 범위만 반영하며 제품 전체 구현 완료를 뜻하지 않는다.

**구현 담당은 윤정준·이상협·오연석 3명이다. 이태용(팀장, 모지리 지원)은 총괄·범위 조정·공통 계약/통합 검토·Azure 권한 확보·통합 테스트·잠금 평가 실행·최종 보고서·시연 영상·발표를 맡고 구현 배정에서 제외한다.**
실제 연결 코드는 아래 판정/도구 담당과 앱/조건부 보고서 화면 담당이 구현한다. 팀원은 자기 모듈 단위 테스트와 구현 증거를 책임지고, 팀장은 통합 테스트·평가·시연 전 검증 및 제출 산출물을 책임진다.
숙련도에 따른 역할 조정은 첫 회의에서 하되 모듈 경계·기능 동결일·평가 절차는 유지한다.

## 공통 시작 규칙

- 공통 인터페이스는 [src/contracts.ts](../src/contracts.ts)가 기준이다. `CaseInput`, `EvidenceRecord`, `RouteAssessment`, `ProcessorCandidate`, `ComparisonInput`, `ScenarioComparison`, `DecisionResult`, `ResourceDomain`을 먼저 읽는다. 타입은 런타임 검증기가 아니다.
- 아래 `src/*.ts`, `tests/*.test.ts`, `data/` 하위 작업 경로는 **구현 시 만들 파일의 배정 경로**다. 지금 존재하거나 구현됐다는 뜻이 아니다. 디렉터리를 더 나누더라도 소유 경계는 유지한다.
- `src/contracts.ts` 변경은 팀장 리뷰 후 세 명에게 공유한다. 임의의 별도 DTO나 다른 판정 상태를 만들어 연결하지 않는다.
- 첫날부터 병렬 작업한다. 윤정준은 수동 검증 출처 묶음, 이상협은 고정 입력/보류 결과, 오연석은 숫자 없는 보고서와 명시적 `unavailable` 비교 결과로 각각 시작한다. 다른 사람의 실구현을 기다리지 않는다. 예시·합성·실데이터를 표시하고 가짜 계수/가격을 사실처럼 채우지 않는다.
- 실제 데이터 인계는 파일/버전·입력 JSON·기대 상태·누락 이유·원문 위치를 함께 넘긴다. source ID는 공통 `EvidenceRecord.sourceId`로 연결한다.
- 공통 검증: `bun run typecheck && bun run build && bun run smoke`. 각자 구현한 동작은 자기 테스트와 **실제 앱/도구 실행 입력·출력·SHA·화면 또는 로그**를 추가한다. 기존 smoke만으로 제품 기능 완료 처리하지 않는다.
- 일정은 모두 **2026년**, **11/20(금) 팀원 구현 마감·기능 동결**, **11/25 발표** 기준이다. **11/21–22 주말 팀장 검토**, **11/23–24 수정·리허설**, **11/23 시연 영상 최종본**으로 진행한다. 검토 후 동작 수정은 잠금 평가 독립성 정책을 따른다. 제출 최종 시각/형식은 팀장 확인 전 미확정이다.

## 배정 요약과 병렬 착수

| 담당 | 소유 모듈 | 큰 작업 4개 | 즉시 시작 / 인계받을 것 |
|---|---|---|---|
| 윤정준 `@drivee2242` | 원문·정규화·법령 버전·근거 조회 | J1 출처, J2 법령, J3 검색, J4 데이터 묶음 | 출처 확인표부터 시작 / 이상협의 필요한 질문·판정 조건, 오연석의 견적·계수 필드 |
| 이상협 `@hyeobikong` | 입력·추가질문·판정·senpi 구독 runner 연결 | H1 입력, H2 후보, H3 게이트, H4 도구/세션 | `CaseInput` 파서부터 시작 / 윤정준의 근거, 오연석의 업체/비교 함수 |
| 오연석 `@Oyeonseok` | 업체·비용·탄소·작은 앱/조건부 보고서 화면 구현 | O1 업체, O2 비용, O3 탄소, O4 앱/화면·데모 연결 구현 | `DecisionResult` 상태별 화면부터 시작 / 이상협의 실행 함수, 윤정준의 출처/참고자료 |

각자 4개 작업을 비슷한 크기의 검증 가능한 단위로 잡는다. 입력/도구 연결과 앱/보고서 연결을 두 사람에게 나누고, 데이터 담당은 가격·업체·계수의 원문 준비를 맡아 비교 담당이 수집까지 떠안지 않게 한다. 각자 사례 10건 수집과 다른 사람 영역 1회 교차검토를 병행한다. 진행 편차는 11/10 정상 1건 연결 시 팀장이 범위를 줄여 조정한다.

## 윤정준 — 출처·정규화·검색

소유 경로: `src/sources.ts`, `src/evidence.ts`, `data/sources/`, `data/reference/`, `tests/sources.test.ts`, `tests/evidence.test.ts`.
기존 `data/source.example.json`은 형식 참고일 뿐 실제 출처로 쓰지 않는다.

**2026-11-05 PR #15 검토:** typecheck/build/smoke 및 모듈 테스트 20개 통과. 실제 묶음에서 가격 136개(비플라스틱 9행 제외), 업체 31행, 일반 법령 인용 1건을 실행했고 가격 공란·권리 미확인·해시 불일치·적용일 이전·오래된 근거·잘못된 날짜의 보류를 확인했다. 숫자 범위 초과와 업체 기준일 검증을 보완했다. 이는 Azure/앱 통합 시연이나 법적 적합성 검증이 아니다.

| 항목 | 진행 상태 | 다음 작업 |
|---|---|---|
| J1 / #1 | 확보 범위의 manifest·권리·해시·원문 대조 완료 | 11/20 동결 전 갱신·권리 재점검. 현재 상태는 [출처 인계](../data/sources/README.md) |
| J2 / #2 | 부분 완료: PR #17 선택 별표·고시 참조 검증 | 윤정준: PP/PE·사출/압출의 좁은 조건에서 별표 4·4의2·4의3·5의3 원문과 선택 고시 인용을 확보. 실제 사업장 적용성·시설/품질·구법 전문은 미완료. 11/20 동결 전 현행성 재확인 |
| J3 / #3 | 부분 완료: 구성 입력 8건의 조건부 인용 재현 | 윤정준: 날짜·공정·오염·용도 변화, 주장→발췌→원본 해시/위치 확인. 용도 필터 무결과 이유 누락 수정. 실제 비식별 사례·독립 라벨과 H 앱 연결은 계속 필요 |
| J4 / #4 | 확보 범위의 데이터 묶음 인계 완료 | 오연석은 허가 미확인 업체와 참고 매각가격만 사용; 사용권·GWP·경계 미확인 계수는 계산 불가 유지 |

윤정준의 다음 우선순위는 **#2 실제 법령 적용 근거 → #3 실제 사례 인용 증거**다. 최초 30건 후보 수집과 11/20 snapshot 동결 책임은 유지한다. **2026-11-06 PR #20 (`f5ac941`)에서 #16 공통 검사 후속을 완료했다.** `typecheck`는 기존 소스 검사와 Bun 타입의 전체 테스트 검사를 함께 실행하며 sources/evidence/H1을 포함한 9개 테스트 파일을 검사한다. 고정 Bun 1.4.2 CI에서 frozen install, 두 타입 검사, 전체 197개 런타임 테스트, 두 빌드와 공식 offline smoke를 통과했다. 이는 실제 사례·앱/Azure 통합 완료를 뜻하지 않는다.

**PR #17 검토 범위:** 공식 PDF 4개와 배포 원문의 해시를 대조하고 구성 입력 8건을 실제 CLI로 실행했다. 일반 조건에서 5개, 식품 목적에서 7개 인용을 반환하지만 모든 데모는 검토 필요 상태다. `verifiedThrough=2026-11-05` 이후에는 현행성 미확인으로 보류한다. `lookupLegalEvidence`의 `issues`·`reviewRequirements`를 함께 읽어야 하며 `pendingLegalSources`만으로 전체 검토 대기를 판단하지 않는다. #2/#3은 닫지 않는다.

<a id="j1"></a>
### J1 출처 manifest와 원문 준비

- [x] 법령·업체·가격·계수별 접근/다운로드/권리/최신성/필드 확인 상태표를 만든다.
- [x] 확보한 원문에 기관·URL·locator·조회일·시행 기간·버전·실제 파일 hash·license/licenseVerified를 기록한다.
- [x] 권리 미확인 자료는 배포 묶음에서 제외하고 누락 이유를 인계한다. 아직 받지 않은 CSV/PDF에 hash나 검증 완료를 만들지 않는다.

<a id="j2"></a>
### J2 코드·법령 버전 조회

**2026-11-12 상태 대조:** `src/evidence.ts`와 `tests/legal-registry.test.ts`에 공정·오염·기준일별 조건부 인용과 원본 추적이 구현되어 있다. 다만 번들 별표의 검증 범위는 `2026-11-05`까지이며 그 이후는 `currentness-unverified`로 보류한다. 아래 J2와 J3의 전체 완료 체크는 현행 자료 인수 전까지 유지한다. 코드가 없다는 뜻이 아니다.

- [ ] 발생 공정·오염·평가일에 맞는 코드/재활용 유형/별표 근거를 연결한다.
- [ ] 시행일·개정/적용 기간을 구분하고 구법·다른 사업장 인정·관련 없는 근거를 배제한다.
- [x] 별표·고시 전문 미확보 시 자동 적합 판정용 자료가 아니라 검토 필요 항목으로 반환한다.

<a id="j3"></a>
### J3 근거 검색과 인용 추적

- [ ] `CaseInput`의 맥락과 `assessmentDate`로 버전 고정된 `EvidenceRecord[]`를 조회한다.
- [x] 주장→sourceId→조항/표/행 원문 위치를 추적 가능하게 넘긴다. 검색 유사도만으로 인용 지지를 확정하지 않는다.
- [x] 검색 무결과·접근 실패·오래된 자료·권리 미확인을 구분한다. 조회 자료 속 명령은 실행하지 않는다.

<a id="j4"></a>
### J4 비교용 데이터 묶음 인계와 품질 검사

- [x] 업체 원자료와 가격 CSV를 확보한 범위만 정규화하고 결측·중복·기준일을 검사한다.
- [x] 가격은 수지·형태·권역·기준월·단위·VAT/물류 경계를 보존하고 참고 매각가격임을 표시한다.
- [x] 확보 가능한 계수는 원문/권리/단위/경계 검토 상태와 함께 오연석에게 넘긴다. 전체 처리·운송 계수 확보를 전제하지 않는다.

**입력·출력 인터페이스:** `CaseInput` → `EvidenceRecord[]`를 이상협에게 제공한다. 오연석에게는 원자료와 `EvidenceRecord[]`, `FactorRecord`에 채울 수 있는 검증된 필드/미확인 목록을 제공한다. `FactorRecord` 계산용 registry의 최종 작성과 검증은 O3 소유다. 업체 원자료는 O1이 `ProcessorCandidate[]`로 변환한다. 조회 함수의 에러/보류 전달은 기존 `DecisionResult` 상태에 연결하고 공통 타입 변경은 리뷰받는다.

**완료 기준·테스트·데모:** J1은 실제 확보 원문과 manifest의 hash/locator를 맞춘다. J2/J3은 같은 입력의 기준일을 바꿨을 때 적용 근거가 바뀌거나 검토 필요로 남는 테스트, 무결과·권리 미확인·관련 없는 인용 배제 테스트를 통과한다. J4는 CSV 빈칸을 0으로 바꾸지 않는 테스트와 일부 원문 행 대조 기록이 있다. 정상 데모에서 결론의 원문 위치·시행일을 열고, 미확보 근거 사례에서 확정하지 않는 결과를 보여준다.

**의존 관계·인계:** 11/6까지 세 명에게 첫 `EvidenceRecord` 형식 예시/누락 목록, 11/8까지 수동 검증 근거 1건을 이상협에게 넘긴다. 11/10까지 오연석에게 업체/가격/계수별 가능·보류 데이터 묶음을 준다. 이상협은 필요한 판정 조건·질문 목록을, 오연석은 단위·견적·계수 필드 누락 목록을 역으로 전달한다.

| 주차 | 마감과 제출물 |
|---|---|
| 11/5–7 | J1 상태표·manifest 초안, J2 적용일 검토 목록, 사례 10건 후보 |
| 11/8–11 | J2/J3 정상 근거 조회, J4 첫 데이터 묶음, 11/10 E2E 연결 지원 |
| 11/12–15 | 인용 일치/누락 개선 2회에 필요한 자료 수정, 18건 개발셋 출처 점검 |
| 11/16–20 | 11/20 source snapshot/권리/버전 동결, 잠금 평가용 동일 조회 재현 인계, 자료 부족은 보류 명시 |

**심사 기여:** 판단 신뢰성 20점의 출처·시행일·권리 근거, 문제해결력 20점의 실패 원인/개선 기록, 현장 적용성 20점의 실제 사용 가능한 자료에 기여한다. 점수 획득을 보장하는 배정은 아니다.

**막히면:** [데이터 S1–S12와 미확보 목록](data-sources.md), [근거/계산 경계](architecture.md), [인용 평가와 잠금 원칙](evaluation.md), [데이터 인수 조건](delivery-plan.md).

## 이상협 — 입력·판정·도구 연결

소유 경로(예정): `src/input.ts`, `src/assessment.ts`, `src/domain.ts`, `src/session.ts`, `tests/input.test.ts`, `tests/assessment.test.ts`, `tests/session.test.ts`.
기존 `src/extension.ts`는 H4에서 얇게 확장한다. 일반 코딩 도구를 사용자 앱에 노출하지 않는다.

**2026-11-06 PR #19 모듈 검토·병합 (`f1cfbd0`).** `parseCaseInput`과 `collectMissingQuestions`의 구조화 입력 검증·미상 질문을 수용했다. 검토 head `e9908c4`에서 전체 197개 테스트, 두 타입 검사·두 빌드·공식 offline smoke 및 독립 JSON 입력 15건이 통과했다. 원문/공백과 null을 보존하고 사진/설명만으로 수지·유해성·코드를 확정하지 않는다. [승인 리뷰](https://github.com/GunP4ng/resource-ai/pull/19#pullrequestreview-5795013351).

| 항목 | 진행 상태 | 다음 작업 |
|---|---|---|
| H1 / #5 | PR #22 로컬 입력·질문·수정과 운영 진입점 인계 수용 | 파서·질문 범위 완료. 실제 Azure 호출과 검토된 운영 자료 연결은 #8/#12에서 계속 수행 |
| H2 / #6 | 부분 완료: PR #24 디코딩·동의 저장소와 조건부 후보/질문·재현 증적 수용 | 이상협: 승인된 실제 사진/사례와 운영 검토 자료 공급; 사진 추론·현장 인수는 미완료, 코드 후보를 적합 판정으로 승격하지 않음 |
| H3 / #7 | PR #21 host gate 모듈 수용 | 빈/가짜/권리 미확인 근거 거부, 정보 부족/위험 검토/인간 승인 대기 회귀 유지; 운영 통합은 #8/#12 |
| H4 / #8 (CLOSED, PR #25 자동 종료) | 구독 모델 runner 연결로 재범위화; PR #24 운영 조립 계약 유지. 실제 구독 실행 인수는 미완료로 #12에서 추적 | 이상협·오연석: 구독 실행 성공/usage/request ID 및 실패/취소 증거, 운영 revision commit/rollback·예산/사용량 관리·durable audit와 운영 자료 인계. Azure는 opt-in |

PR #19 검토 당시 앱의 같은 Origin/session `POST /cases`는 실제 HTTP 503을 반환했다. H1 모듈 병합이 H4/O4 연결이나 Azure 성공을 뜻하지 않으며 #5/#8/#12의 통합 완료는 별도 검증한다. PR #20에서 H1을 포함한 전체 테스트 정적 검사와 공통 CI를 연결했다. 11/10 정상 통합·11/20 기능 동결 일정과 기존 담당자는 유지한다.

**2026-11-06 PR #21 검토·병합 (`b1ac1ca`).** H가 제공하는 `createResourceApp`으로 실제 HTTP/브라우저의 질문→답변→조건부 비교와 변경된 질량/현행성 보류를 확인했다. 합성 검토 자료의 240,000 KRW·45 kgCO2e는 테스트 기대값이며 운영 견적/배출이 아니다. 사례 전용 credential 저장소를 명시하고 Node/Bun 테스트 타입 환경을 분리하는 작은 수정을 반영했다. 전체 277개 테스트, 모든 strict 검사·두 빌드·offline smoke가 통과했다. 전체 11개 테스트와 helper가 정적 검사에 포함된다. [승인 리뷰](https://github.com/GunP4ng/resource-ai/pull/21#pullrequestreview-5795704273). 실제 Azure/이미지 호출·운영 ResourceProvider·기존 `scripts/app.ts` 연결은 남아 있으며 #5/#6/#8/#12는 해당 미완료 범위로 유지한다.

**2026-11-06 PR #23 검토·병합 (`13209f5`).** 서버 resolver가 승인한 사례/revision/참조의 PNG/JPEG 바이트를 크기·서명·SHA256 검사 후 SDK로 전달하는 범위를 수용했다. 실제 SDK의 합성 이미지 전달과 수정 시 revision 재조회, strict JSON400/form303/typed JSON303, 기존 앱의 같은 사례 수정·현행성 보류를 직접 실행했다. Linux/Bun1.4.2에서308개 테스트, 모든 strict 검사·두 빌드·offline smoke와 exact-head CI가 통과했다. [승인 리뷰](https://github.com/GunP4ng/resource-ai/pull/23#pullrequestreview-5796588370). 차단 결함이나 추가 수정 커밋은 없었다. 작성자의 Windows 종료 검사 실패는 Linux에서 재현되지 않았으며 Windows 검증 완료로 표시하지 않는다.

이 검증은 합성1x1PNG·주입 응답을 사용했으며 실제 Azure 호출 성공이나 운영 사진 저장소 연결이 아니다. 서명 검사는 전체 이미지 디코딩·EXIF 제거를 보장하지 않는다. 이상협은 #6/#8에서 서버 저장소의 소유권·모델 전달 동의·디코딩/개인정보 최소화·보관기간을 확인하고, 팀장 승인 배포/비용 상한 아래 실제 사진의 공정/오염 조건별 질문·판정과 추적/사용량·실패/취소를 인계한다. 오연석은 #12에서 그 실행 상태와 실제/합성 구분 및 정상3분/보류2분 시연 경로를 연결한다. 윤정준의 #2/#3 현행성·실제 근거와 원본/파생 계보 인계는 유지한다. #6/#8/#12의 실제 통합 체크박스는 미완료이며 새로 종료할 이슈는 없다. 11/10 통합·11/11 인계·11/20 기능 동결과 기존 담당자는 바꾸지 않는다.

**2026-11-06 PR #24 재검토 승인·병합 (`5e8359f`).** [재검토 승인](https://github.com/GunP4ng/resource-ai/pull/24#pullrequestreview-5798057040)은 `c1504bb` 기준이다. 사진 디코딩·파일 저장소·승인 callback·오프라인 증적의 로컬 구현을 수용했다. JSON 저장 뒤 증적 SHA가 달라지는 문제는 이전 검토에서 실패 회귀 후 `4996576`으로 수정했다. 재검토 head와 병합 main 모두 모든 strict 검사·두 빌드·offline smoke와 **351개 테스트/0실패**, 실제 HTTP·SDK 시나리오가 통과했다. 기본 앱의 desktop/mobile 제출·수정도 확인했다.

이전 차단 항목인 **인증 후 전체 요청 제한시간 재시작은 해결됐다.** 동일한 `timeoutMs=200`/정상 인증150ms 입력은 이제 **200.58ms에 HTTP504**를 반환했다(이전352ms, 허용275ms). 단일 monotonic deadline을 인증·본문·자료·runner가 공유하고 종료 감사도 남은 예산 안에서 끝낸다. 실제 HTTP의 지연 수정504와 이전 보고서 보존, 실제 SDK/합성 transport의 취소408·runner timeout504·terminal audit 실패502·추가 dispatch 없음·usage=null을 확인했다. [요청 시간·감사 계약](h-request-deadline.md)을 운영 공급자 인수 기준으로 사용한다.

다음 배분: 이상협은 #6/#8에서 승인된 실제 사진의 질문/판정 차이·저장/철회/만료를 실행하고, 팀장이 승인한 Azure 설정·과금 상한 아래 실제 성공/실패·추적/사용량을 인계한다. 오연석은 #12에서 인증 actor/사례 소유권·업로드/동의/철회 UI, 요청별 revision staging→성공 commit/실패 rollback 및 동시 수정 정책, 검토된 운영 ResourceProvider와 정상3분/보류2분 시연 경로를 연결한다. H/O는 원자적 예약·해제/정산과 durable audit 실패 시 증거 보존을 함께 인수한다. 윤정준은 #2/#3의 현행성·원문/파생 계보·권리 근거를 계속 공급한다.

실제 유료 Azure 요청과 현장 사진 인수는 이번 검토에서 0건이다. 기본 launcher는 local-only이며 환경변수만으로 모델 호출을 켜지 않는다. #6/#8/#12와 해당 실제 통합 체크박스를 OPEN으로 유지하며, 11/20 기능 동결·기존 담당자·팀장의 권한/과금 승인 및 통합 QA·녹화 책임을 변경하지 않는다. HTTP504/408/502는 미과금 또는 재시도 안전 증거가 아니다.

**2026-11-10 PR #31 검토·병합 (`3ebddd7`).** [승인 리뷰](https://github.com/GunP4ng/resource-ai/pull/31#pullrequestreview-5840313341)는 head `7776b7a` 기준이다. 테스트 2건만 추가하며 생산 코드와 O/J 계약은 변경하지 않았다. head와 병합 main 모두 Linux/Bun 1.4.2 strict 검사·두 빌드·offline smoke·**523 tests / 0 failures**를 통과했다. 별도 실제 private SQLite·native 로그인 cookie·SDK/합성 transport 실행에서 미인증 403/전송 0, 전송 중 계정 disable 시 403/기존 사례 보존/제공자 success·usage 감사 보존, 취소 408와 terminal audit 완료 전 `settled()` 대기를 확인했다. 실제 제공자 계정·현장 사진·청구/정산 인수는 아니며 #8 CLOSED, 남은 H/O 인수는 #12에서 추적한다.

<a id="h1"></a>
### H1 입력 파싱과 추가질문

- [x] 설명·사진 참조·공정·수지·오염·유해접촉·질량·지역·평가일을 `CaseInput`으로 검증한다.
- [x] 0/음수 질량·잘못된 날짜는 거부하고 미상 질량/수지/발생원은 확인 질문으로 구분한다.
- [x] 사진만으로 확인할 수 없는 화학성분·유해성·법적 코드를 확정하지 않는다.

<a id="h2"></a>
### H2 분류 후보와 경로 판단

- [ ] 사진+공정/성상에서 수지/코드 후보와 필요한 질문을 제시한다.
- [x] 윤정준의 근거를 사용해 재사용·기계적 재활용·기타 회수·처분을 `RouteAssessment[]`로 만든다.
- [x] `eligible`/`ineligible`/`unknown`을 구분하고 누락·모순·위험 정보는 검토 대상으로 남긴다.

<a id="h3"></a>
### H3 host 결과 검증과 안전 차단

- [x] `eligible` 빈 근거·존재하지 않는 sourceId·배포 사용권 미확인 자료를 host에서 거부한다.
- [x] 기존 구현은 정보 부족을 `needs-information`, 위험/근거 충돌을 `needs-review`로 전달한다. 이는 과거 계약의 구현 기록이다.
- [x] 도구 출력/검색문서/사진 속 명령을 실행하지 않고, 처리/계약을 자동 실행하지 않는다.
- [ ] 새 목표에서 현장 확인만 남은 정상 사례는 compared와 실행 전 확인 목록을 산출하고, 필수 차단 4종은 막는 것을 실제 세션에서 확인한다.

<a id="h4"></a>
### H4 senpi 도구·단일 세션·구독 모델 runner 연결

**2026-11-06 범위 변경:** 기본 실행 공급자는 Azure에서 senpi `chatgpt-subscription`으로 변경한다.
`createSubscriptionRunner`는 기존 SDK auth.json과 `gpt-6-sol` 기본 모델을 사용하며 Azure 환경변수를 요구하지 않는다.
launcher 기본값은 `RESOURCE_MODEL_RUNNER=subscription`; `local`은 기존 오프라인 평가,
`azure`는 기존 Azure 경로의 명시적 선택이다. 미구성 모델/인증은 `not-configured`로 실패한다.
아래 과거 PR 기록의 local-only/Azure 필수 설명은 당시 검증 기록이다.
#8은 구독 runner 연결과 실제 구독 실행 인수로 재범위화하며 이상협 담당·11/20 동결은 유지한다.
**2026-11-12 정정:** #8은 2026-11-06 PR #25 병합(`253b718`) 때 자동으로 CLOSED 되었다. 아래 미체크 항목(실제 구독 호출·추적·사용량)은 완료되지 않았으며 #12에서 계속 추적한다. 이슈가 닫힌 것을 실제 구독 실행 인수로 읽지 않는다.
합성 HTTP/SSE의 정상/취소/timeout/인증/요청제한/공급자 실패와 미구성 앱 실행 검증을
실제 구독 성공이나 현장 사진 인수로 표시하지 않는다. 운영 자료·사진 동의·사용량 인계는 계속 필요하다.

- [x] 기존 공식 extension 등록 패턴과 SDK를 사용해 `ResourceDomain` 함수와 제한된 도구를 연결한다.
- [x] 케이스별 독립 세션으로 구성하고 앱에서 범용 bash/read/write 도구를 제외한다. 권한 검사는 host가 수행한다.
- [ ] 승인된 구독 계정으로 실제 호출·추적·사용량·timeout/취소/인증 실패 상태를 전달한다. Azure는 선택 경로로 보존하고 비밀값은 기록하지 않는다.
- [x] `src/domain.ts`에서 `assessRoutes`는 H2, `findProcessors`는 O1, `compare`는 O2/O3 구현으로 조합한다. 도메인 코어가 SDK/UI를 import하지 않게 한다.

**입력·출력 인터페이스:** 사용자 원문 → `CaseInput`; `CaseInput` + 조회 `EvidenceRecord[]` → `RouteAssessment[]`; `ResourceDomain.assessRoutes`, `findProcessors`, `compare`를 연결해 `DecisionResult`를 O4에 넘긴다. 비교 입력은 별도 `ComparisonInput`을 사용하며 `CaseInput`에서 견적/기준선을 추측해 만들지 않는다. 질문/실패를 성공 결과로 감추지 않는다. 원문 파서/실행 함수는 senpi의 새 API라고 주장하지 않는다.

**완료 기준·테스트·데모:** 정상 입력→근거→조건부 판정이 실제 세션에서 완주한다. 경계 입력(0/음수/미상 질량·잘못된 날짜), 오염/발생원 불명 보류, 빈/가짜 근거 거부, 자료 속 실행 지시 무시를 테스트한다. 서로 다른 두 case의 상태 분리 테스트와 구독 runner 실패 상태 증거를 팀장 통합 확인에 인계한다. 데모는 같은 사진의 공정/오염 정보를 바꿨을 때 필요한 질문/판정이 달라지는 것을 보여준다. 실제 구독 호출 성공 증거는 로고나 오프라인 smoke로 대체하지 않는다.

**의존 관계·인계:** 11/6까지 고정 입력과 `DecisionResult` 각 상태 예시를 오연석에게 준다. 11/8까지 윤정준에게 필요한 근거/누락 질문을 확정해 주고 첫 조회를 연결한다. O1/O2/O3은 계약 기반으로 먼저 연결하고 11/10 정상 1건을 합친다. 구독 계정의 실행 승인·사용량 상한은 팀장이 확인하며 미구성 시 연결 실패/준비 상태를 표시한다. Azure 선택 시에만 별도 권한·배포명·과금 상한을 확인한다.

| 주차 | 마감과 제출물 |
|---|---|
| 11/5–7 | H1 파서/질문·고정 상태 예시, H4 세션 진입점 |
| 11/8–11 | H2/H3 근거 연결, H4 실제 구독 runner/도구 연결, 11/10 정상 완주·11/11 첫 데모 |
| 11/12–15 | 위험 확정/과도한 보류 개선 2회, 18건 개발 결과와 실패 상태 점검 |
| 11/16–20 | 11/20 모델/프롬프트/규칙/도구/코드 동결, 팀장 최초 12건 잠금 평가에 실행 방법·실패 상태 인계 |

**심사 기여:** 문제해결력 20점의 질문→개선 과정, 창의성 20점의 조건에 따라 바뀌는 판단, 판단 신뢰성 20점의 보류/host 검증, 전달력 20점의 실제 실행 추적에 기여한다.

**막히면:** [API·Azure 구성](senpi-and-azure.md), [단일 오케스트레이터와 운영 경계](architecture.md), [보류/위험 평가](evaluation.md), [실제 SDK smoke 범위](verification.md).

## 오연석 — 업체·비용/탄소·앱/조건부 보고서 화면 구현

**2026-11-13 O 재배분 2차 확인·O4 supplier 선택 구현 인계 (미커밋).** 작업 branch는 `feat/oyeonseok-o4-supplier-selection`, base는 `ceb9e48b6db3e1a16b1eb69a65a35da8482b0dc4`다. O는 기본 `o-journal`과 trusted typed injection 전용 `h-suppliers`의 상호 배타적 서버 조립을 구현했다. 기본 환경 launcher는 O journal을 유지하고 H 선택에서는 journal 디렉터리·lock·DB를 열지 않는다. H의 reserve/해제/aggregate reconcile·실제 H audit store를 한 번만 연결하며 O journal 감사/정산을 중복하지 않는다. `startApp({suppliers:{configuration,open}})`는 명시적 operational mode와 실제 supplier bundle을 요구하며 `RESOURCE_OPERATIONAL_CONFIG`와 동시 사용하지 않는다. 임의 환경 JS loader나 production 기본 supplier는 없다.

H-native config는 기존 실행/정확한 grant/기술 quota 필드를 공유하되 `journalCapacity` 대신 명시적 `budget:{mode,policyReference,budgetReference}`를 사용한다. 실제 financial/request-quota 정책·원자적 quota·durable approval pinning은 주입 ledger의 소유다. 재사용 approval은 동일 설정만 허용하고 재시작/재로드로 소비·미해결 quota를 초기화하지 않는다. O는 actor/case/lease/input/artifact·credential inode·선택 사진/동일 authority ticket을 reserve 전후와 H payload/audit 뒤 마지막 동기 dispatch 경계에서 확인한다. 종료·reload는 실제 H finalize/late reserve·raw transport/supplier·bundle settlement가 끝나기 전에 자원을 닫지 않는다. reload 실패와 recovery enqueue 실패는 admission을 멈추며 종료 중 reload 완료로 재개하지 않는다.

실제 ledger·승인 예산·provider/account/model/purpose 승인과 식별된 private-file guard/독립 recovery supervisor/retention policy·책임자 승인은 여전히 공급되지 않았다. 해당 운영자가 실제 bundle을 공급해야 후속 H 통합이 가능하다. 테스트 공급자는 O 소유 `TEST-ONLY-sqlite-quota-ledger`, `TEST-ONLY-posix-inode-sidecar-guard`, `TEST-ONLY-independent-recovery-connection`, `TEST-ONLY-retain-all-obligations`이며 실제 private disk와 H audit/recovery store를 사용하지만 financial/live 인수 증거는 아니다. Audit capacity와 사진 retention은 감사 보관 승인이 아니다. 독립 supervisor는 프로세스 사망/감사 DB 불가·lost response·만료 예약을 ledger와 recovery-only store로 복구하고 자신의 timeout 뒤 handler도 drain해야 한다. [API·소유권·검증 명령·지원 한계](o-operational-handoff.md#mutually-exclusive-accounting-selection)를 따른다.

O1은 허가/인수 실제 근거, O2는 검토 견적·독립 `CaseMassReview`, O3은 권리/GWP/경계가 검증된 계수가 없다는 기존 차단을 유지한다. 이 기능들의 source/비교/legal/fixture와 O 후보 입력 및 PR35 사진 inventory는 이번 변경에서 수정하지 않았다. O의 [합성 후보10건](o-candidate-handoff.md)은 이미 전달됐고 exposed development 후보이며 J/H의 독립 라벨은 수집자 O가 대신 작성하지 않는다. 전체30건의 인수·중복/출처 검토·18/12 배분은 미완료다. PR35의 **미검토 metadata700 사진은 현장 package나 입력/전송 승인이 아니다**. 현재 field package도 공급되지 않았다. Parent는 전체 suite·실제 HTTP/UI QA·Astra 최종 gate·PR을 맡는다. **#12 OPEN, #8 CLOSED**, 실제 실행/영상 인수 미완료와 11/20 동결은 유지한다.

**2026-11-05 PR #18 재검토·병합 완료 (`32e958d`).** 이전 P1은 근거가 binding된 독립 `CaseMassReview`에 견적 사례 질량을 대조하여 해결했다. 혼합 물량과 모든 견적이 함께 오래된 물량을 가리키는 입력 모두 순비용을 보류한다. P2는 제외한 크레딧의 계산상 0과 근거 있는 0을 구별하고 공개 결과·순배출·회피량·보고서 요약에 경계를 보존한다. head `beb0e1f`의 151개 테스트, 두 타입 검사·두 빌드·격리 SDK smoke 및 이전 두 회귀 입력 재실행이 통과했다. 정상 비용 240,000/230,000원·순배출45, 제외 경계 순배출100, 보류/검토 화면을 실제 데스크톱·390px 브라우저로 확인했다. [재검토 승인](https://github.com/GunP4ng/resource-ai/pull/18#pullrequestreview-5791831191).

| 항목 | 진행 상태 | 다음 작업 |
|---|---|---|
| O1 / #9 | 필터·근거 보존 구현 수용 | 오연석·윤정준: 실제 허가/인수 확인 자료 확보 시 재검증. 디렉터리 등재를 허가나 수탁 의사로 승격하지 않음 |
| O2 / #10 | 단위·사례 질량·비용 경계 구현 수용 | 오연석·이상협: 독립 `CaseMassReview`와 검토된 실제 견적을 #12 통합 입력에 연결. 질량 보완물 없으면 합계 보류 |
| O3 / #11 | 계수 검증·배출/크레딧·제외 경계 구현 수용 | 오연석·윤정준: 권리·GWP·경계가 검증된 계수 확보. 미확보 계수는 계속 `unavailable` |
| O4 / #12 | PR #29 운영자·SQLite·자료 연결과 PR #30 설치 CLI·명시적 재평가·중단 복구 수용 | 오연석·이상협·윤정준: 실제 현장 package 위치·권리/현행성/계보, 승인 계정/provider/model/purpose·한도, 실제 실행/usage·영속 감사·예약/정산 인계. [PR30 승인](https://github.com/GunP4ng/resource-ai/pull/30#pullrequestreview-5840489031) |

**2026-11-06 PR #29 검토·병합 (`2bf8579`).** 최종 검토 head는 `55b0d6a`다. 별도 연결의 갱신·정리 사이에서 사례 행과 아티팩트가 다른 시점을 읽는 결함을 실제 두 SQLite 연결 회귀로 재현한 뒤, `55b0d6a`에서 deferred read transaction으로 수정했다. 수정 head의 모든 strict 검사·두 빌드·offline smoke·**521 tests / 0 failures**, exact-head CI `42253968286`이 통과했다. 실제 HTTP 보고서 읽기 중 갱신·정리에도200/일관된 기존 자료를 반환하고 다음 요청은 새 revision을 읽었다.

실제 운영자 CLI와 Chrome native 로그인→생성→수정→입력 내보내기, 소스에서 패키지로 재시작한 뒤 같은 SQLite의 입력 bytes/ETag·사례/보관기한·보고서 복구를 확인했다. 저장 전용 합성 PNG의 모델 선택 비활성·철회 후 preview404·정리, 기존 J 원문/인용 snapshot9개의 실제 bytes/SHA를 담은 private artifact 재평가, 잘못된 artifact SHA503/기존 보고서 보존도 확인했다. desktop1440/mobile390 light/dark 화면과 실제 `/reference`의 참고가격136행·등재업체31행을 검토했다.

이는 로컬 구현 수용이며 현장 인수가 아니다. 사례·계정·사진은 합성이고, 원문9개는 기존 배포 snapshot이다. 오늘의 법령 현행성·실제 허가/견적/계수·원본에서 파생 fact의 지지 관계·실제 외부 제공자 실행/usage·영속 감사/정산·통합 시연 영상은 미완료다. 로그인과 SHA는 자료 승인을 뜻하지 않으며 날짜2026-11-06의 현행성 보류를 유지한다.

후속 배분은 #12에서 계속한다. 오연석은 정확한 actor/case/revision의 검토된 현장 package 설치·재평가와 실행/실패/usage 표시 인계, 이상협은 승인 계정/provider/purpose·한도 아래 실제 구독 실행·취소/실패·usage 및 H/O 감사/정산, 윤정준은 현행성·권리·원본/파생 계보를 맡는다. 팀장은 계정/한도/지원 OS 승인, 통합 QA·잠금 평가·영상/최종 보고서를 유지한다. #12 OPEN, #8 CLOSED와 기존 담당·11/20 동결을 유지하며 실제 실행·백업 영상 체크박스를 완료로 바꾸지 않는다.

병합 main `2bf8579`도 동일 strict 검사·두 빌드·offline smoke·521개 테스트와 실제 HTTP 읽기 회귀를 통과했다. main CI `42254698501` 성공을 별도로 확인했다.

**2026-11-10 PR #30 검토·병합 (`b7ddaaa`).** [승인 리뷰](https://github.com/GunP4ng/resource-ai/pull/30#pullrequestreview-5840489031)는 head `2abfc48` 기준이다. exact head의 strict 검사·extension/app/account/artifact 빌드·offline smoke·**549 tests / 0 failures**, PR #31 병합 main `3ebddd7`과 실제 결합한 tree의 strict 검사·**551 tests / 0 failures**를 확인했다. 검토자 production 수정은 없었다.

병합 main `b7ddaaa`도 별도 checkout에서 모든 strict 검사·두 빌드·offline smoke·**551 tests / 0 failures**를 통과했다. 검토 head와 병합 결과의 실행 코드·자료 CLI·관련 테스트 bytes가 같아 실제 앱/CLI 증거도 해당 결과에 적용된다.

별도 packaged CLI·실제 HTTP·Chrome native 로그인→생성→입력 export→설치→재평가를 실행했다. 기존 J 원문/인용 snapshot 9개의 bytes/SHA 일치, 설치만으로 보고서 불변, 같은 bytes 재시도·다른 bytes 덮어쓰기 거부, 명시적 재평가 후 exact hash/version을 확인했다. 실제 link 직후 프로세스를 중단하면 두 링크 파일을 loader가 503으로 거부하고 기존 보고서를 보존했다. 문서대로 소유 hidden link를 정리한 뒤 동일 bytes 설치 재시도가 성공했다. 이는 전원 장애 실험이 아니다. desktop 1440/mobile 390 light/dark에서 합성·review-required 표시를 확인했고, 평가일을 2026-11-10으로 수정하면 이전 artifact를 재사용하지 않고 현행성 보류를 유지했다.

다음 배분: 오연석·윤정준은 실제 현장 package의 **위치/입력 revision/권리·현행성/원본-파생 지지 관계**와 견적·독립 질량·허가/인수·계수를 인계한다. 이상협·오연석은 팀장 승인 계정/provider/model/purpose·한도 아래 구체적 원자적 예약·해제·정산·영속 감사 의존성 및 실제 성공/실패/취소/request ID/usage, 승인 현장 사진의 조건 변화·철회·만료를 인수한다. 세 팀원의 10건씩 후보·출처/중복 점검·수집자 외 독립 라벨과 18/12 분리, 팀장의 통합 QA·잠금 평가·영상/최종 보고서는 미완료로 유지한다. #12 OPEN/Oyeonseok, #8 CLOSED/hyeobikong과 11/20 동결을 유지하며 실제 실행·백업 영상 체크박스를 완료로 바꾸지 않는다.

**2026-11-07 O4 설치 인계 로컬 구현·검증 완료 (당시 미병합; 11/10 PR #30 병합).** `o-artifact.ts check|install`은 기존 private state의 활성 username→actor와 현재 소유 사례·정확한 입력 revision·편집 기한을 확인하고, 기존 validator로 검증한 `{record,sha256}` bytes만 private resources 경로에 설치한다. 설치는 재평가가 아니며 명시적 인증 `/answers`와 `baseVersion`으로 재평가해야 저장 결과에 반영된다. 승인/live/과금 완료를 뜻하지 않는다. 사례·보관·세션·사진 권한·lease는 바꾸지 않고 runner도 호출하지 않는다. [명령·동시성·복구 경계](o-runtime-integration.md#http-recovery-and-exact-artifact-installation)를 따른다.

Linux/Bun 1.4.2에서 최종 전체 **549 tests / 0 failures**, strict source/test·O-test 타입검사, extension/app 빌드, offline smoke와 diff-check를 통과했다. 실제 CLI/HTTP/Chrome native 로그인·사례 생성·입력 export·패키지 CLI 설치·명시적 재평가를 확인했다. 설치 직후 기존 보고서 유지, 재평가 후 버전2·정확한 자료 해시·합성 표시·현행성 보류, 잘못된 입력 revision 설치 거부를 확인했다. 스크린샷은 CDP timeout으로 확보하지 못했으며 화면 동작과 접근성 트리만 증거로 남겼다. Astra가 지적한 중단 설치 재시도의 상위 디렉터리 fsync 누락은 6개 실패 회귀를 먼저 확인하고 수정 후 통과시켰으며, Astra 재검토는 이 로컬 변경을 승인했다. 실제 전원 장애 실험이나 현장 인수를 수행했다는 뜻은 아니다.

현장 package는 있다고 전달받았지만 위치가 미정이며 이번 인계에 실제 공급된 파일은 없다. 현행성·권리·견적·독립 질량 검토·허가/인수·승인 계수와 원본/파생 지지 관계는 J/O 공급·검토가 필요하다. H/O는 launcher에 아직 없는 구체적 authorize/reserve/release/settle/영속 audit 의존성을 승인 계정/provider/model/purpose·한도 아래 조립해야 한다. UI trace는 provider request ID가 아니며 usage는 청구가 아니다. 실제 성공/실패/취소·request ID/usage·정산 및 승인 현장 사진 전송/철회/만료 인수는 미완료다. 공통 O 10건 수집과 독립 라벨 30건·18/12 분리의 검증된 인계 manifest도 저장소에 없다. 정상3분/보류2분 합성 경로와 현장·live·백업 영상 인수를 구별하며 **#12 OPEN, #8 CLOSED**를 유지한다.

**2026-11-06 PR #28 검토·병합 (`2ee1cb2`).** head `1b1299c`의 명시적 구독 provider/model/account·목적 authority와 read-only credential snapshot, 승인·감사·단일 deadline 아래 사진 실행을 [승인](https://github.com/GunP4ng/resource-ai/pull/28#pullrequestreview-5802416900)했다. Linux/Bun1.4.2 head/main 모두 strict 검사·두 빌드·offline smoke·**412 tests / 0 failures**, main CI `42243089652` 성공. 실제 Node HTTP/Chrome native 생성→사진 동의/업로드→선택/평가303, 실제 SDK 직렬화 이미지 SHA와 저장 SHA 일치, scope 변경·mapping 누락·승인 중 변경 시502/추가 전송0/이전 사례·보고서 보존을 확인했다. local launcher 수정과 default subscription 빈 인증503, 실제 묶음 `/reference`의136가격/31등재업체·계산불가도 유지됐다.

이 검증의 actor·OAuth·1x1PNG·SSE 응답은 합성이다. 실제 계정/외부 모델/현장 사진 인수는0건이며 `liveModelVerified=false`, `outputLimitEnforced=false`다. `maxOutputTokens`는 구독 제공자가 강제하는 사용량 상한이 아니다. 기본 launcher의 사진 실행을 활성화하지 않았고 아래 PR27 당시 Azure 전용 설명은 과거 기록이다. Windows 기존24실패는 작성자 baseline 설명으로 남으며 Windows 통과를 주장하지 않는다.

다음 배분은 #12에서 계속 추적한다. 오연석은 동일 authority를 사용하는 운영 서버 조립·실제 로그인 actor·영속 사례·검토된 ResourceProvider와 실행/실패/usage 화면·정상3분/보류2분 인계를 맡는다. 이상협은 승인 계정/model/provider/purpose 매핑과 한도 아래 실제 구독 성공/취소/실패·usage, 승인된 현장 사진의 질문/판정 변화·철회/만료 증거를 인계한다. H/O는 원자적 예약·동시성/횟수 제한·사후 정산·영속 감사와 지원 OS를 함께 확인한다. 윤정준의 현행성·권리·source snapshot/locator/SHA 인계, 팀장의 계정/한도/매핑·지원 OS 승인·통합 QA·잠금 평가·영상/최종 보고서 책임을 유지한다. #12 OPEN/Oyeonseok, #8 CLOSED/hyeobikong 및 실제 인수 미완료 체크박스·11/20 동결은 그대로다.

O1–O3의 구현 수용은 실제 현장 허가·견적·계수의 확보나 법적 적합성 인증이 아니다. #12의 Azure 통합은 열린 상태로 유지한다. 2026-11-06 O4 변경은 기존 H 어댑터로 로컬 보수적 평가만 연결하며 runner·운영 자료를 공급하지 않는다. 어댑터 없는 `createApp`의 503 동작은 유지한다. 최종 298개 테스트와 소스/패키지 launcher의 실제 제출·질문 갱신·종료, 42개 화면 조합을 검증했고 Astra 최종 검토가 승인됐다. 초기 구현 환경의 loopback 제한은 최종 검증에서 해소됐다.

**2026-11-06 PR #27 재검토·병합 (`ca30725`).** 검토 head `f88f873`의 P1/P2 수정을 [승인](https://github.com/GunP4ng/resource-ai/pull/27#pullrequestreview-5800521446)했다. head와 병합 main 모두 모든 strict 검사·두 빌드·offline smoke·**403 tests / 0 failures**, main CI `42223485970`을 통과했다. 실제 Node HTTP/Chrome native 폼에서 scope 일치의 합성 SDK 이미지 평가, 목적 변경·mapping 누락 시 선택/전송 차단과 재동의, dispatch 승인 중 scope 변경 시 추가 전송 없음·기존 version/질량 보존을 확인했다. 실제 unlink를 marker 저장 뒤 EIO로 실패시켜 JSON 잔존·preview404·pending/재시도를 확인했고, 동일 버튼 재시도로303·JSON 삭제·pending 해제 및 반복303/다른 actor404를 검증했다. desktop1440/mobile390 화면과 익명 local launcher303/report200도 확인했다.

오연석은 #12에서 실제 로그인 검증·영속 사례 저장·검토된 운영 자료와 화면의 실행/실패/usage 인계를 진행한다. 이상협은 [사진 실행 계약](photo-execution-scope.md)을 검토하고 구독 runner의 실제 provider/model에 결합된 guarded 사진 경계와 명시적 provider/purpose 매핑을 인계한다. 현재 authority는 Azure 선택 경로의 기술 계약이며 기본 subscription/local 사진 전송은 비활성이다. H 작성자와 운영 소유자의 정책 승인을 대신하지 않는다. 승인된 현장 사진·실제 제공자 실행·영속 감사/정산과 정상3분/보류2분·live/백업 구분 인수는 미완료이며 #12 OPEN, #8 CLOSED를 유지한다. 기존 담당·11/20 동결·팀장의 통합 QA/잠금 평가/영상·최종 보고서 책임은 그대로다. 이번 검증의 실제 외부 모델 호출은0건이다.

**이전 기록: 2026-11-06 PR #27 첫 검토는 수정 요청, 미병합.** 검토 head `bcb9700`의 strict 검사·두 빌드·offline smoke와 **378 tests / 0 failures**가 통과했다. 실제 네이티브 폼의 생성·잘못된 수정 후 보고서 보존·정상 수정·저장 전용 합성 PNG 미리보기·모델/저장 철회와 desktop/mobile 화면도 확인했다. 그러나 코드 검토에서 저장한 제공자/목적 동의를 현재 전송 scope와 비교하지 않는 경로, 철회 marker 저장 뒤 파일 삭제 실패 시 같은 API 재시도가 정리를 완료하지 못하는 경로를 확인하여 병합을 보류했다. 외부 사진 전송이나 장애 주입으로 재현한 결과는 아니다.

오연석은 #12에서 동의 scope의 선택 가능 조건과 철회 pending/재시도 UI·저장 정리 회귀를 수정하고, 이상협은 실제 dispatch 설정과 동의 scope의 결합·전송 전 검사 계약을 함께 인수한다. 이미 CLOSED인 #8은 재개하지 않고 이번 수정 추적은 OPEN인 #12에 모은다. 실제 로그인·현장 사진·운영 자료·제공자 실행/usage·영속 감사/정산·정상3분/보류2분 시연은 미완료다. 기존 담당·11/20 동결·팀장의 통합 QA와 영상/최종 보고서 책임은 유지한다.

**2026-11-06 PR #22 검토·병합 (`3cccfa6`).** 기본 launcher의 로컬 H `submit`/`answer`, 부분 답변 질문 갱신, 모든 상태의 필드 수정, 같은 사례 유지 및 잘못된 입력의 보고서 보존을 수용했다. 저장소 밖에서 `/reference`가 502를 반환하는 패키지 경로 결함을 실패 테스트 후 `461f63e`로 수정했다. 최종 298개 테스트·모든 strict 검사·두 빌드·offline smoke와 실제 소스/패키지 HTTP·브라우저 검증을 통과했다. [승인 리뷰](https://github.com/GunP4ng/resource-ai/pull/22#pullrequestreview-5796106487). #5의 입력/질문 인계 범위는 완료이며, #8/#12의 실제 Azure·운영 자료·통합 시연은 미완료다. 합성 비교의 숫자와 기본 launcher의 모델 미호출을 실제 Azure 성공으로 표시하지 않는다.

다음 통합 인계는 J/H/O가 원 CSV/PDF와 O의 `/facts` 파생 검토 snapshot의 ID·해시·locator·계보를 구분하는 것이다. 윤정준은 #2/#3에서 2026-11-05 이후 현행성과 실제 사례 근거를 갱신한다. 이상협은 #6/#8에서 검토된 운영 `ResourceProvider`와 팀장 승인 Azure 설정을 연결하고, 오연석은 #12에서 실제 추적/usage·실패 상태와 정상3분/보류2분 시연 경로를 인계한다. 팀장은 Azure 권한·비용 상한, 통합 QA·잠금 평가·영상을 담당한다. 실제 원문이 전체 검토 fact를 그대로 포함한다고 가정하지 않는다. 11/20 기능 동결과 기존 담당자 경계를 유지한다.

소유 경로(예정): `src/processors.ts`, `src/cost.ts`, `src/carbon.ts`, `src/report.ts`, `src/app.ts`, `tests/processors.test.ts`, `tests/comparison.test.ts`, `tests/report.test.ts`.
작은 앱은 기존 설계의 입력/조건부 보고서 표면만 구현한다. 별도 MCP 서버/두 번째 agent 등 새 구조를 추가하지 않는다.

<a id="o1"></a>
### O1 업체 후보 필터

- [x] 윤정준의 검증 가능한 원자료에서 코드·허가·지역·갱신일을 검사한다.
- [x] `ProcessorCandidate`의 허가 evidence ID·조회일·`acceptance`를 보존한다.
- [x] 코드/허가/지역 불일치는 제외하고, 등재 사실과 현재 인수 의사를 구분한다.

<a id="o2"></a>
### O2 단위·경계가 맞는 비용 비교

- [x] `QuoteInput`의 원/kg·원/t·원/회·총액, 물량, VAT, 유효기간을 검증한다.
- [x] 포함 견적의 중복 가산과 처리업체 귀속 판매수입의 임의 차감을 막고 항목별/순비용을 계산한다.
- [x] 참고 시장가격·실제 견적·제도 산정 단가를 분리하고 누락은 `unavailable`로 남긴다.

<a id="o3"></a>
### O3 계수 registry와 탄소 비교

- [x] `FactorRecord`의 사용권·버전·단위·지역·기간·GWP·경계와 `ActivityInput` 연결을 검사한다.
- [x] 운송/전처리/처리/잔재물 총배출, 원료/에너지 크레딧, 순배출을 분리한다. 포함 단계 이중계산을 막는다.
- [x] `baselineRouteId=null`이면 회피량은 `no-baseline`; 승인되지 않은 계수/대체율은 추정해 채우지 않는다.
- [x] 동일 조건의 비용·탄소 비교와 우열 불확실을 표시하고 근거 없는 단일 종합점수/순위를 만들지 않는다.

<a id="o4"></a>
### O4 작은 앱·조건부 보고서 화면·데모 연결 구현

- [x] H1/H4를 호출하는 입력→질문/검토/비교 상태 흐름을 작은 앱에 연결한다.
- [x] 기존 `DecisionResult`의 결론·조건·근거·조회일·가정·누락·approval 상태 렌더링을 구현했다. approval은 기존 DTO 필드이며 반출·계약 승인 결과가 아니다.
- [ ] 추천 모드 연결 후 비교 경로·순위 이유·업체 후보·비용/탄소 라벨과 실행 전 확인 목록을 실제 앱에서 확인한다.
- [x] `ScenarioComparison` 구조를 그대로 읽고 자유 서술 숫자를 다시 계산하지 않는다. 비용/탄소 불가는 정상 상태로 보여준다.
- [ ] Azure 실행 추적/사용량/실패 상태를 비밀값 없이 표시하고 백업 녹화는 live와 구별한다. (2026-11-12 정정: 기본 실행은 구독 runner다. 실행/실패/usage 화면은 구현됐지만 실제 실행 증거 인수가 없어 미체크 유지)

O4는 앱·조건부 보고서 **화면과 데모 연결 코드 구현**을 맡는다. 최종 보고서 작성·영상 초안/백업/최종본 제작·통합 테스트·잠금 평가 실행 및 집계·시연 전 검증은 이태용(팀장, 모지리 지원)이 맡는다. O1–O4 자기 기능 테스트는 오연석의 구현 완료 기준으로 유지한다.

**입력·출력 인터페이스:** `ResourceDomain.findProcessors(CaseInput, RouteAssessment)` → `ProcessorCandidate[]`; `ResourceDomain.compare(ComparisonInput, RouteAssessment[])` → `ScenarioComparison[]`. 비교 입력에는 `QuoteInput`, `ActivityInput`, `FactorRecord`, `EvidenceRecord[]`와 명시적 기준선을 전달받는다. O4는 이상협의 `DecisionResult`를 화면/보고서로 표시한다. `needs-information`/`needs-review`도 반드시 렌더링한다.

**완료 기준·테스트·데모:** O1은 부적합 업체 3유형(코드/허가/지역)을 제외하는 테스트가 있다. O2/O3은 같은 case의 두 견적, kg↔t, VAT/유효기간·중복 비용·수입 귀속·단위 불일치·계수 누락·기준선 없음·경계 중복을 검사하고 독립 수계산과 반올림 오차 안에서 일치한다. O4는 실제 앱에서 정상 1건과 정보 부족/위험 1건을 각각 실행하여 출처·조건·보류·계산 불가가 보이는 증거를 남긴다. 데모에서 두 견적/대안의 항목별 비용과 총배출/크레딧/순배출을 보여주되 자료 없으면 불가 이유와 다음 확보 항목을 보여준다.

**의존 관계·인계:** 11/6까지 숫자 없는 상태별 보고서 화면 예시를 이상협과 맞춘다. 11/8까지 필요한 업체/견적/계수 필드를 윤정준에게 전달한다. 11/10까지 O1/O2/O3 함수를 이상협에게 제공하고 정상 1건 연결, 11/11 앱 데모 연결 구현과 실행 방법을 팀장에게 인계한다. 녹화 초안은 팀장이 제작한다. 실제 견적·계수가 늦으면 명시적 불가 상태로 연결하며 임의 예산/감축 숫자를 넣지 않는다.

| 주차 | 마감과 제출물 |
|---|---|
| 11/5–7 | O4 상태별 보고서 화면/앱 흐름, O1 필터 조건, O2/O3 독립 계산 예시 설계 |
| 11/8–11 | O1–O3 계약 연결·단위 검사, 11/10 완주·11/11 첫 앱 데모 연결 구현 인계 |
| 11/12–15 | 비용/탄소 재현·업체 부적합·실패 상태 개선, 18건 개발 검증용 계산/출력 인계 |
| 11/16–20 | 11/20 계수/계산/보고서 화면 코드 동결, 팀장 잠금 평가·백업 녹화용 앱/실행 방법 인계 |

**심사 기여:** 현장 적용성 20점의 업체/실제 견적 조건, 창의성 20점의 비용·탄소 대안 비교, 전달력 20점의 한 보고서/5분 데모, 판단 신뢰성 20점의 계산 재현·미확인 수치 배제에 기여한다.

**막히면:** [비용·탄소 방법과 권리 제약](data-sources.md), [계산 계약](architecture.md), [숫자 없는 비교 형식 예시](../src/comparison.examples.ts), [심사·데모](rubric-and-demo.md), [평가 지표](evaluation.md).

## 공통 작업과 책임자

| 작업 | 실행 담당 / 검토 담당 | 마감·완료 기준 |
|---|---|---|
| 계약/파일 충돌 관리 | 각 모듈 담당 / 이태용 검토 | 11/6 첫 합의, 이후 변경마다 영향 공유. 팀장에게 별도 구현 모듈을 넘기지 않음 |
| 30건 후보 수집 | 윤정준·이상협·오연석 각 10건 / 윤정준 출처·중복 점검 | 11/7 후보/층 구성, 11/10 입력·권리·출처 정리. [30건 층별 구성](evaluation.md)을 합계로 맞추고 공개/합성/현장을 구별 |
| 독립 라벨·18/12 분리 | 각 사례 수집자를 제외한 나머지 두 명이 독립 라벨 / 이태용 불일치 조정·잠금 보관 | 11/10 그룹 단위 개발18/잠금12 분리. 개발자에게 잠금 사례·정답을 튜닝용으로 공개하지 않음 |
| 개발 실험 A/B/C·개선 2회 | 이태용(팀장, 모지리 지원) 실행·감사·집계 / 팀원은 자기 모듈 테스트·자료·계산 근거 인계와 개선 구현 | 11/12–15 같은 18건·같은 조건에서 실행, 실패/원시 건수/버전 기록 |
| 최초 잠금 평가 | 이태용(팀장, 모지리 지원)이 동결 버전/미열람 12건 관리·평가 실행·근거 감사·집계 / 팀원은 모듈 실행 방법·snapshot 인계 | 11/20 구현 동결 후 최초 12건 실행과 결과 보존. 11/21–22 팀장 검토. 11/23–24 동작 수정 시 기존 12건은 회귀 확인일 뿐 새 독립 평가가 아니며, 새 독립 평가는 미열람 사례로만 수행 |
| 정상/위험 통합 QA·시연 전 검증 | 이태용(팀장, 모지리 지원) 실행·인수 / 팀원은 자기 모듈 테스트와 근거·세션·앱 구현 인계 | 11/10 정상 1건, 11/15 위험/누락/Azure 실패, 11/20 동결 증거, 11/23–24 수정 후 회귀·시연 전 검증. 입력·명령/페이지 동작·출력·화면·snapshot·SHA 묶음 |
| Azure 권한·비용 상한·운영진/현장 연락 | 이태용 총괄 / 이상협 연결에 필요한 값 확인 | 11/6 실제 권한/배포 확인, 11/11 피드백 목표. 키 레포/로그 미포함, 허락 없는 외부 연락/과금 금지 |
| 발표 자료·데모·최종 보고서·영상·제출 | 이태용(팀장, 모지리 지원) 발표/스토리/최종 보고서/영상 제작/접수, 윤정준 출처 자료, 이상협 구조/실패 자료, 오연석 앱·화면·데모 연결 구현 인계 | 11/11 초안, 11/20 백업 영상, 11/21–22 팀장 검토, 11/23 시연 영상 최종본·최종 보고서/자료 마감, 11/23–24 수정·리허설, 11/25 확정 시각 전 접수 확인 |

발표는 [15분 발표 + 질의 7분](rubric-and-demo.md), 현재 데모 목표는 비교·추천3분+차단·확인 목록2분이다. 현장 검증 미확보와 실제 견적·계수 현장 적용 미확인을 표시하며 공개·합성 계산과 구분한다. 제출 시각은 미확정으로 남긴다. 범위 축소 시 수지/지역과 현장 UX 한계를 공개한다.

## 각자 작업을 닫기 전

- [ ] 맡은 ID의 코드·관련 테스트와 공통 typecheck/build/smoke가 통과한다.
- [ ] 실제 앱/도구에서 수용 기준을 실행하고 입력·출력·출처/버전·SHA·화면/로그를 이슈에 남긴다.
- [ ] 누락/실패·보류와 아직 검증하지 않은 부분을 표시한다. 테스트 통과를 법적 적합성/현장 성능으로 바꾸어 말하지 않는다.
- [ ] 의존 상대에게 계약 형태로 인계하고 팀장에게 검토를 요청한다. 임시 서버/세션/비밀값을 남기지 않는다.
