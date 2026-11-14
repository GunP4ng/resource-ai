# #13 평가 후보 인벤토리 (2026-11-14)

이 clone에서 확인한 실행 가능한 노출 개발 후보는 **H 10 + O 10 = 20건**이다. 그중 18건을 `data/evaluation/development.json`에 고정했다. 독립 사람 정답은 0건이며, 미노출 적격 후보는 0건이다. 이 파일은 잠금 평가셋이나 현장 성능 증거가 아니다.

## 확인 범위와 후보 수

README, docs/evaluation.md, docs/team-tasks.md:303-304, 아래 원본 매니페스트와 J 인계/재현 입력을 읽었다. `gh issue view 42 --repo GunP4ng/resource-ai --json number,title,body,comments`를 실행해 exit 0으로 #42 본문과 2026-11-14 H 댓글을 확인했다. #42는 2026-11-13 현재 실제 현장 자료 제공 위치 미확인, 별도 권리·동의·전송·시설/견적/계수 인수가 필요하다고 기록한다. 여기서는 새 법령 현행성이나 법적 적합성을 검증하지 않았다.

| 트랙/자료 | 확인한 후보/행 | 개발 선택 | 미노출 적격 | 출처·현재 한계 |
| --- | ---: | ---: | ---: | --- |
| J (윤정준) | 후보 묶음 0 | 0 | 0 | #42는 공개 출처 기반 J 10건을 언급하지만 이 clone의 data/candidates, data/sources, data/reference/legal 및 J 인계에서 해당 10건의 사례별 경로·권리·그룹 매니페스트를 찾지 못함. 존재 자체를 부정하거나 10건 확보로 계산하지 않음 |
| J 법령 재현 | 8행, 동일 caseId 1개 | 0 | 0 | data/reference/legal/demo-inputs.json, caseOrigin=constructed-reproduction, caseId=j2-j3-reproduction. data/sources/j2-j3-handoff.md가 실제 사업장 사례 아님을 명시. 변형 8개를 독립 후보로 더하지 않음 |
| H (이상협) | 10 | 10 | 0 | data/h-candidates/2026-11-12/manifest.json. 공개 사진을 참고한 합성 입력, 임시 출처 코호트 6개; README와 host 실행/개선 기록에 이미 노출 |
| O (오연석) | 10 | 8 | 0 | data/candidates/oyeonseok-2026-11-10/manifest.json. AI 보조 작성 합성 텍스트, 가상 발생원 10그룹; status가 exposed development를 명시 |
| H ZIP 사진 screening | 30개 메타데이터 항목 | 0 | 0 | data/h-photo-screening/2026-11-13/manifest.json. 재사용 확인 0/30, unknown 30/30, repo 사진 0. CaseInput·권리·독립 라벨·현장 인수 없음. 미노출 잠금 후보로 계산 불가 |

J 공개 출처 레지스트리 data/sources/manifest.json과 근거 검색 후보 data/sources/evidence-candidates.json은 사례 수집 매니페스트가 아니다. J의 별도 10건 묶음 위치와 원본 경로/권리/그룹/노출 이력 인계가 여전히 필요하다. 실제 비식별 현장 사례 확보는 0건으로 보고한다.

## 선택과 그룹

선택은 모델 결과나 정답을 보고 고른 것이 아니라 원본 제안 층과 그룹을 기준으로 한다. HYEOB-20261112-001~010 전체와 OYS-20261110-001~004, 006, 008~010을 사용한다. O005(혼합), O007(오염)은 해당 층을 3건씩 맞추기 위해 제외한 노출 개발 예비 후보다. 이 두 건을 잠금으로 옮기지 않는다.

