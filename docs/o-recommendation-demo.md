# 오연석 사례 패키지와 추천 데모 인계

#54의 사례 패키지와 J/H 인계를 #12의 같은 인증 앱·보고서에 연결한다. 제품은 처리 경로의 비교·추천을 지원한다. 실행·반출·계약·현장 승인을 발급하지 않는다.

## 자료와 출력의 경계

- `OYS-20261110-001` PET, `002` HDPE, `003` PP는 기존 합성 개발 사례다. 평가일은 원본의 `2026-11-10`, 법령 시행본은 사례에 연결된 `lsiSeq=290881`이다.
- PET 24 kg, HDPE 18 kg은 합성 전제다. PP 질량은 `null`로 보존한다. 관측·실측·담당자 확인으로 바꾸지 않는다.
- 모든 연구 결과의 표시 문구는 **공개 자료 기반 계산값(관측값 아님)**이다. 화면은 서버가 저장한 계산 표시값과 누락 이유를 보여준다. 브라우저가 다시 계산하지 않는다.
- WARM/Wonju의 상업 이용·재배포 권리는 미확인이다. 이 값은 인증된 비공개 연구 화면에만 포함하며 상업용 보고서와 계산 CLI의 상업 export에서 제외한다. 원본 PDF/HTML을 이 변경에 추가하지 않는다.
- GIR의 범위 적합성 검토, WARM 국가·기간·GWP·순 전과정·운송 경계, 가정의 `source_id:null` 및 이유는 기존 계산 manifest/fixture와 첨부에 보존한다. KEITI 국가 LCI를 사용하지 않는다.
- 업체는 정제된 공개 명부의 행 25–32다. 중복 업체 행을 합치거나 시설 수로 해석하지 않는다. 수거 명부와 권역이 명시적으로 다른 행은 후보에서 제외한다. 명부 기준일은 업체별 등록·갱신일이나 현행 허가 검증일이 아니다.
- 허가, 인수 의사, 실제 견적, 실측 질량·거리, 계수의 현장 적합성은 실행 전 확인 사항이다. 위험·명백한 금지·잘못된 출처·모순은 계속 차단한다.

원문·단위·시점·권리는 `data/o-public-calculations/2026-11-15/`와 `data/reference/README.md`를 함께 읽는다.

## 로컬 준비

저장소 루트에서 Bun 1.4.2와 잠금 의존성을 사용한다. 실행 상태와 연구 패키지는 비공개 디렉터리에 둔다.

```bash
RUN_TMP=$(mktemp -d)
export TMPDIR="$RUN_TMP"
export NODE_COMPILE_CACHE="$RUN_TMP/node-compile-cache"
export BUN_RUNTIME_TRANSPILER_CACHE_PATH="$RUN_TMP/bun-transpiler"
export BUN_INSTALL_CACHE_DIR="$RUN_TMP/bun-install-cache"
export RESOURCE_STATE_DIR="$RUN_TMP/state"
export RESOURCE_RESOURCES_DIR="$RUN_TMP/resources"
mkdir -m 700 "$RESOURCE_RESOURCES_DIR"
umask 077
bun install --frozen-lockfile

# 비밀번호를 argv·로그에 넣지 않고 운영자가 직접 입력한다.
read -rs -p "로컬 QA 비밀번호: " QA_SECRET
printf '\n'
printf '%s\n' "$QA_SECRET" |
  bun scripts/o-account.ts create --state-dir "$RESOURCE_STATE_DIR" \
    --username demo-operator --stdin-secret
unset QA_SECRET

RESOURCE_MODEL_RUNNER=local RESOURCE_APP_AUTH=local-operator \
RESOURCE_PRIVATE_PHOTOS=on PORT=4842 bun scripts/app.ts
```

로컬 모드는 외부 모델을 실행하지 않는다. 로그인은 자료의 진위·소속·법적 승인을 인증하지 않는다. 사진 저장 동의와 모델 전송 동의·권한은 별개이며 이 데모는 사진이나 모델 실행을 꾸며 넣지 않는다.

## 정확한 사례에 패키지 연결

