# 공개 출처와 최소 개발 패키지 (#52/#54)

## 2026-11-15 현재 활용 기준

아래 패키지 수량·검증·계산 불가·권한은 당시 사실로 보존한다. [추천 목표](recommendation-goal.md)에 따라 공개·합성 package로 비교·추천을 진행하며 현장 자료 대기를 완료 조건으로 두지 않는다. 허가/인수·실견적/실측·계수 현장 적용 확인은 실행 전 확인 목록으로 붙인다. 공개 가격을 실견적으로 부르거나 부족한 계수·권리·단위·경계를 만들어 채우지 않는다. 사진 권리와 실제 모델 전송 동의는 별도 경계로 유지한다.

2026-11-15 관찰 기준이다. 기관의 선언, 로컬 바이트 검증, 사용 목적별 승인을 구분한다. PR58의 최초 패키지는 기존 KECO 파일을 재사용했고 당시 신규 원본 데이터 파일이나 이미지 묶음을 반입하지 않았다. 후속 이미지 반영은 아래 별도 절과 개별 manifest를 따른다. PR58의 동결 관측 카탈로그는 [catalog.json](../data/sources/public-2026-11-15/catalog.json)이며 활성 source registry 및 후속 이미지 사용 승인과 분리돼 있다.

| 출처·발행자 | 공표 모집단·시점 | 권리·접근·반입 상태와 남은 의존성 |
| --- | --- | --- |
| [KECO 가격](https://www.data.go.kr/data/3076421/fileData.do), 한국환경공단 | 26품목 중 플라스틱17 × 8권역. 조사 2026-10-10, 공표 2026-10-26 | `공공저작물 : 출처표시 (제 1유형)`. 출처표시 하 상업·비상업 이용과 변형 가능. 파일은 로그인 없이, API는 가입·신청 안내. 기존 바이트만 재사용; VAT·물류 미검증 |
| [폐기물 통계3070174](https://www.data.go.kr/data/3070174/fileData.do), 한국환경공단 | `_20241231`, 등록2019-09-20·수정2026-03-19. 메타데이터 전체 행1은 통계 표/사례 수 아님 | `이용허락범위 제한 없음`과 `데이터의 임의 변경 및 수정은 불가`를 함께 보존. 추출·정규화의 허용 범위 미해결. 공개 PDF 안내만 확인; 원본·표·단위·주석 미검사 |
| [법령 공동활용](https://open.law.go.kr/LSO/information/guide.do), 법제처 | 서비스 안내이며 새 법령 수집0. 적용 기간 미확인 | 영리 활용 일반 허용과 API별 상업 제한을 구분. 회원가입·신청·승인 필요. 법제처 출처표시·위변조 금지. 원문 법령, 포털 편집물, API 조건, 현행성·사례 적용성은 별개 |
| [KICOX15105482](https://www.data.go.kr/data/15105482/fileData.do), 한국산업단지공단 | `_20251231`, 등록·수정2026-09-23. 전체 행1은 공장 수 아님 | `이용허락범위 제한 없음`. CSV 링크 공개; 원본·행 수·식별자 제거·고유 공장 수 미검증. 연간 갱신과 월말 출력 설명 확인 필요. 등재는 폐기물 허가/인수 근거가 아님 |
| [GIR current86](https://www.gir.go.kr/home/board/read.do?boardId=86&boardMasterId=2&menuId=36), 온실가스종합정보센터 | 2025년 승인 계수, 게시2025-12-18. PDF387,652바이트·HWPX86,067바이트는 계수 수 아님 | [menu43 저작권 정책](https://www.gir.go.kr/home/index.do?menuId=43)은 KOGL1 표시 확인 또는 사전 협의를 요구. 게시물별 표시 미검증. 개별 단위·GWP·경계·기간 검증 전 계수 반입 금지; 정책도 함께 링크 |
| [KEITI LCI](https://www.keiti.re.kr/site/keiti/02/10202100000002023101610.jsp), 한국환경산업기술원 | 사업 설명; 개별 레코드·유효기간·계수 수 미확보 | `한국 LCI DB와 평가계수는 상업용 목적으로 사용할 수 없습니다.` 상세는 에코스퀘어 연계. 상업 서비스 등록 금지; 비상업 파생 범위·접근 조건도 확인 필요 |
| [RealWaste](https://archive.ics.uci.edu/dataset/908/realwaste), UCI·Single/Iranmanesh/Raad | 기증2023-10-17; 공표4,752 instances·9분류·Plastic921·524×524. 게시처 원문의 filesInfo 4,753개 객체는 JPEG 파일명4,752개와 README.md 1개로 조정됨. 분류별 파일명 수도 공표 수량과 일치 | **권리 선언 충돌:** UCI는 `CC BY 4.0`, [저자 저장소 README](https://github.com/sam-single/realwaste/blob/main/README.md)는 `CC BY-NC-SA 4.0`을 명시한다. 동일 자료의 상업 이용·변형 배포 조건을 확정하지 않고 해소 전 반입 보류. 파일목록 조정은 권리 해소나 이미지 내용 검증이 아님; 사진 반입0 |
| [AIHub71362](https://aihub.or.kr/aihubdata/data/view.do?dataSetSn=71362), NIA·주관㈜뉴컨 | 2022 구축, v1.1 2023-11-24. 메타100만 vs 상세706,101+299,764=1,005,865. 라벨1,005,865. 표시2.30TB와 상세약2,700+170+6GB 미조정 | [확장 이용정책](https://aihub.or.kr/intrcn/guid/usagepolicy.do): 영리·비영리 연구개발 가능하나 학습용 한정. NIA 사업결과 표시를 2차 저작물에도 적용. 무단 제3자 열람/제공/양도/대여/판매 금지. 데이터 판매 등 상업 이용 별도 협의. 국외 이용자·반출 별도 합의. 본인확인·목적 신청 및 내국인 안내; 개인정보 발견 신고·삭제, 재식별 금지, 실태조사 협조. 현재 메타데이터만 반입 |
| [TACO](https://github.com/pedropro/TACO), Proença·Simões | 현재 이미지 총량 미확인. 2019년 추가785이미지·2,642분할은 현재 총량 아님 | MIT 표시는 저장소에서 관찰. 전체 이미지 라이선스로 확대 불가. HF 카드가 인용한 TACO 조건은 annotation CC BY4.0, 이미지는 원 URL/개별 라이선스(누락 시 CC BY4.0 기본값 선언). 원문·각 이미지 재확인 필요. original/VGA는 같은 이미지 변형 |
| [ExtendedTACO-reviewed](https://huggingface.co/datasets/roboticslaburjc/ExtendedTACO-reviewed), roboticslaburjc | viewer25.2k TEXT rows vs 카드 `1K<n<10K`; 실제 이미지 수 미확인. 약600장 삭제는 카드 주장 | 카드 `cc-by-4.0`과 이미지별 TACO 조건 유지. [카드 원문](https://huggingface.co/datasets/roboticslaburjc/ExtendedTACO-reviewed/raw/main/README.md). 권리·중복·개인정보 검토 전 반입 보류; TACO와 독립 cohort로 합산 금지 |
| [Kaggle mostafaabla](https://www.kaggle.com/api/v1/datasets/list?search=garbage-classification&user=mostafaabla), mostafaabla | `Garbage Classification (12 classes)`, v1·갱신2021-01-24. 메타250,641,573바이트. 실제 이미지 수 미확인 | 정확한 선언 `Database: Open Database, Contents: © Original Authors`. 데이터베이스와 이미지 권리 분리. 공식 anonymous metadata API만 관찰; `files:[]`는 이미지0 근거 아님. 다운로드 인증·DB 전문·개별 저작권 미확인 |

잘못된 후보 URL도 카탈로그에 남겼다. KICOX 후보15272362는 페이지 미발견(HTTP 상태 미기록), 15050671은 기상청 반응가스 자료다. AIHub645는 야생동물 영상이다. GIR8651은 오류 화면이며 current86으로 대체 조사했다. KOGL 일반 안내의 첫 화면은 제0유형이어서 제1유형 탭과 [정식 일반증서](https://www.kogl.or.kr/info/licenseType1.do)를 추가 확인했다. 공유·변경·영리 이용은 출처표시 조건이며 기관의 후원을 뜻하지 않는다. 배지나 URL만으로 출처를 판정하지 않았다. 포털 Quick/AI Summary의 효율·사업효과 주장은 검증된 분석으로 채택하지 않았다.

RealWaste의 수량 차이는 처음 ZIP 범위 요청과 화면 일부 목록으로는 해결하지 못했다. 이후 게시처의 완전한 HTML 원문에 포함된 filesInfo를 파싱해 JPEG 파일명 4,752개와 `realwaste-main/README.md` 1개를 확인했고, 9개 분류의 파일명 수가 게시 수량과 일치함을 계산했다. 원문 해시와 처리 범위는 카탈로그에 기록했다. 이는 파일목록 메타데이터 조정이며 실제 archive·JPEG bytes, 이미지 고유성·디코딩·개인정보 검증은 아니다. 사진 반입은 계속 보류한다.

후속 원본 접근 조사에서 저자 README의 비상업·동일조건변경허락 선언을 확인했다. PR58의 UCI 관측 발췌를 저자 측 조건까지 확인한 승인으로 확대하지 않는다. 실제 샘플은 이 충돌 자료 대신 파일별 CC0 선언을 확인한 공개 사진에서 선택했다.

## 후속 공개 이미지 소량

[공개 이미지 묶음](../data/o-public-images/2026-11-15/README.md)은 파일별 CC0 선언과 공식 CC0 법률 문구를 대조한 3개 PNG 파생본이다. 사람이 보이거나 문자·회사명이 포함된 후보는 제외하고 필요한 영역만 crop했으며 기존 sanitizer로 메타데이터를 제거했다. 원본 전체·공식 축소 입력·crop 파생본의 경로와 해시를 구분하고, 취득하지 않은 고해상도 원본의 해시는 null로 둔다. 게시자의 날짜는 촬영 사실을 독립 검증한 날짜가 아니다.

이 3개는 노출된 개발 사진이며 독립 현장 사례·사람 라벨·미노출 holdout이 아니다. 띠 조각 사진은 기존 H006과 같은 출처이므로 새 독립 표본으로 합산하지 않는다. 저작권상 재사용 가능성과 실제 운영자·모델 전송 승인은 별개이며 후자는 획득했다고 쓰지 않는다. 입력/lineage/권리·J/H 인계와 실제 앱 검증 범위는 해당 묶음의 manifest·README·qa를 따른다.

## 2026-11-17 과거 실행 메타데이터 수신

H의 #56 댓글6927541141에 담긴 14사례·28요청 기록을 [별도 비공개 연구 패키지](o-historical-execution-handoff.md)로 수신한다. 기존 공개 사진 3장이나 독립 평가 모집단에 합산하지 않는다. 사진 원본·워크북·패치 바이트를 추가 반입하지 않았으며 SHA 선언의 일관성 검사와 실제 원본 바이트 검증을 구분한다.

이 수신은 사진·모델 실행·공개/재배포 권리를 새로 승인하지 않는다. 원본 JSON·전체 패키지·식별자·영수증은 비공개로 보관하고 상업 export·모델 입력으로 보내지 않는다. 최종 공개 전 #52/#55 재검토, 당시 법령 현행성, 독립 사람 라벨과 원래 실행의 독립 검증은 미확인으로 남긴다.

## 저장 표현과 해시

[source-snapshots.json](../data/sources/public-2026-11-15/source-snapshots.json)과 [license-snapshots.json](../data/sources/public-2026-11-15/license-snapshots.json)은 필요한 부분문자열을 발췌해 편집 순서로 재배열한 텍스트다. 원문 순서·원 HTML·archive·PDF 바이트의 보존본이 아니다. 항목별 관찰 시각·capture anchor·기관/저자·URL·추출/삭제 방법을 기록했다. `sha256`은 각 `text`를 UTF-8로 인코딩한 정확한 바이트(끝 LF 포함)에 적용한다. 전체 JSON 파일의 raw SHA는 lineage에서 별도로 고정한다. 연락처·예제 레코드·제한 이미지·비공개 조사 묶음은 추적 파일에 포함하지 않는다.

AI Hub의 제3자 열람·제공 제한은 지정 기관의 승인을 받지 않은 대상을 조건으로 한다. 승인 주체·대상을 생략한 무조건적 금지로 바꾸지 않았다. 이용정책의 다른 의무는 권리 snapshot의 조항별 locator와 카탈로그를 함께 확인한다. NIA가 권리자가 아닌 자료에는 해당 기관의 정책·절차가 적용된다. KOGL에서 확인한 일반증서는 요약이며 별도로 링크된 전체 이용약관을 읽었다고 주장하지 않는다.

[KECO subset](../data/reference/public-2026-11-15/keco-price-subset.json)은 데이터행3(헤더 포함 CSV4행, preview index3)의 수도권481.3 KRW/kg와 강원 `null/unpublished`만 포함한다. 원본1,730바이트의 SHA-256은 `562bf85c2f9a2047649b52d9875da462fdb2ca14be36e21cfd1950ff976dfeb3`, 취득은 2026-11-05T08:53:59Z 그대로다. 11/15는 미리보기297셀 대조 관찰이며 재다운로드가 아니다. 한국환경공단의 자료명·URL·공공누리1·정규화 변경을 표시했다. reader 결과136개 중 숫자60·null76, 비플라스틱9행 제외, 품질 이슈0이다. 행은 참고가격이며 실제 견적이나 독립 현장 표본이 아니다.

## 재현과 통합 검증

저장소 루트에서 아래 환경을 모든 명령에 유지한다.

```bash
: "${TMPDIR:?별도로 준비한 비공개 실행 디렉터리가 필요합니다}"
export NODE_COMPILE_CACHE="$TMPDIR/node-compile-cache"
export BUN_RUNTIME_TRANSPILER_CACHE_PATH="$TMPDIR/bun-transpiler"
bun scripts/o-public-data.ts verify
bun test --timeout 30000 ./tests/o-public-data.test.ts ./tests/sources.test.ts ./tests/case-record.test.ts ./tests/o-resources.test.ts
bun node_modules/typescript/bin/tsc --noEmit
bun node_modules/typescript/bin/tsc --noEmit -p tsconfig.tests.json
```

명시적 재생성은 `bun scripts/o-public-data.ts prepare`다. 기존 input으로 subset·lineage·artifact만 생성하며 실제 `git rev-parse HEAD`와 생성 시각을 기록한다. 시각이 바뀌므로 artifact 해시도 바뀐다. 카탈로그·발췌는 동결된 조사 자료로 네트워크에서 재수집하지 않는다. 재생성 뒤 `verify`·테스트를 실행하고 qa.json의 이전 검증 기록도 갱신해야 한다.

```bash
bun scripts/o-public-data.ts fixture > "$TMPDIR/o-public-fixture.json"
qa_state=$(bun -e 'console.log(JSON.parse(await Bun.file(process.env.TMPDIR + "/o-public-fixture.json").text()).state)')
qa_resources=$(bun -e 'console.log(JSON.parse(await Bun.file(process.env.TMPDIR + "/o-public-fixture.json").text()).resources)')
qa_artifact=$(bun -e 'console.log(JSON.parse(await Bun.file(process.env.TMPDIR + "/o-public-fixture.json").text()).artifact)')
input_revision=$(bun -e 'console.log(JSON.parse(await Bun.file(process.env.TMPDIR + "/o-public-fixture.json").text()).inputRevision)')
bun scripts/o-artifact.ts check --state-dir "$qa_state" --resources-dir "$qa_resources" --username public-data-dev --case-id PUBLIC-DEV-001 --expected-revision "$input_revision" --artifact "$qa_artifact"
```

fixture는 비공개 임시 디렉터리에 활성 합성 계정 `public-data-dev`/actor `public-data-dev`와 정확한 입력의 사례를 준비한다. 30분 편집 창 안에 check를 실행한다. fixture의 password hash는 로그인 불가용 표시이며 실제 자격증명이 아니다. fixture는 설치·재평가·모델 호출을 하지 않는다. 실제 CLI의 exit0 및 `checked`, actor/case/revision/canonical artifact hash를 확인하고 state와 resources가 바뀌지 않았는지 점검한다. 잘못된 revision·disabled/다른 owner·손상 artifact·누락 state도 통합 검증 대상이다. 출력 임시 경로·DB는 추적하지 않는다.

## J/H 및 #13 인계

다음 표는 PR58 최초 가격 패키지의 반입 수다. 후속 공개 이미지 3개와 그 개발 인계는 위 별도 묶음으로 추적하며, 두 기록을 하나의 독립 평가 집합으로 합산하지 않는다.

PR58의 가격 인계에는 사진 없는 `PUBLIC-DEV-001` 합성 개발 패키지1개가 있다. process/polymer/contamination/massKg/region은 null, hazardousContact는 unknown, photoRefs는 빈 배열이다. 공개 가격 분류는 해당 사례의 재질·공정·지역·질량 증거가 아니다. 허가·인수·견적·검토·계수·독립 계량 자료를 만들지 않았다. `prepareCaseRecord`와 실제 `validateResourceArtifact`를 사용하며 J의 보류·계산 불가를 유지한다. 현재 사례 맥락에서 요청하는 source set은 빈 배열이고 카탈로그 자료를 임의 추가하지 않는다.

`dataOrigin.reference`는 [lineage.json](../data/o-public-development/2026-11-15/lineage.json)의 raw-file SHA를 참조한다. 기존 validator는 이를 해석하지 않으므로 새 verify가 참조·파일·입력 revision을 검사한다. canonical artifact hash, artifact raw-file hash, resources hash, input revision, lineage raw-file hash, 원본 CSV hash는 서로 다른 양이다. 실제 값과 실행 범위는 [qa.json](../data/o-public-development/2026-11-15/qa.json)에 기록한다.

| 인계 지표 | 이번 반입 |
| --- | --- |
| 참고가격 레코드 | 2 |
| 새 독립 현장 사례 / 사람 라벨 / 미노출 holdout / 승인 신규 사진 | 각각0 |
| 새 합성 개발 package | 1 |
| 기존 H10 | 노출된 합성 개발 자료. 기존 manifest에 CC BY-SA 4.0 5건·CC0 4건·CC BY 4.0 1건 기록; 이번 게시처 재검증 아님. operator/model consent0 |
| raw700 | 권리·진위 미검증; 승인 공유 위치 없음; 원본·평가 라벨 미열람 |

데이터셋·cohort·썸네일·파생본을 독립 표본으로 합산하지 않는다. #13 평가·현장 인수와 #42 provider 승인은 외부 의존성으로 남는다. 실제 CLI·전체 저장소 검사·최종 Astra 검토 및 연구 보고서 검증 결과는 qa.json과 PR에서 구분해 보고한다.

표의 0은 이번 패키지에 새로 반입·검증한 수다. 미열람 raw700이나 원래 사진 집합에 현장 사례·라벨이 전혀 없다고 단정하는 수치가 아니다.