원본 groupId를 그대로 복사했다. H003~007의 `scrapmanagement-site-and-lot-review-pending` 5건은 전부 개발에 포함한다. 나머지 H001/002/008/009/010은 각 원본 그룹, O는 각 `oys-fiction-NNN` 그룹을 유지한다. 선택 18건은 14그룹(H 6 + O 8), 전체 실행 후보 20건은 16그룹이다. H 그룹은 사업장/lot 교차 확인 전 보수적 코호트이고 O의 별도 가상 발생원도 sourceGroupReview 미완료다. 같은 사진·사업장·lot의 새 변형이 발견되면 기존 노출 그룹에 합쳐 개발로 유지한다. 새 잠금 후보는 이 16개 그룹 및 J 재현 원형과의 중복도 별도 확인해야 한다.

## 층별 18/12 제안과 정확한 부족분

아래 층은 수집자 제안 분류이며 독립 정답이 아니다. JSON stratum은 원본 문자열 그대로이며 문서의 집계에서만 H/O 이름을 대응시켰다.

| 평가계획 층 | 30 목표 | 전체 노출 후보 | 선택 개발 | 제안 잠금(아직 없음) | 전체 20 기준 수량 부족 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 깨끗한 단일 수지 | 8 | 6 | 6 | 2 | 2 |
| 혼합·다층·검은색·라벨 불일치 | 5 | 4 | 3 | 2 | 1 |
| 오염·유해 접촉·성상 불명 | 5 | 4 | 3 | 2 | 1 |
| 재사용·재활용 비교 | 4 | 2 | 2 | 2 | 2 |
| 업체 허가/코드/지역 부적합 | 3 | 1 | 1 | 2 | 2 |
| 가격/계수/문서/단위 근거 누락 | 3 | 2 | 2 | 1 | 1 |
| 자료 속 실행 지시 | 2 | 1 | 1 | 1 | 1 |
| 합계 | 30 | 20 | 18 | 12 | 10 |

따라서 단순 후보 수 부족은 10건이지만 **18 개발 + 미노출 12건을 달성하려면 새 미노출 적격 12건 전부가 필요**하다. 제안 층별 신규 수는 2/2/2/2/2/1/1이다. 이 경우 기존 20 + 새 12 = 32건 중 노출 예비 2건을 제외한 30건을 구성한다. 그룹은 쪼개지 않으므로 신규 그룹 구조에 따라 이 제안을 재조정하고 버전·사유를 기록한다. 잠금 ID·입력·정답은 이 공개 개발 묶음에 기록하지 않고 이태용이 별도 보관한다.

층 대응: clean-single-resin은 공통이다. 혼합은 H mixed-or-label-conflict / O mixed-multilayer-black-label-mismatch, 오염은 H contamination-or-hazard-unknown / O contamination-hazardous-contact-unknown-condition, 비교는 H reuse-or-recycling-comparison / O reuse-recycling-comparison, 누락은 H missing-evidence-or-unit / O missing-price-factor-document-unit-basis다. 업체와 실행 지시는 H processor-mismatch / embedded-instruction이다.

이 수량이 기능 커버리지를 증명하지는 않는다. H006 업체 조건은 supplementScenario에만 있고 런타임 CaseInput에 실제 업체·허가 자료가 없다. H007/O009에는 견적·계수·동일 기능단위 비교 근거가 없다. H010은 텍스트 description 속 지시로서 사진/문서 공격 실행 전체를 검증하지 않는다. O 10건은 photos/evidence 모두 미확보다. 현행 법령·시설 허가·실제 질량·견적·계수, 유용한 정상 응답과 안전 보류를 판별할 독립 정답은 별도로 필요하다. 입력 파싱 성공은 처리 적합성 증명이 아니다.

기존 검토 상태도 확인했다. data/o-reviews/h-candidates-2026-11-13/human-review.json의 10건 모두 ownLabels/ownJudgment/ownEvidence/reviewerIdentity/acceptance/split이 null이다. 같은 폴더 README는 AI-assisted preliminary이며 인간 라벨 완료가 아님을 명시한다. H peer-review.json은 O 후보 10건에 대한 AI-assisted preliminary H review와 로컬 실행 관측이고 peerSourceCommit=2777dfe193fa72cdb399be4c34dcaa820963fad1, modelCalls=0, 독립 사람 라벨/검토자/자격/배정/채택은 미작성이다. 이름이 peer-review여도 독립 인간 정답으로 세지 않는다.

