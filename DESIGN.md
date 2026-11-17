# Re:Source 운영 화면 디자인

## 1. 목적과 기존 화면
기존 report-html의 시스템 글꼴, 중립 녹색, 표와 details를 유지한다. 실제 before/recommended-390-light, held-1440-dark, photo-controls-390-dark를 확인했다. 결론보다 먼저 나오는 긴 식별자, 뒤늦은 확신도, 노출된 내부 상태, JSON 중심 수정을 개선한다. 장식 이미지·그라데이션·새 브랜드·폰트·프레임워크는 도입하지 않는다. 판단하는 운영자와 휴대폰으로 근거를 확인하는 담당자가 주 사용자다.

## 2. 색상
| 토큰 | Light | Dark | 용도 |
|---|---|---|---|
| --bg | #fbfbfa | #171c19 | 문서 배경 |
| --ink | #252824 | #eef2ec | 본문 |
| --muted | #535b52 | #bac5ba | 보조 본문 |
| --action | #273e31 | #c5e5cb | 주 동작·추천 |
| --on-action | #ffffff | #13231a | 주 버튼 글자 |
| --surface | #ffffff | #202922 | 입력·알림 표면 |
| --line | #737b72 | #8c998d | 경계·스크롤바 |
| --focus | #076641 | #a4e9bf | 링크·포커스·caret |
| --selection | #d7e9dc | #385c44 | 선택 배경 |
| --question | #245888 | #a9cff5 | 질문 상태 |
| --held | #8a3a16 | #ffd0ac | 보류·오류 |
텍스트 대비는 두 테마 모두 4.5:1 이상이어야 한다. 상태는 색 외에 ✓ 추천 / ? 추가 정보 필요 / ! 검토 필요 문구로 전달한다. 실제 0과 자료 없음은 구별한다.

## 3. 글자
system-ui, sans-serif를 사용하며 코드만 ui-monospace, monospace다. --body=17px, --secondary=15px(600·muted), --h3=22px, --h2=28px, --h1=36px, 본문 행간 1.7, 제목 1.3. 각 제목 단계는 1.25배 이상이다. h4는 별도 작은 제목 대신 본문 크기의 굵은 내역 표제다. 짧은 한국어 결론과 자연스러운 줄바꿈을 사용한다. 숫자는 tabular-nums다. 인쇄는 body 10.5pt, h1 21pt/h2 16pt/h3 12.5pt로 문서 공간을 보존한다.

## 4. 간격과 레이아웃
--s8/12/16/20/24/32/48은 각각 8/12/16/20/24/32/48px. --target=44px, --radius=4px, --border=1px, --focus-width=2px, --focus-offset=3px. 사진 미리보기 최대 높이는 기존 240px, textarea 최소 높이는 136px. 인쇄 여백은 기존 A4 18mm다.

