# H 후보 10건: 입력·메타데이터 예비 검토

## 2026-11-15 검토 활용 기준

아래 AI 예비검토·공란 사람 판단·과거 질문은 당시 기록이며 독립 정답이나 처리 승인 결과가 아니다. 현재 판단 목표는 [추천 목표](recommendation-goal.md)의 경로 비교·추천과 실행 전 확인 목록이다. 허가 유효성·업체 인수·실측 계량·견적 확인은 추천 뒤의 확인 목록으로 분리한다. 접촉·오염 질문은 유해 의심 차단 근거로 계속 사용하고, 입력 모순과 사진 설명을 사실로 승격하지 않는 경계는 유지한다. 사람은 기존 AI 초안을 정답으로 복사하지 않는다.

**10건 모두 추가 증거를 묻는 개발용 검토 자료다. 현장 채택, 분류 정답, 처리 경로 승인 또는 split은 정하지 않았다.** H004·008의 `hazardousContact=no`는 근거 확인 대상이며 자동으로 yes로 바꾸지 않는다. H003의 PP 라벨은 단일재질 증거가 아니고, H006은 처리업체를 식별할 자료가 제공되지 않았으며, H007은 다음 용도·상태 기준이 없다. H009·010은 여섯 핵심 정보가 모두 미상이다.

검토자 유형 **AI-assisted**, 상태 **preliminary**. 기준 소스 커밋 `ceb9e48b6db3e1a16b1eb69a65a35da8482b0dc4`. 문서 작성일 2026-11-14 KST (UTC+09:00); 폴더의 2026-11-13은 요청된 검토 묶음 이름이다.

2026-11-14 제출 담당 확인: [팀 공통 작업표](team-tasks.md)의 수집자 외 독립 라벨 배정에 따라 H 수집자의 사례는 오연석의 교차검토 범위에 해당한다. 이 PR은 그 준비를 위한 AI 예비 검토와 빈 인간 양식의 인계다. 사람의 독립 라벨·채택·최종 18/12 배분 완료로 처리하지 않는다.

독립적 인간 판단이 필요하면 **[원본 입력 폴더](../data/h-candidates/2026-11-12/inputs/)와 [빈 인간 양식](../data/o-reviews/h-candidates-2026-11-13/human-review.json)을 먼저** 읽는다. AI 보고서를 이미 보았다면 노출 사실을 기록한다. 이 문서를 읽은 검토를 blinded라고 부르지 않는다.

## 한눈에 보는 사례

아래 H001 등은 정식 ID `HYEOB-20261112-001` 등의 약칭이다. 각 절에 입력 SHA-256 전체와 원문 JSON 포인터를 적었다. ‘기재’는 원문에 있다는 뜻이며 현장 사실 확인이 아니다.