## 권리와 노출 경계

H 입력의 공정·수지·오염·유해 접촉·질량·지역은 manifest.fieldProvenance의 synthetic-assumption 또는 unknown이다. 평가일은 evaluation-configuration이며 사진 촬영일이 아니다. 국내 제조업 현장 사실을 사진 제목에서 추론하지 않는다. H 사진 선언은 CC BY-SA 4.0 5장(001/002/004/008/010), CC0 4장(003/005/006/007), CC BY 4.0 1장(009)이며 원본 manifest의 저작자·출처·licenseConditions·변경/원본-파생 SHA·snapshot을 보존한다. 이 인벤토리는 사진을 복사하거나 전달하지 않는다. 기존 사진을 재배포할 때도 표시/동일조건 등 원본 조건 검토가 필요하다. modelTransmissionApproval=false, operatorConsent=false를 사용 승인으로 바꾸지 않는다.

O rightsStatus는 `New authored text; external rights not applicable. No legal license granted on the user's behalf.`이고 license=null이다. 합성 텍스트를 실제 현장이나 새 라이선스 부여로 표현하지 않는다. H 공개 사진 라이선스 선언은 ZIP 사진 30개/전체 700개에 적용되지 않는다. ZIP 재사용·보관·배포·모델 전송 권리는 미확인이다.

모든 선택 입력은 photoRefs=[]인 기존 텍스트 JSON이다. 이미지 경로/바이트, 정답, 수집자의 evaluationIntent·proposedReviewQuestions, 예비 AI 검토 및 기존 실행 출력은 모델 런타임 입력으로 넣지 않는다. 런타임은 inputRef가 가리키는 CaseInput만 읽고 origin/stratum/groupId/provenance는 감사용으로 분리한다. 라벨러는 다른 라벨·기존 모델 출력·수집자의 기대답을 보기 전에 각자 초안을 작성한다. 이미 노출된 사례에 새 라벨을 붙여도 미노출 상태로 돌아가지 않는다.

## JSON 계약

corpusVersion=development-v1, split=development, cases 배열을 사용한다. cases의 caseId/groupId는 기존 ID/그룹이고 stratum은 원본 제안 문자열이다. 각 split=development, exposure=exposed, origin은 트랙 H/O다. inputRef는 이 매니페스트(data/evaluation/) 기준 상대 경로이며 H는 ../h-candidates/2026-11-12/inputs/<ID>.json, O는 ../candidates/oyeonseok-2026-11-10/<file>.json이다. provenance.manifestPath는 저장소 루트 상대 경로이고 provenance.origin/collector는 원본 표기를 그대로 보존한다. sourceHash는 inputRef가 가리키는 파일 원시 바이트 SHA-256의 소문자 hex 64자다. 사진 해시가 아니다. H는 파일 SHA 필드가 없어 직접 계산 후 manifest.input과 JSON 동등성을 확인하며 O는 manifest.sha256과도 대조한다.

rights={status:eligible, scope:existing-synthetic-text-only, photoTransmission:excluded, licenseGranted:false}다. eligible은 기존 합성 텍스트 개발 입력의 선택 가능성만 뜻하며 사진·현장 자료의 권리 확인이나 외부 모델 승인, 새 라이선스 부여를 뜻하지 않는다. 이 제한된 권리 설명과 provenance를 함께 읽는다. 런타임에는 inputRef의 CaseInput만 전달하고 이 감사 메타데이터와 정답은 프롬프트에 넣지 않는다. 잠금 entries는 없다.

## 실행한 확인과 재현 명령

