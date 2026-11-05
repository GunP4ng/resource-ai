# 출처 인계 상태 (2026-11-05)

이 표의 확인 상태는 [manifest.json](manifest.json)의 스냅샷에 대응한다. 공개 화면 열람, 원본 다운로드, 재사용 허가, 현행 허가·법령 적용은 별개의 확인이다. URL과 자료명은 각 기관의 공개 페이지에 연결했다.

| 분류·출처 | 접근·다운로드 | 재사용 | 시점·확인 필드 | 보류 사항 |
|---|---|---|---|---|
| 가격: [한국환경공단 2026년 10월 조사](https://www.data.go.kr/data/3076421/fileData.do) | 원본 CSV 1,730바이트·26행 확보; `data/reference/keco-price-2026-10.csv` | 공공누리 제1유형, 출처표시 확인 | 조사일 10/10, 공표 10/26; 수지·형태별 8권역 원/kg | 실제 계약가격이 아님. 2026년 VAT·물류 정의는 재확인 필요. 공란은 미공표 |
| 업체: [울산광역시 목록](https://www.data.go.kr/data/15054809/fileData.do) | 원본 3,464바이트·SHA 재확인; 대표자·전화번호 제거한 31행 UTF-8 파생본 묶음 포함 | 이용허락범위 제한 없음 확인 | 메타데이터 2025-12-22; 구분·업체명·사무실·영업구역·비고 | 코드·허가 근거·시설 위치·행별 갱신일·현재 인수 의사 없음 |
| 업체: [전국 표준데이터](https://www.data.go.kr/data/15114147/standard.do) | 메타데이터만 확인, 원본 행 미확보 | 미확인 | 페이지 수정일 2026-11-02; 주소·업종·처리폐기물·허가일자 등 필드 정의 | 라이선스·행별 최신성·허가 유효성 확인 필요 |
| 법령: [폐기물관리법 시행규칙 2026-10-02 버전](https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=290881) | 제4조의2 텍스트 스냅샷·SHA·인용 1건 묶음 포함. [별표 4 PDF](https://www.law.go.kr/LSW/flDownload.do?gubun=&flSeq=170404737&bylClsCd=110201) 174,883바이트·14쪽 해시 재확인, PDF는 제외 | [저작권법 제7조 제1호](https://www.law.go.kr/lsLinkProc.do?joNo=000700&lsClsCd=L&lsNm=%EC%A0%80%EC%9E%91%EA%B6%8C%EB%B2%95&mode=11)에 따른 법령 텍스트 비보호 확인; 포털 화면·편집물 권리는 별도 | 시행일 2026-10-02, 제4조의2 제1항의 별표 4 연결 | PDF 한글 행 추출 실패. 다른 별표·후속 개정·공정별 매핑 검증 전 자동 코드/적합 판정 금지 |
| 계수: [GIR 2025년 승인 계수](https://www.gir.go.kr/home/board/read.do?boardId=86&boardMasterId=2&menuId=36) | 게시물 첨부 PDF 387,652바이트·SHA 확인, 4쪽; 묶음 제외 | 미확인 | 게시일 2025-12-18 | 개별 계수의 쪽·단위·GWP·사용권·적용 경계 미대조, 폐플라스틱 전 경로 계수 아님 |
| 계수: [KEITI 국가 LCI 설명](https://www.keiti.re.kr/site/keiti/02/10202100000002023101610.jsp) | 사업 설명만; 개별 레코드 미확보 | 한국 LCI DB·평가계수의 상업용 사용 불가 안내 확인 | 개별 레코드 기간·단위·경계 미확인 | `FactorRecord` registry에 값 등록 불가 |

## 인계

- 이상협: `findEvidenceForCase(CaseInput)`은 검증된 레지스트리를 기본으로 읽어 `EvidenceRecord[]`를 반환한다. `lookupLegalEvidence`의 `issues`를 보류 이유로 사용하고 `pendingLegalSources`는 `{ pending, issues }`를 반환한다. 현재 법령 인용 1건은 제4조의2의 별표 연결만 지지하며 특정 코드·적합성 판정은 보류다. [인계 문서](handoff-2026-11-06.md)와 [적용일 검토 목록](legal-review-list.md)을 참조한다.
- 오연석: `readPriceSnapshot`은 원본 SHA-256을 확인하고 원/kg 참고 매각가격, 수지·형태·품질·권역·조사일·공표일과 `null` 공란을 제공한다. 비플라스틱 9행은 `skipped`에 남긴다. 매각수입이나 처리 견적으로 자동 전환하지 않는다. `readSanitizedProcessorSnapshot`은 묶음의 31행 파생본을 읽고 모든 행의 허가와 폐기물 코드를 미확인으로 둔다. 계수 수치는 등록할 수 없으며, GIR PDF는 해시와 4쪽 구성만 확인했다.
- 실제 행 대조: 원본 CSV 4행 `압축-PE(잡색)`의 수도권 481.3원/kg, 강원 공란을 정규화 결과와 대조했다. 원본 파일 SHA-256은 `562bf85c2f9a2047649b52d9875da462fdb2ca14be36e21cfd1950ff976dfeb3`이다. 이는 가격 행의 전사 확인이지 실제 계약가격 검증이 아니다.
