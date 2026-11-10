# 2026-11-10 J2/J3 검토용 증거 묶음

공식 원문을 실제 재조회하고 선택 조항·PDF 행을 독립 대조한 **저장소 검토용 인계 자료**다. 현장 사례나 승인된 `/facts` 설치 패키지가 아니다.

- `official-retrievals.json`: 실제 HTTP 11건의 시각, URL, 상태, 응답 헤더(쿠키 제외), 바이트 수, SHA-256 및 현행 링크 대조.
- `selected-text-comparison.json`: 현재 본문/고시와 기존 7개 후보 발췌의 대조 결과 및 시설·품질·확인서 관련 조문.
- `conditional-r3-3-fact.txt`: 네 원문을 함께 읽어야 성립하는 일반적 조건부 연결. 실제 사업장 적용은 needs-review.
- `source-supports.json`: 파생 파일의 별도 ID·SHA, 원문/기존 발췌 ID·경로·SHA·locator, 부분 주장별 지지 관계. 기존 단일 `derivedFrom` 계약을 바꾸지 않는 인계 자료다.
- `qa-inputs.json`, `qa-output.json`, `validation.json`: 구성 입력과 실제 CLI 출력, 검사 결과. 실제 비식별 현장 사례는 0건이다.

## 확인 결과와 운영 경계

현행 한글주소는 폐기물관리법 시행규칙 `lsiSeq=290881`(공포 2026-10-01, 시행 2026-10-02) 및 고시 `admRulSeq=2100000283168`(공포·시행 2026-07-27)을 연결했다. 본문은 별표 PDF 4개의 동일 flSeq를 연결하며 실제 PDF 해시도 기존 manifest와 일치했다. 별표 자체의 개정 표기는 2025-12-30이다. 시행일·별표 개정일·확인일은 서로 다르다.

PDF 선택 5쪽을 PyMuPDF 1.26.7로 추출했고, 별표 4의3 9쪽은 렌더링하여 R-3-3과 두 하위 행의 열 대응을 직접 확인했다. 본문 제4조의2, 제60호 개정문·부칙 및 고시 제3조·부칙도 읽었다. 법적 종료일이나 11/10 이후 현행성을 추정하지 않는다.

기존 `evidence-candidates.json`의 `verifiedThrough=2026-11-05`는 **변경하지 않았다**. 이 묶음은 검토 증거이지 자동 갱신 명령이 아니다. 검토 후 해당 source별 갱신과 H/O 날짜 경계 시나리오를 함께 반영해야 한다. 실제 사업장 자료가 없다는 사실과 선택 원문의 현행 연결 확인은 별개이며, 전자가 후자를 부정하지 않고 후자가 전자를 충족하지 않는다.

선행 대조에서는 고시 공포일 `prmlYd`와 시행일 `efYd`를 구분하고 표제·부칙 및 현행 본문의 PDF 연결을 확인했다. 이번 게시에는 기존 미커밋 재확인 코드를 복사하거나 실행하지 않았다.

## 권리와 재사용

기존 manifest의 법령·별표 텍스트는 저작권법 제7조 제1호, 국가 고시 텍스트는 제2호 범위라는 기록을 이어받는다. 이번 묶음은 법적 텍스트와 조회 메타데이터만 포함하며 포털 화면·편집물·세션 쿠키는 배포하지 않는다. 해당 권리 기록은 현장 문서·사진·견적의 사용 허가가 아니다. 소유자는 2026-11-10 이 J 증거 인계의 저장소 커밋·업로드를 승인했다. 이 승인은 현장 문서·사진·견적의 사용권이나 사례 적용 승인이 아니다.

## H/O 통합 시 주의

`docs/o-handoff.md`의 다중 원문 제한대로 현재 `evidenceIssue`는 각 source에 전체 fact가 중복되어 있기를 요구한다. `source-supports.json`은 그 제한을 우회하거나 원본 PDF의 SHA를 파생 fact의 SHA로 사용하지 않는다. PR #30 artifact installer(b7ddaaa)와 PR #31 구독 회귀(3ebddd7)는 기준 main에 병합되어 있다. 이 묶음은 installer 입력 형식이 아니며 해당 코드와 공통 계약을 수정하지 않았다.

## 재현

저장소 루트에서:

```sh
bun install --frozen-lockfile --ignore-scripts
bun scripts/legal-demo.ts data/reference/legal/review-2026-11-10/qa-inputs.json
bun test tests/evidence.test.ts tests/legal-registry.test.ts tests/sources.test.ts
bun run typecheck
bun run build
bun run build:app
bun run smoke
```

HTTP 재조회는 `official-retrievals.json`의 `requestedUrl` 각각에 `fetch(url, { signal: AbortSignal.timeout(30000) })`를 실행했다. 시각에 따라 wrapper 해시는 달라질 수 있다. HTTP 200이나 해시 일치만으로 현행성·사업장 적합성을 승인하면 안 된다.

## 게시 검증과 후보 사례 구분

게시 기준 main은 `74c8c3d9a3bae87b560f72e05068f991ca255265`이다. `official-retrievals.json`과 두 comparison 파일은 03:38~03:46 UTC의 선행 조회·대조 기록을 보존한다. 게시 작업에서 새 HTTP 조회나 PDF 화면 검토를 수행했다고 주장하지 않는다. `validation.json`과 `qa-output.json`은 이 기준에서 새로 실행한 게시 검증이며 이전 main의 전체 suite 숫자를 재사용하지 않는다.

열 개 `qa-inputs.json` 입력은 같은 구성 예시의 조건 변형이다. 팀의 10건 후보 수집, 출처/권리/중복 그룹 manifest, 독립 라벨 또는 개발18/잠금12 완료가 아니다. 실제 후보 자료는 미공급이며 [요청 행렬](../../../sources/j2-j3-handoff-2026-11-10.md)에 필요한 필드를 기록한다.