저장소 루트에서 아래 명령을 사용한다. TMPDIR는 이 작업의 `mktemp -d` 소유 디렉터리만 사용하며 lead의 RUN_TMP는 읽거나 변경하지 않는다. 별도 JS 파일·의존성·테스트·runner 변경은 없다.

```sh
cd /home/gunp4ng/working/resource-eval-20261114/repo
TMPDIR=$(mktemp -d /tmp/resource-inventory.XXXXXXXX)
export TMPDIR
trap 'rmdir "$TMPDIR"' EXIT
bun --version
bun --eval 'import assert from "node:assert/strict";
import { resolve, relative } from "node:path";
import { parseCaseInput } from "./src/input.ts";
const dev = await Bun.file("data/evaluation/development.json").json();
assert.equal(dev.split, "development");
const entries = dev.cases.map(e => ({ ...e, inputPath: relative(process.cwd(), resolve("data/evaluation", e.inputRef)) }));
const hm = await Bun.file("data/h-candidates/2026-11-12/manifest.json").json();
const om = await Bun.file("data/candidates/oyeonseok-2026-11-10/manifest.json").json();
assert.equal(entries.length, 18);
assert.equal(new Set(entries.map(e => e.caseId)).size, 18);
const strata = {};
for (const e of entries) {
  const raw = await Bun.file(e.inputPath).json();
  const parsed = parseCaseInput(raw);
  assert.equal(parsed.ok, true, e.caseId);
  assert.equal(raw.caseId, e.caseId);
  assert.deepEqual(raw.photoRefs, []);
  const hash = new Bun.CryptoHasher("sha256").update(await Bun.file(e.inputPath).bytes()).digest("hex");
  assert.equal(hash, e.sourceHash);
  assert.equal(e.exposure, "exposed");
  assert.equal(e.split, "development");
  assert.deepEqual(e.rights, { status: "eligible", scope: "existing-synthetic-text-only", photoTransmission: "excluded", licenseGranted: false });
  const isH = e.origin === "H";
  assert.ok(isH || e.origin === "O");
  const source = (isH ? hm.entries : om.candidates).find(c => c.candidateId === e.caseId);
  assert.ok(source);
  assert.equal(e.inputPath, isH ? "data/h-candidates/2026-11-12/" + source.inputFile : source.path);
  assert.equal(e.groupId, isH ? source.duplicateGroupId : source.duplicateGroup);
  assert.equal(e.stratum, isH ? source.stratum : source.proposedStratum);
  assert.equal(e.provenance.origin, source.origin);
  assert.equal(e.provenance.collector, source.collector);
  assert.equal(e.provenance.manifestPath, isH ? "data/h-candidates/2026-11-12/manifest.json" : "data/candidates/oyeonseok-2026-11-10/manifest.json");
  if (isH) assert.deepEqual(raw, source.input);
  if (!isH) assert.equal(hash, source.sha256);
  strata[e.stratum] = (strata[e.stratum] ?? 0) + 1;
  console.log("PASS", e.caseId, e.groupId, e.stratum, hash);
}
for (const source of [...hm.entries, ...om.candidates]) {
  const group = source.duplicateGroupId ?? source.duplicateGroup;
  const selectedGroup = entries.some(e => e.groupId === group);
  if (selectedGroup) assert.ok(entries.some(e => e.caseId === source.candidateId));
}
const counts = new Map(entries.map(e => [e.caseId, 0]));
for (const file of ["yun-jeongjun", "lee-sanghyeop", "oh-yeonseok"]) {
  const sheet = await Bun.file("data/evaluation/labels/" + file + ".json").json();
  assert.equal(sheet.corpusVersion, dev.corpusVersion);
  for (const key of ["reviewer", "reviewedAt", "independenceAttestation", "expertise", "scopeOfReview", "priorAIDraftExposure"]) assert.equal(sheet[key], null);
  for (const row of sheet.entries) {
    const entry = entries.find(e => e.caseId === row.caseId);
    assert.ok(entry);
    assert.equal(row.inputPath, entry.inputPath);
    assert.equal(row.sourceHash, entry.sourceHash);
    assert.equal(row.groupId, entry.groupId);
    assert.equal(row.collectorProvenance, entry.provenance.collector);
    assert.equal(row.collector, entry.origin === "H" ? "이상협" : "오연석");
    assert.notEqual(sheet.assignedReviewer, row.collector);
    for (const key of ["referenceAnswer", "allowedPolymerCandidates", "allowedWasteCodeCandidates", "decisionState", "requiredAdditionalInformation", "evidenceToReview", "forbiddenUnsupportedClaims", "comparisonReference", "rightsReview", "sourceGroupReview", "uncertainty", "reviewNotes"]) assert.equal(row[key], null);
    counts.set(row.caseId, counts.get(row.caseId) + 1);
  }
  assert.equal(new Set(sheet.entries.map(e => e.caseId)).size, sheet.entries.length);
  console.log("SHEET", sheet.assignedReviewer, sheet.entries.length, "blank; collector excluded");
}
assert.ok([...counts.values()].every(n => n === 2));
console.log("STRATA", JSON.stringify(strata));
console.log("SUMMARY selected=18 parsed=18 hashes=18 ids/groups/strata/provenance=18 H-inline=10 O-manifest-hash=8 groups=14 split-groups=0 photoRefs=0 blank-assignments=36 reviewers-per-case=2");'
```