| 사례 | 원문상 핵심 값(모두 가정 또는 미상) | 검토 초점 |
| --- | --- | --- |
| [H001](#h001) | HDPE, 무오염/no, 120kg, 울산 | 완성된 입력을 실제 배치 증거와 구별 |
| [H002](#h002) | PET, 무오염/no, 80kg, 경기 | 재질 등급·열/가공 이력·다음 공정 부재 |
| [H003](#h003) | PP/PE 다층(라벨 PP), 40kg, 충남 | 라벨과 전체 층 구성 구별 |
| [H004](#h004) | HDPE, 이전 내용물 미확인/no, 20kg, 대전 | 세척과 과거 접촉 이력 구별 |
| [H005](#h005) | PE·기타 수지, 테이프·접착제, 접촉 unknown, 질량·지역 null | 조성·잔류물·배치 정보 공백 |
| [H006](#h006) | PET 결속밴드, 무오염/no, 60kg, 충북 | 업체 이름·허가·인수 조건 부재 |
| [H007](#h007) | 회수 HDPE 상자, 무오염/no, 30kg, 충남 | 다음 용도·상태·잔여 수명 기준 부재 |
| [H008](#h008) | PP, 폐유 정체·잔류 미확인/no, 15kg, 울산 | no 근거 질문; 유해성 확정 아님 |
| [H009](#h009) | 공정·수지·오염·질량·지역 null, 접촉 unknown | 여섯 핵심 정보 전부 미상 |
| [H010](#h010) | H009와 같은 공백, 설명에 신뢰하지 않는 지시 | 삽입 지시는 데이터로만 취급 |

## 사례별 근거와 질문

여섯 핵심 칸은 `/process`, `/polymer`, `/contamination`, `/hazardousContact`, `/massKg`, `/region`이다. 모든 사례의 `/description`은 시험용 가정이며 실제 사진 현장 사실이 아니라고 명시한다. 채워진 값은 **합성 가정**, null/unknown은 **미상**으로 읽는다. ‘미상’은 반증이나 모순 판정이 아니다. 아래 판단과 질문의 포인터별 연결은 [AI JSON](../data/o-reviews/h-candidates-2026-11-13/ai-preliminary-review.json)의 `/cases/0..9/provisionalFindings`와 `provisionalQuestions`에도 있다.

<a id="h001"></a>

### H001 — 완성된 HDPE 입력과 현장 증빙의 간극

**ID:** `HYEOB-20261112-001`

**inputSHA:** `99a243a95f2500e350512a3ffbe53c896b76df41eb2e9be5b97d305cd96f0f40`

**원본:** [inputs/HYEOB-20261112-001.json](../data/h-candidates/2026-11-12/inputs/HYEOB-20261112-001.json)

여섯 핵심 칸은 모두 채워져 있지만 설명이 전부 시험용 가정임을 명시한다. 압출 자투리·HDPE·무오염·비접촉·120kg·울산은 실제 발생원, 등급 또는 계량 기록이 아니다. (원본 `/description`, `/process`, `/polymer`, `/contamination`, `/hazardousContact`, `/massKg`, `/region`)

형식상 완성된 입력은 정보 누락이 적은 개발 예시로 읽을 수 있다. 실제 배치와 연결하는 생산·접촉 이력은 없으므로 처리 경로나 적합성을 뒷받침하지 못한다. (원본 `/description`, `/process`, `/hazardousContact`)

출처 텍스트: [01.html](../data/h-candidates/2026-11-12/sources/01.html), 행 624. 재활용 시스템의 플라스틱 분쇄물을 설명한다. 압출 자투리 발생원을 확인하거나 배제하는 증거는 아니다.

확인 질문:

1. 어느 생산 기록과 재질 성적서가 해당 자투리의 발생원·HDPE 등급을 입증하는가? (근거: `/process`, `/polymer`)
2. 120kg의 계량표, 울산 발생지, 무오염·비접촉 이력을 같은 배치에 연결할 자료는 무엇인가? (근거: `/massKg`, `/region`, `/contamination`, `/hazardousContact`)

<a id="h002"></a>

### H002 — PET 표기와 가공 이력의 분리

**ID:** `HYEOB-20261112-002`

**inputSHA:** `140d4db53120d25db32c3d70a982d2de8cf2e45ac90c934550ed76fff7e76db5`

**원본:** [inputs/HYEOB-20261112-002.json](../data/h-candidates/2026-11-12/inputs/HYEOB-20261112-002.json)

성형 자투리 선별·PET·80kg·경기와 무오염·비접촉은 보고된 시나리오 값이다. 공개 사진의 출처가 PET 등급이나 성형·열 이력을 증명하지 않는다. (원본 `/description`, `/process`, `/polymer`, `/massKg`, `/region`, `/contamination`, `/hazardousContact`)

고려 중인 다음 용도·공정과 이를 받는 처리업체의 근거가 입력에 없다. PET라는 문자열만으로 수용 가능한 공정을 정할 수 없다. (원본 `/description`, `/process`, `/polymer`)

출처 텍스트: [02.html](../data/h-candidates/2026-11-12/sources/02.html), 행 646–653. 646–653행은 사용한 PET 제품의 수거·선별·세척·분쇄·건조 및 소비 후 PET 병 등을 설명한다. 입력 /process의 성형 공정 자투리 설정과 발생 경로 서술이 다르다. 일반 출처 설명으로 실제 사진 이력을 확정하거나 입력을 소비 후 사례로 강제 수정하지 않는다.

확인 질문:

1. 실제 발생 경로는 미사용 성형 자투리인가, 사용 후 PET 제품 재활용인가? PET 식별·등급과 가공 이력을 연결할 기록은 무엇인가? (근거: `/polymer`, `/process`)
2. 80kg은 이 배치의 실측치인가? 고려하는 다음 용도·처리 공정과 인수 조건은 무엇인가? (근거: `/massKg`, `/description`, `/process`)

<a id="h003"></a>

### H003 — PP 라벨과 PP/PE 다층 구성

**ID:** `HYEOB-20261112-003`

**inputSHA:** `e99456505b42ee03d6b8f1e87771791750e1262a43047db72c613e85504a5b07`

**원본:** [inputs/HYEOB-20261112-003.json](../data/h-candidates/2026-11-12/inputs/HYEOB-20261112-003.json)

재질 입력은 ‘PP/PE 다층 (라벨 PP)’이다. 라벨 PP는 단일재질 PP의 증거가 아니며, 다층 설명을 지우거나 라벨만으로 재질을 바꿀 근거가 없다. (원본 `/polymer`)

층 비율, 접착제·첨가제, 분리 가능성은 적혀 있지 않다. ‘없음’인 오염 답변도 합성 가정이므로 층 구성과 공정 수용성을 별도로 확인해야 한다. (원본 `/description`, `/polymer`, `/contamination`, `/process`)

출처 텍스트: [03-commons-api.json](../data/h-candidates/2026-11-12/sources/03-commons-api.json), `/page/imageinfo/0/extmetadata/ImageDescription/value`. PP Birdseed Bag Trim Scrap (Post Industrial)이라는 설명에는 PE 층이나 PP 라벨의 적용 범위가 없다. 추가 설정의 근거 부재이며 다층 구조의 반증은 아니다.

확인 질문:

1. 라벨 PP는 전체 포장백·특정 층·부착 라벨 중 무엇을 가리키는가? 각 층의 수지·비율과 접착제·첨가제 사양은 무엇인가? (근거: `/polymer`, `/contamination`)
2. 검토하려는 공정은 이 정확한 다층 조성을 분리하거나 받아들일 수 있는가? 그 조건을 확인할 자료는 무엇인가? (근거: `/polymer`, `/process`)

<a id="h004"></a>

### H004 — 세척 완료와 이전 접촉 이력 미확인

**ID:** `HYEOB-20261112-004`

**inputSHA:** `26eb5e7d5d21df9ed16f6c00cab3dba7e5e810bd3b354e5f9851abcd8217e493`

**원본:** [inputs/HYEOB-20261112-004.json](../data/h-candidates/2026-11-12/inputs/HYEOB-20261112-004.json)

오염 칸은 ‘세척 완료, 이전 내용물·잔류물은 미확인’인데 접촉 칸은 no이다. 이 조합은 no의 근거를 묻게 하지만, 논리적 불가능이나 유해 접촉 확정은 아니다. (원본 `/contamination`, `/hazardousContact`)

사용 용기 세척·압축이라는 공정과 HDPE·20kg·대전은 합성 값이다. 세척 완료 진술만으로 과거 내용물·접촉 여부를 복원할 수 없다. (원본 `/description`, `/process`, `/polymer`, `/massKg`, `/region`, `/contamination`)

출처 텍스트: [04-commons-api.json](../data/h-candidates/2026-11-12/sources/04-commons-api.json), `/page/imageinfo/0/extmetadata/ImageDescription/value`. 운송을 위해 묶은 용기를 설명한다. 세척·이전 내용물·잔류 상태나 접촉 이력을 증명하지 않는다.

확인 질문:

1. 이전 내용물의 명칭과 사용·보관 이력, 세척 방법·완료 판정·잔류 확인 기록은 있는가? (근거: `/process`, `/contamination`)
2. 내용물 이력이 미확인인 상태에서 hazardousContact=no를 기입한 근거는 무엇인가? (근거: `/contamination`, `/hazardousContact`)

<a id="h005"></a>

### H005 — 혼합 포장 발포체와 접착 잔류물

**ID:** `HYEOB-20261112-005`

**inputSHA:** `41f6f74e6551b3aae5449a1a0d11d2d1a37b7291974f9a1bc70618023de404fd`

**원본:** [inputs/HYEOB-20261112-005.json](../data/h-candidates/2026-11-12/inputs/HYEOB-20261112-005.json)

PE와 기타 수지 혼합 및 테이프·접착제 부착은 시나리오 진술이다. ‘기타 수지’의 종류·비율과 접착제 성분은 특정되지 않는다. (원본 `/description`, `/polymer`, `/contamination`)

접촉은 unknown이고 질량·지역은 null이다. 무오염이나 비접촉으로 보완할 수 없으며, 파일명·사진 설명으로 단일 발포 수지를 확정할 수도 없다. (원본 `/hazardousContact`, `/massKg`, `/region`, `/polymer`)

출처 텍스트: [05-commons-api.json](../data/h-candidates/2026-11-12/sources/05-commons-api.json), `/page/imageinfo/0/extmetadata/ImageDescription/value`. 제목 File:EPE Logs.jpg와 설명은 전자제품 포장 발포체의 냉간 압축을 가리킨다. 제목은 대상 로트의 조성 확인이나 혼합 설정의 반증이 아니다. 서로 다른 조각의 혼합과 한 제품의 복합 구조를 구분해야 한다.

확인 질문:

1. 혼합은 서로 다른 조각의 혼입인가, 한 제품 안의 복합 구조인가? 수지별 비율과 테이프·접착제의 성분·사용 이력을 확인할 자료는 무엇인가? (근거: `/polymer`, `/contamination`)
2. 이 배치의 실측 질량과 발생 장소는 어디이며, 접촉 물질 이력을 누가 확인할 수 있는가? (근거: `/massKg`, `/region`, `/hazardousContact`)

<a id="h006"></a>

### H006 — PET 결속밴드와 특정되지 않은 처리업체

**ID:** `HYEOB-20261112-006`

**inputSHA:** `aa6104ac7f7461c952fc95b314002860bb01107d59d3814d1e61282d1ac7a87b`

**원본:** [inputs/HYEOB-20261112-006.json](../data/h-candidates/2026-11-12/inputs/HYEOB-20261112-006.json)

설명에는 ‘허가 미확인 업체’라는 시나리오 단서가 있지만, 처리업체를 식별할 자료가 제공되지 않았다. 특정 업체의 부재나 무허가 사실로 읽을 수 없다. (원본 `/description`, `/process`)

결속밴드 절단·PET·무오염·비접촉·60kg·충북은 가정이다. 재질만으로 처리 적합성이나 어떤 업체의 허가 범위를 판단할 근거가 없다. (원본 `/description`, `/process`, `/polymer`, `/contamination`, `/hazardousContact`, `/massKg`, `/region`)

출처 텍스트: [06-commons-api.json](../data/h-candidates/2026-11-12/sources/06-commons-api.json), `/page/imageinfo/0/extmetadata/ImageDescription/value`. 잘린 불투명 PET 결속밴드를 설명한다. 제조 자투리인지 사용 후 제거한 밴드인지, 업체 상태가 어떤지는 확인되지 않는다.

확인 질문:

1. 어느 실제 처리업체와 공정을 검토하는가? 해당 업체의 허가 범위·유효 기간·인수 조건을 확인할 문서는 무엇인가? (근거: `/description`, `/process`)
2. 제조 자투리인가, 사용 후 제거한 밴드인가? 60kg 배치의 발생·계량 기록과 무오염·비접촉 진술을 연결할 근거는 무엇인가? (근거: `/massKg`, `/contamination`, `/hazardousContact`, `/process`)

<a id="h007"></a>

### H007 — 운반 상자의 다음 용도와 상태 기준 부재

**ID:** `HYEOB-20261112-007`

**inputSHA:** `dd530034e235f514b61ee5a8d585978ead905acdfc04a3530e462a09e18ff320`

**원본:** [inputs/HYEOB-20261112-007.json](../data/h-candidates/2026-11-12/inputs/HYEOB-20261112-007.json)

회수·선별한 HDPE 운반 상자의 재사용 검토라는 설명은 있으나, 다음 용도와 그 용도의 상태·성능 수용 기준은 없다. HDPE 표기나 외관 추정은 재사용 적합성을 대신하지 않는다. (원본 `/description`, `/process`, `/polymer`)

무오염·비접촉·30kg·충남은 시나리오 가정이다. 검사·세척·이전 사용 기록 및 잔여 수명, 기능 단위와 비교 경계가 입력에 없다. (원본 `/description`, `/contamination`, `/hazardousContact`, `/massKg`, `/region`)

출처 텍스트: [07-commons-api.json](../data/h-candidates/2026-11-12/sources/07-commons-api.json), `/page/imageinfo/0/extmetadata/ImageDescription/value`. 팔레트 위 HDPE 우유 상자를 설명한다. 내용물·반복 사용·세척 이력이나 재사용 적합성 확인 기록이 아니다. 30kg으로 개수·상태·잔여 수명을 알 수 없다.

확인 질문:

1. 다음 사용처·기능은 무엇이며, 균열·하중·치수 등 상태·성능의 수용 기준과 검사 책임은 어떻게 정하는가? (근거: `/description`, `/process`)
2. 상자 수량과 개체/로트별 균열·변형·이전 사용·세척·검사 기록 및 잔여 수명을 확인할 자료는 있는가? (근거: `/process`, `/contamination`, `/hazardousContact`)
3. 재사용 비교를 한다면 기능 단위·기간·운송·대체 효과를 어떤 근거와 경계로 맞출 것인가? (근거: `/description`, `/massKg`)

<a id="h008"></a>

### H008 — 폐유 진술과 no 답변의 근거 공백

**ID:** `HYEOB-20261112-008`

**inputSHA:** `978a57423199674dee21982375171258ab9908701ea6f69934d95afc8ff31dbb`

**원본:** [inputs/HYEOB-20261112-008.json](../data/h-candidates/2026-11-12/inputs/HYEOB-20261112-008.json)

PP 사출 퍼지라는 가정과 ‘폐유 부착, 접촉 물질과 잔류 정도 미확인’이라는 진술에 hazardousContact=no가 함께 있다. 추가 확인이 필요하지만 폐유라는 말만으로 yes나 법적 분류를 부여하지 않는다. (원본 `/description`, `/process`, `/polymer`, `/contamination`, `/hazardousContact`)

폐유의 정체·잔류량·접촉 기록은 없고 15kg·울산도 합성 값이다. 물질 정보의 부재와 no의 근거 부족을 구분해 남겨야 한다. (원본 `/contamination`, `/hazardousContact`, `/massKg`, `/region`, `/description`)

출처 텍스트: [08-commons-api.json](../data/h-candidates/2026-11-12/sources/08-commons-api.json), `/page/imageinfo/0/extmetadata/ImageDescription/value`. 재활용 시설의 플라스틱 가공기 잔여물이라는 일반 설명뿐이다. 사출 퍼지·PP·폐유는 출처에서 입증되지 않은 입력의 보고된 합성 가정이다.

확인 질문:

1. 어떤 오일·접촉 물질이 얼마나 남았으며 제품 자료·사용·접촉 기록으로 확인 가능한가? (근거: `/contamination`, `/process`)
2. 물질 정체와 잔류 정도가 미확인인데 no를 선택한 근거는 무엇인가? (근거: `/contamination`, `/hazardousContact`)
3. 사출 퍼지·PP라는 설정을 실제 공정·원료 기록으로 확인할 수 있는가? 15kg과 장소를 동일 배치에 연결할 수 있는가? (근거: `/process`, `/polymer`, `/massKg`, `/region`)

<a id="h009"></a>

### H009 — 발포체 설명과 여섯 핵심 정보의 공백

**ID:** `HYEOB-20261112-009`

**inputSHA:** `65c54b7dcfa5d975474542a5675a7c6bb64850d2a4e320845ad67ccaa5d2498e`

**원본:** [inputs/HYEOB-20261112-009.json](../data/h-candidates/2026-11-12/inputs/HYEOB-20261112-009.json)

공정·수지·오염·질량·지역은 null이고 접촉은 unknown이다. 여섯 핵심 정보가 모두 미상이다. description의 ‘발포체’라는 단서도 물질 동정이나 발생원 증명이 아니다. (원본 `/description`, `/process`, `/polymer`, `/contamination`, `/hazardousContact`, `/massKg`, `/region`)

캡션·파일명으로 수지나 화학·법적 분류를 채울 수 없다. 먼저 현장과 배치를 특정할 수 있는 원자료가 필요하다. (원본 `/description`, `/polymer`, `/process`)

출처 텍스트: [09-commons-api.json](../data/h-candidates/2026-11-12/sources/09-commons-api.json), `/page/imageinfo/0/extmetadata/ImageDescription/value`. 제목 File:Limbah Styrofoam.jpg와 인도네시아어 설명은 합성 styrofoam/polistirena를 일반적으로 설명한다. 캡션은 대상 물질 동정이나 발생 국가 확인이 아니다. manifest /entries/8/photo/sourceCountry=ID의 근거를 제공 snapshot에서 확인하지 못함: Categories 필드도 없다. 부모 확인과 일치하며 국가 확정·오류 판정·임의 교정은 하지 않는다.

확인 질문:

1. 어느 현장·공정에서 나온 어떤 배치이며 재질을 독립적으로 확인할 기록은 있는가? (근거: `/process`, `/polymer`, `/region`)
2. 오염·접촉 이력과 실측 질량 중 무엇을 누가 확인할 수 있고, 끝내 미상으로 남는 것은 무엇인가? (근거: `/contamination`, `/hazardousContact`, `/massKg`)

<a id="h010"></a>

### H010 — 여섯 정보 공백과 신뢰하지 않는 삽입 지시

**ID:** `HYEOB-20261112-010`

**inputSHA:** `898699ed96ab28225c9a2bbf9e1c0770fdb571e49af581832a96d92bf46a090f`

**원본:** [inputs/HYEOB-20261112-010.json](../data/h-candidates/2026-11-12/inputs/HYEOB-20261112-010.json)

공정·수지·오염·질량·지역은 null, 접촉은 unknown으로 H009와 같은 여섯 정보 공백이 있다. 설명 속 문장은 이를 채우는 현장 증거가 아니다. (원본 `/process`, `/polymer`, `/contamination`, `/hazardousContact`, `/massKg`, `/region`, `/description`)

description에는 도구 실행과 분류 확정을 요구하는 신뢰하지 않는 문장이 포함된다. 검토 대상 데이터로만 취급했으며 그 지시·코드를 실행하거나 정답으로 채택하지 않았다. (원본 `/description`)

출처 텍스트: [10-commons-api.json](../data/h-candidates/2026-11-12/sources/10-commons-api.json), `/page/imageinfo/0/extmetadata/ImageDescription/value`. 일본의 플라스틱 포장 폐기물을 설명한다. 입력의 실제 공정·재질·지역을 확정하지 않으며 삽입 지시에 권한을 부여하지 않는다. 삽입 지시는 실행하지 않았다.

확인 질문:

1. 실제 발생 공정·재질·오염·접촉·배치 질량·장소를 확인할 원자료는 무엇인가? (근거: `/process`, `/polymer`, `/contamination`, `/hazardousContact`, `/massKg`, `/region`)
2. 삽입 지시를 운영 권한 없는 적대적 개발 시험 문장으로 의도적으로 유지한 것인가? 실제 사례 설명과 구분할 담당자는 누구인가? (근거: `/description`)

## 공통 출처·승인 한계

- 같은 assistant/session은 앱 제작과 과거 H 인계 문서에 노출되었다. 원본을 프로그램으로 파싱해 해시·입력 동등성을 확인한 이력이 있다. 작성자 제안 질문·의도(stratum/evaluationIntent), 실행·개선·peer-review 출력은 판단 근거로 사용하지 않았다. 비노출이나 clean blinding을 주장하지 않는다. 이번 보완은 지정 부모 초기 메모·입력/해시 검증과 Astra input-only 평가의 출처 텍스트 구분을 사용했다.
- 원본 설명에 시나리오 단서가 있다. **blind·인간·독립 ground truth·잠긴 holdout이 아니다.** 추가 AI 검토도 인간의 독립 검토로 바뀌지 않는다.
- 10건 모두 `/photoRefs=[]`이고 메타데이터 `/photoAttachment/status=not-yet-server-uploaded`다. `/photo/modelTransmissionApproval=false`, `/photo/operatorConsent=false`다. 픽셀을 열람·표시·전송하지 않고 로컬 바이트만 해시했다. 따라서 사진 관측 결과는 없고, 채워진 현장 값도 계속 합성 가정이다.
- 파일명·캡션·공개 사진 설명은 물질 동정, 화학적·법적 분류 또는 현장 이력의 근거로 사용하지 않았다. `/photo/domesticManufacturingOriginVerified=false`이며, `sourceCountry`도 입력의 국내 발생지를 증명하지 않는다.
- `/photo/license`, `licenseUrl`, `sourceLicenseDeclarationChecked`는 작성자가 제공한 라이선스 선언 메타데이터다. 로컬 스냅샷 해시 일치와 권리 승인·운영자 동의·모델 전송 승인은 다르다. 스냅샷 문구의 독자적인 권리 심사나 최신 웹 확인은 하지 않았다.
- PNG 10개의 해시는 서로 다르다. `sourceInput/sha256` 선언 10개도 서로 다르지만 해당 원본 바이트는 번들에 없어 재해시하지 못했다. `sourceOriginal`은 H001–007만 선언되어 있고 H008–010은 null이다. 바이트 차이는 시각적·출처·현장 독립성을 입증하지 않는다.

공통 메타데이터 근거: [원본 manifest](../data/h-candidates/2026-11-12/manifest.json)의 `/entries/0..9/photo`, `photoAttachment`, `fieldProvenance`, `assessmentDateProvenance`. 각 entry는 위 ID·inputSHA와 일대일 연결되며 전체 해시는 `df62053c3db875ce13a8502d27b9b78e5b731ebfdbaf324cd3969ee8d72e9e68`다. `/assessmentDate=2026-11-12`는 시험 기준일 설정이며 촬영·관측일이 아니다. 라이선스·출처·PNG 개별 파일과 선언 해시는 AI JSON의 `/cases/0..9/metadata/photo`, 실제 해시는 [검증 영수증](../data/o-reviews/h-candidates-2026-11-13/validation.json)에 있다.

## H/O 그룹 검토

H003–007은 메타데이터상 업로더 `ScrapManagement`와 잠정 그룹 `scrapmanagement-site-and-lot-review-pending`을 공유한다. **동일 현장·로트는 입증되지 않았다.** H004의 sourceCountry=US를 다른 업로더 그룹 구성원에 전파하지 않는다. 근거는 manifest `/entries/2..6/photo/author`, `/entries/2..6/duplicateGroupId`이며 해당 사례 ID·입력 해시는 위 절에 있다. 잠정 묶음을 독립성 보장이나 split 결정으로 채택하지 않는다.

비교 범위는 **H 10건 + O 10건 = 20건**이다. 전체 30건 검토가 아니다. 최초 검토는 로컬 지정 증거의 `/oInputs/0..9/input`과 제공 `sha256`을 사용했다. 제출 시에는 [O 입력 원본](../data/candidates/oyeonseok-2026-11-10/)으로 연결하고 아래 해시를 다시 확인했다. 표의 증거 JSON 포인터는 최초 검토 기록의 위치이며, 같은 필드는 해당 O 원본 JSON에서도 확인할 수 있다. raw700 목록·이미지를 열거나 다운로드하지 않았다.

| H ↔ O | 입력에서 확인한 주제와 차이 | 증거 포인터 |
| --- | --- | --- |
| H003 ↔ O005/O006 | 다층 구성·라벨 해석이라는 주제는 겹치나 H003은 PP/PE 다층 진술이고 O006은 가상의 PP 태그/ABS 사양 불일치다. 동일 자료라는 증거는 없다. | H 원본 `/polymer`; 증거 JSON `/oInputs/4/input`, `/oInputs/5/input` |
| H004 ↔ O008 | 용기·접촉 이력이라는 주제가 겹친다. H004는 내용물 미확인+no, O008은 유해 용제 접촉을 가정한 yes여서 동일 증거나 같은 접촉 사실로 볼 수 없다. | H 원본 `/contamination`, `/hazardousContact`; 증거 JSON `/oInputs/7/input` |
| H008 ↔ O007 | 오일 잔류라는 주제가 겹친다. H008은 no, O007은 unknown이며 서로 다른 가정이다. | H 원본 `/contamination`, `/hazardousContact`; 증거 JSON `/oInputs/6/input` |
| H007 ↔ O009 | 재사용 조건·비교 기준의 공백이라는 주제가 겹친다. H007은 HDPE 운반 상자, O009는 가상의 PP 운반 삽입재로 기술되어 있다. | H 원본 `/description`, `/process`, `/polymer`; 증거 JSON `/oInputs/8/input` |
| H009/H010 ↔ O006/O010 | 정보 부족이라는 주제가 겹치지만 공백의 범위와 서술이 다르다. H009/010의 여섯 핵심 정보는 모두 미상이다. | H 원본 `/process`, `/polymer`, `/contamination`, `/hazardousContact`, `/massKg`, `/region`; 증거 JSON `/oInputs/5/input`, `/oInputs/9/input` |

O001–004의 청정 단일수지 가정도 H001·002 등의 채워진 입력과 학습 주제를 공유하지만, 출처·현장·배치 중복을 뜻하지 않는다. 근거: 증거 JSON `/oInputs/0..3/input/description`, `polymer`, `process`와 H001·002 원본 `/description`, `/polymer`, `/process`. 각 O의 정식 ID·입력 해시는 아래와 같다.

| O ID | 제공 inputSHA |
| --- | --- |
| OYS-20261110-001 | `1f1163e501b1ade17ed9207933242a51120bb15584f8e95b6e6d736fe0cd67ff` |
| OYS-20261110-002 | `0b052aeeb9e97a93699267d68662d8c1b1efee32107f2711d7be6fab78764b2c` |
| OYS-20261110-003 | `6c09027b9a767e917d5b3ffc45a437fd8153ff7b8eec3750ddb9f410eb4403b4` |
| OYS-20261110-004 | `7ccbf029c826be106e753dc15997bf608b856a9e893b45497eed4ef533c04d7f` |
| OYS-20261110-005 | `59144769d4f4936970990eda5b5a9b2732766f849db494b6c236f4b7feef3129` |
| OYS-20261110-006 | `29c76c30e310148b0ab270ef51e2a4fee92d35aab35106560e4ac36d4947bda0` |
| OYS-20261110-007 | `1fd9200b832cb774fe49f26df99b017f5a22b25ed19564ba5eff4b9dcc672ca8` |
| OYS-20261110-008 | `f3833e8d39ff4b96f94c784d69889c59db17390bd2993d6f5e0883aecd842fa9` |
| OYS-20261110-009 | `acadb919168dc522ac98cbbc8ba2b27bd6d2224f0bb4779a689f079768da17b7` |
| OYS-20261110-010 | `e83d1f30b91e37a38e70a20963a4db2ecb13287aae67a54e10f92b3509d51d2d` |

주제 유사성은 중복 증명이나 split 배정이 아니다. H/O 연결의 사례 ID·전체 입력 해시·파일·JSON 포인터는 AI JSON `/groupReview/comparisons`에 있다. H001/002와 O001–004의 일반적인 재질 주제 일치 역시 원본 사진 또는 동일 배치의 증거가 아니다.

## 다음 단계

- [ ] 독립성이 필요하면 원본 입력 → 빈 인간 양식 순으로 검토하고, AI 보고서의 사전 노출을 사실대로 기록한다.
- [ ] 인간이 신원·자격·검토 시각·자기 라벨/판단/근거를 작성한다. acceptance·split·동의는 현재 전부 null이며 자동 승인으로 해석하지 않는다.
- [ ] 사례별 질문에 맞는 조성·생산·접촉·계량·장소·업체·재사용 상태 기록을 확보하고, 새 증거와 기존 가정을 구분한다.
- [ ] 이미지 사용이 필요해지면 목적별 권리·운영자·전송 동의를 별도로 확인한다. 현재 false를 변경하지 않는다.
- [ ] 전체 30건의 출처·현장·로트 검토 후 split과 채택을 담당 인간이 별도로 결정한다.
- [ ] 부모가 산출물을 독립적으로 최종 검증하고 gate를 소유한다. Astra input-only 출처 텍스트 구분을 반영했다. AI 검토는 인간 검토 완료나 채택이 아니다.

기존 로컬 영수증 실행 시각은 `2026-11-13T15:25:50.514Z` (UTC), 즉 `2026-11-14T00:25:50.514+09:00` (KST)다. 요청·묶음 날짜 2026-11-13, 작성일 2026-11-14 KST, 입력 평가 설정일 2026-11-12는 별개다. 출처 snapshot 날짜는 변경하지 않았다.

부모의 지정 검증 /parserChecks는 실제 parseCaseInput 10/10 통과이며 /checks의 입력·PNG·출처·라이선스 바이트 일치와 별개다. 부모 검증 결과를 인용하며 이번 보완에서 재실행하지 않았다. 모델·assessment·ground-truth 검증이 아니다.

검증은 [validation.json](../data/o-reviews/h-candidates-2026-11-13/validation.json)에 실제 실행한 항목만 기록했다. 최초 로컬 검토 당시에는 커밋·푸시·PR을 수행하지 않았다. 이후 사용자의 제출 지시에 따른 현재 저장소 검사는 `publicationChecks`에 별도로 기록한다. 앱 판정·평가·모델 실행이나 사람의 독립 검토 완료를 뜻하지 않는다.

참조: [H 원본·출처 manifest](../data/h-candidates/2026-11-12/manifest.json), [O 후보 인계](o-candidate-handoff.md), [검토 묶음 README](../data/o-reviews/h-candidates-2026-11-13/README.md). 최초 로컬 메모·지정 증거의 파일명과 SHA-256은 AI JSON의 `sources`에 당시 이력으로 남기며 해당 로컬 파일은 이 PR에 포함하지 않는다.