결과·폼·보고서는 [stack](https://github.com/changeroa/StyleGallery/blob/main/patterns/stacking/stack.md)으로 세로 읽기 순서를 유지하고 [content-limiter](https://github.com/changeroa/StyleGallery/blob/main/patterns/containment/content-limiter.md)로 최대 68ch 안에 둔다. 최초 74ch에서 실제 영문 출처 설명이 한 줄 86자로 측정되어 80자 이내로 줄였다. document/body가 유일한 세로 스크롤 소유자이며 모바일 양옆은 20px이다. 탐색·동작은 줄바꿈 가능한 [cluster](https://github.com/changeroa/StyleGallery/blob/main/patterns/in-line-grouping/cluster.md)이며 DOM·시각·포커스 순서가 같다. 중첩 스크롤 shell, 고정 높이, 강제 동일 카드 높이는 없다. 표만 필요할 때 가로로 넘길 수 있고 세로 스크롤은 만들지 않는다. 사례 목록은 좁은 화면에서 행을 세로 정보로 전개한다.

좁은 목록·정의 목록의 재배치 기준은 600px이다. 링크 밑줄 간격은 .2em이다. 인쇄 본문 행간은 1.45이며 모든 색 토큰을 밝은 테마로 고정한다. 인쇄 세부 간격은 위 8/12/20px 토큰을 재사용한다.

## 5. 재사용 요소와 정보 순서
page는 의미 있는 nav/main/footer, 건너뛰기 링크, 공유 스타일·same-origin defer script를 제공한다. 결론 → 확신도·이유 → 연구 계산 → 처분 문의 행 → 실행 전 확인 → 법적 원문 → 고급 메타데이터 순서다. 근거 확인하기 / 실행 전 확인하기는 실제 anchor로 연결한다. 서버 전용 연구 context는 일반 보고서에서 완전히 제외한다.

form은 label·단위·미상 안내와 native POST를 사용한다. 한국어 일반 수정 입력이 주 기능이고 JSON은 details로 접는다. 자료 반영해 다시 평가하기는 현재 입력의 실제 값을 제출한다. 사진 선택·동의는 기존 제약을 그대로 적용한다. 버튼·summary·독립 원문 링크는 최소 44px, focus-visible은 테마 포커스 링이다. 빈 결과와 null에는 원인을 함께 쓴다. 실패 화면은 기존 마지막 저장 결과 링크를 유지한다.

## 6. 피드백과 상호작용
[Apple HIG hierarchy](https://developer.apple.com/design/human-interface-guidelines/layout), [feedback/loading](https://developer.apple.com/design/human-interface-guidelines/progress-indicators), [buttons](https://developer.apple.com/design/human-interface-guidelines/buttons), [accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)의 원칙을 적용한다: 중요한 판단을 먼저, 동사 동작을 명확히, 처리 상태와 복구를 가까이, 터치·키보드·읽기를 함께 지원한다. upstream 문구나 코드는 복제하지 않는다.

이미 검토된 [beui stateful button](https://beui.dev/r/button)은 busy/disabled/live·reduced-motion 원칙만 참고한다. 자체 작은 script는 native POST를 가로채지 않고 aria-busy와 live 상태를 설정하고 재제출만 막는다. 입력을 disable하지 않는다. pageshow에서 상태를 복원한다. 외부 요청·credential 읽기·클라이언트 계산은 없다. hover는 밑줄 굵기, active는 테두리 스타일로 즉시 피드백한다. 필수 애니메이션은 없고 reduced-motion에서는 모든 전환·스크롤 애니메이션을 끈다.

## 7. 표면과 근거
문서 흐름과 간격으로 구분하고 입력·알림에만 표면색을 쓴다. 테두리 1px, 그림자·accent stripe·카드 안 카드 없음. 법적 발췌는 등록 sourceId+SHA+법령 버전에 일치하는 저장 quote/locator만 표시한다. 등록 원본 URL·PDF page를 사용하고 최신 시행본으로 바꾸지 않는다. 연구 수치는 serialized display만 표시하며 추천 순위·확신도를 바꾸지 않는다.

## 8. 접근성·검증 인계
1440/390 light/dark, 추천/질문/실제 보류, 키보드·focus·44px·대비·busy/pageshow/reduced-motion은 parent가 실제 브라우저에서 확인한다. 이번 lane은 focused HTTP·보고서·폼·script 회귀 검사를 제공한다. 실제 시각 QA·Lighthouse·외부 제공자 성공·영상은 이 문서로 통과 처리하지 않는다. 기존 저장 결과 복구를 유지하고 원문·실행 확인까지 3–4개 동작을 목표로 한다. 부모의 최종 QA 전 시각·접근성 확인은 미검증 항목이며 승인된 품질 부채로 간주하지 않는다.

## 9. 과거 비공개 연구 기록
Brief: 현재 로컬 운영자가 수신된 과거 메타데이터 14건의 질문·검토 사유·누락 근거를 읽는다. 목록은 수집 분류와 평가일로 기록을 찾고, 상세는 당시 입력과 실행 전 확인사항을 먼저 읽는다. 수집 분류는 물질 성분 검증이 아니다. 검토 필요 상태는 !와 문구로 표시하며 실행·반출·계약 권한을 부여하지 않는다. 원문 진단·식별자·해시·출처 선언은 native details에 보존하고, API와 SDK 캐시 경계는 별도 정의 목록으로 설명한다.

Layout: 기존 stack / content-limiter(68ch) / cluster를 재사용한다. document scrolling만 사용하고 목록은 기존 case-list의 600px 전개를 따른다. 목록의 유일한 주 동작은 기록 목록으로 이동, 상세의 유일한 주 동작은 당시 실행 전 확인사항으로 이동이다. 사례·목록 복귀는 일반 링크다. 기존 17px 본문, 44px 링크·summary, 두 테마, 긴 단어 줄바꿈, focus-visible·reduced-motion을 유지한다. 새 토큰·전역 CSS·장식 자산은 없다.

인쇄에서는 archive 본문 전체를 screen-only로 감추고 일반적인 비공개 연구 안내만 print-only로 표시한다. 제목에도 역사 식별자를 넣지 않는다. 일반 보고서 인쇄는 공유 구현 그대로다. 부모가 실제 앱의 1440/390 light/dark 캡처와 탐색·키보드·인쇄를 검사한다. 이 단위의 semantic HTML 검사는 시각·접근성 QA 통과를 뜻하지 않는다.