확인 결과는 아래 실행 결과를 함께 보고한다. 자동 LSP 진단은 biome 미설치로 실행할 수 없으며, 이를 위해 환경을 변경하지 않는다. JSON 구문/입력 파싱과 실제 매니페스트 대조를 직접 수행한다.

2026-11-14 실제 실행은 앞서 `mktemp -d /tmp/resource-inventory.XXXXXXXX`가 반환한 `/tmp/resource-inventory.OiOqoKKt`를 `export TMPDIR=/tmp/resource-inventory.OiOqoKKt`로 지정하고 위와 동일한 `bun --eval` 본문을 실행했다. `bun --version`은 1.4.4, 검사는 exit code 0이었다. 저장소 README의 기존 검증 환경 1.4.2와 구별하며 재설치하지 않았다. 18개 PASS 행은 caseId/groupId/원본 stratum/원시 파일 SHA-256을 출력했고 모두 일치했다.

```text
SHEET 윤정준 18 blank; collector excluded
SHEET 이상협 8 blank; collector excluded
SHEET 오연석 10 blank; collector excluded
STRATA {"clean-single-resin":6,"mixed-or-label-conflict":2,"contamination-or-hazard-unknown":2,"processor-mismatch":1,"reuse-or-recycling-comparison":1,"missing-evidence-or-unit":1,"embedded-instruction":1,"mixed-multilayer-black-label-mismatch":1,"contamination-hazardous-contact-unknown-condition":1,"reuse-recycling-comparison":1,"missing-price-factor-document-unit-basis":1}
SUMMARY selected=18 parsed=18 hashes=18 ids/groups/strata/provenance=18 H-inline=10 O-manifest-hash=8 groups=14 split-groups=0 photoRefs=0 blank-assignments=36 reviewers-per-case=2
```

추가 원본 JSON 확인 결과: 기존 human-review 10/10의 인간 작성 필드는 모두 null이고 H peer-review 10/10의 independentHumanLabel/humanReviewer/qualification/split/acceptance도 null이었다. 권리·누출 문구를 검토해 텍스트 한정 선택, 사진 전송 제외, AI 예비 검토와 인간 정답 구별, J 묶음 부재, 미노출 적격 0/12 및 신규 12건 필요를 명시했다. 사진 전송·모델 호출은 수행하지 않았다. 입력·매니페스트·runner·tests는 변경하지 않았다.
