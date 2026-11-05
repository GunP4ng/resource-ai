# J2/J3 구현 인계

기준: origin/main 65bb1fe에서 시작한 로컬 jeongjun/j2-j3-legal-evidence. 공통 contracts.ts와 H/O 소유 모듈은 변경하지 않았다. 커밋·푸시·이슈 댓글·PR·배포를 수행하지 않았다.

## 호출

`lookupLegalEvidence(CaseInput, undefined, { intendedUse: "general-resin" | "food-container" })`

반환 evidence는 기존 EvidenceRecord[] 계약이다. citations에는 claim·quote·sourceId·locator·스냅샷/원본 경로와 SHA-256·확인 주체/시점·법령 시행일·확인 기한이 있다. reviewRequirements와 issues도 함께 읽어야 한다. evidence가 있다는 사실은 eligible의 근거 충족을 뜻하지 않는다. DecisionResult.state의 최종 종합은 H2/H3가 소유한다.

선택적 candidates 인자는 신뢰된 내부 큐레이션용 기존 API다. 앱/모델 외부 입력으로 검토 완료 후보 객체를 받으면 안 된다. CLI는 CaseInput만 검증해 정적 registry를 조회한다.

## 확인된 실행 경계

| 변화 | 결과 |
|---|---|
| 2026-11-05, PP, 사출, 오염 없음, 유해 접촉 no | 실제 별표 코드·유형·공통기준 인용 반환. 개별 법적 분류·허가·용도 확인은 계속 필요 |
| 2026-09-30 | 현재 별표 out-of-period, 이전 법령 버전은 pending needs-review |
| 2026-11-06 | currentness-unverified; 미래 현행성을 임의 보장하지 않음 |
| 공정 화학합성 | 선택 코드/유형은 unrelated, 일반 기준만 참고 |
| 사출 아님 | context-ambiguous로 선택 코드 보류 |
| 폐유 혼합 | 선택된 깨끗한 잔재물 조회 범위 밖; 오염을 법적 불허로 단정하지 않음 |
| 유해 접촉 unknown/yes | hazardous-contact-unconfirmed; 지정폐기물 여부 추가 검토 |
| 식품용기 목적 | 실제 별표의 오염 방지 조건 및 고시 적용/제외 조문 인용. 시설·품질·적용범위 확인은 보류 |

PP/PE, 사출/압출, 오염 없음, hazardousContact=no는 현재 검증 범위를 좁히는 제품의 조회 조건이다. 법령이 이 조건만으로 적합성을 보장하거나 다른 공정/오염을 일률적으로 금지한다는 주장이 아니다. 발생 공정과 재활용 처리 공정을 혼동하지 않는다. intendedUse는 기존 CaseInput의 발생공정을 덮어쓰지 않고 별도 조회 옵션으로 전달한다.

## 검증과 미완료

실행 명령: `bun run typecheck`, `bun test`, `bun run build`, `bun run smoke`, `bun scripts/legal-demo.ts`. 원본 PDF 및 발췌 출처는 ../reference/legal/README.md와 manifest.json에 있다. 생성 실행 기록은 ../reference/legal/demo-results.json이다.

실제 원문 인용을 사용하는 재현 입력이며 실제 사업장 사례는 아니다. 사용자에게 실제 사례를 요청했으나 미확인 응답이었다. 현장 사례·전문가의 법적 검토·H 담당자의 앱 연결을 완료 증거로 꾸미지 않았으므로 J2/#2·J3/#3 전체 완료/이슈 닫기는 보류한다. 고시의 선택 적용범위를 넘어선 시설·품질·인정 절차, 전체 폐기물·처리경로, 이전 법령 원문 전체도 검증 범위 밖이다. 테스트 타입/CI #16은 별도 담당 후속으로 유지한다.