1. 로그인한 앱에서 기존 candidate JSON의 필드를 그대로 입력한다. JSON의 기존 `caseId`를 사용자 입력으로 제출하지 않는다. 서버가 실제 ID를 발급한다. 사진 없는 원본은 `photoRefs:[]`다.
2. 결과 화면의 **정확한 입력 내보내기**로 실제 `CaseInput`을 비공개 파일에 저장한다. 표시용 설명이나 질량을 임의로 축약·보충하면 원본 일치 검증이 거부한다.
3. 실제 URL의 ID와 내보낸 입력으로 revision을 구한다. 아래 `INPUT`은 다운로드한 파일의 실제 경로다.

```bash
INPUT="$RUN_TMP/input.json"
CASE_ID='서버가 발급한 실제 사례 ID'
SOURCE_CASE='OYS-20261110-001'
REVISION=$(INPUT="$INPUT" bun -e \
  'import {revision} from "./src/o-validation.ts"; console.log(revision(await Bun.file(process.env.INPUT).json()))')

bun scripts/o-case-package.ts prepare \
  --state-dir "$RESOURCE_STATE_DIR" --username demo-operator \
  --case-id "$CASE_ID" --expected-revision "$REVISION" \
  --source-case "$SOURCE_CASE" > "$RUN_TMP/artifact.json"

bun scripts/o-artifact.ts check \
  --state-dir "$RESOURCE_STATE_DIR" --resources-dir "$RESOURCE_RESOURCES_DIR" \
  --username demo-operator --case-id "$CASE_ID" \
  --expected-revision "$REVISION" --artifact "$RUN_TMP/artifact.json"

bun scripts/o-artifact.ts install \
  --state-dir "$RESOURCE_STATE_DIR" --resources-dir "$RESOURCE_RESOURCES_DIR" \
  --username demo-operator --case-id "$CASE_ID" \
  --expected-revision "$REVISION" --artifact "$RUN_TMP/artifact.json"
```

위 예시의 사례 ID는 실제 발급값으로 교체한다. HDPE/PP는 해당 원본과 source case ID를 함께 바꾼다. 권한·actor·case·revision·원본·해시·권리·계보가 맞지 않으면 패키지를 억지로 수정하거나 우회하지 않는다.

설치만으로 저장 보고서가 달라지지 않는다. 같은 사례의 **자료 반영해 다시 평가하기**를 명시적으로 눌렀을 때에만 성공한 버전과 연구 첨부가 함께 저장된다. 질량 미상은 계속 공란이며 `0`으로 채우지 않는다. 변경 없는 `{}` JSON 재평가도 기존 계약대로 허용한다. 배열·보호 필드·잘못된 단위·오래된 버전은 거부한다.

J/H 인계는 별도로 생성한다.

```bash
bun scripts/o-case-package.ts handoff \
  --state-dir "$RESOURCE_STATE_DIR" --username demo-operator \
  --case-id "$CASE_ID" --expected-revision "$REVISION" \
  --artifact "$RUN_TMP/artifact.json" > "$RUN_TMP/jh-handoff.json"
```

J에는 원본 입력·평가일·법령·출처·권리·전제·정제 계보·구현 해시가 들어간다. H에는 현재 저장 버전과 실제 저장·선택·만료·철회·정리 상태가 들어간다. 인계 파일 자체는 설치나 평가 성공 영수증이 아니다. 실제 저장 보고서의 아티팩트 SHA와 인계 SHA를 대조한다. `modelExecution:null`, `photoExecution:null`은 수행 미확인이다. 허가·동의·기술 실행 권한으로 승격하지 않는다.

## 발표 흐름과 시간

운영자 준비·로그인·패키지 검사는 발표 전에 마친다. 입력 화면은 준비한 사례의 **답변·사례 수정** 영역에서 시작한다. 합성 자료라는 표시를 유지한다.

정상 3분:

1. 0–30초: 원본 입력과 kg·평가일을 보여주고 합성 전제·로컬 모드임을 설명한다.
2. 30–90초: **자료 반영해 다시 평가하기**를 누른다. 추천 1순위와 낮은 확신도, 연구 계산·업체 문의 후보의 한계를 설명한다.
3. 90–140초: **근거 확인하기**에서 법령 위치·시행본·원문 링크를 보여준다. PDF는 발행 서버가 첨부 다운로드로 보낼 수 있으므로 표시한 쪽수도 함께 확인한다.
4. 140–180초: **실행 전 확인하기**에서 허가·인수·실측·견적·현장 승인 항목으로 마친다.

보류 2분:

1. 0–30초: 별도로 만든 합성 위험 사례의 입력을 확인한다. 위험 표시를 안전한 값으로 바꾸어 추천을 만들지 않는다.
2. 30–70초: 재평가 후 **검토 필요 · 실행 보류**와 실제 보류 이유를 보여준다.
3. 70–120초: **실행 전 확인하기**와 **입력 다시 확인하기**의 다음 행동을 설명한다. 허가나 인간 검토가 끝났다고 말하지 않는다.

자동 브라우저 QA에서 사전 준비한 입력 이후 정상 3동작은 약 3.02초, 보류 2동작은 약 1.84초였다. 이는 사람이 설명·읽기·준비하는 시간의 측정값이 아니다. 새 사례 제출부터 시작하는 흐름은 제출→명시 재평가→근거→확인 목록의 4동작이며 중간 CLI 준비는 사용자 탐색 동작 수와 구분한다.

PP 질문 상태에서는 **답변 입력하기**가 질량 공란을 첫 입력으로 연결한다. 수치는 **자료 없음: 질량 미확보**로 남고, 에너지 회수 비용에는 처리비 미확보도 설명한다.

## live·합성·백업과 provider 지원 범위

- **현재 로컬 데모:** 합성 입력과 공개 근거·연구 계산을 실제 앱에서 처리한다. 외부 LLM 성공·실제 현장 성과·실제 provider usage는 주장하지 않는다.
- **연결된 provider 성공:** 기존 실행기는 실제 응답 ID가 있으면 provider 추적 ID를 사용하고, 없으면 `senpi:` 세션 ID를 구분해 사용한다. SDK 세션 통계를 usage로 기록한다. 세션 통계를 청구 확정액이나 절감 실적으로 부르지 않는다.
- **provider 실패:** 인증·속도 제한·provider·취소 등 기존 실패 분류와 이전 저장 결과 복구를 유지한다. 실패를 새 성공·숫자 usage로 바꾸지 않는다. 운영 모드의 권한·쿼터·감사·미확정 usage 조정은 기존 별도 운영 설정의 통제다.
- **실제 SDK 계약 QA:** 실제 직렬화에 합성 자격 증명과 주입된 401 전송만 사용했다. 초기 요청에 연구 첨부·WARM/Wonju·연구 결과 필드가 없었고 요청은 1회였다. 이는 실제 provider 실행이나 전체 다중 턴 성공 검증이 아니다. usage는 `null`이다.
- **백업:** 미리 저장한 HTML/화면은 녹화·저장된 합성 예시라고 표시한다. live API 성공으로 소개하지 않는다. 상업용 보고서에는 연구 값을 섞지 않는다.

이 데모를 위해 유료 호출이나 모델 동의·실행 권한을 새로 발급할 필요는 없다. 실제 provider 실행은 별도 승인·설정·권한·예산이 갖춰졌을 때만 기존 경로를 따른다.

## 화면·회귀 증거와 남은 책임

추천·질문·보류 × 1440/390 × 밝음/어두움 12개 실제 화면에서 상태·실제 크기·연구 행 수·넘침을 확인했다. 탐지 결과는 모두 0건이었다. 별도 QA는 44px 대상, 본문 대비 4.5:1 이상, 키보드 본문 건너뛰기, 동작 줄이기, 처리 중·중복 제출·오류 복구·`null≠0`을 다룬다.

재현 명령은 `bun run typecheck`, `bun run typecheck:o-tests`, `bun test --timeout 30000 ./tests`, `bun run build`, `bun run build:app`, `RESOURCE_MODEL_RUNNER=local bun run smoke`다. 연구 계산 검증은 `bun scripts/o-public-calculations.ts validate --dataset data/o-public-calculations/2026-11-15 --root "$PWD"`를 사용한다.

확인된 기존 제약: 기준 커밋의 개발 평가 스크립트는 이름 있는 Git worktree의 공통 refs를 찾지 못해 평가 테스트 4개가 실패한다. 같은 기준 코드에서 별도 재현했다. 새 입력 UI 회귀와 구분하며 평가 결과를 조작하거나 테스트를 제외하지 않는다.

통합·잠금 평가와 최종 영상·보고서 제작은 팀장 책임이다. 이 작업은 raw700·잠금 정답을 열지 않는다. 작업별 명령 출력·화면·출처 대조·산술·권한 실패·복구 기록은 검토용 비공개 `.omo/o-demo-20261116/`에 보존한다.
