# 이상협 H 평가 후보 10건 인계

이 폴더는 **공개 사진 10장 + 명시한 합성 CaseInput 10건**의 검토용 묶음이다. 사진의 실제 재질·사업장·공정·질량·지역을 입증한 현장 사례가 아니다. 각 필드의 가정/미상은 [manifest.json](manifest.json)의 `fieldProvenance`에 기록했다. 독립 사람 라벨·인수·개발/잠금 배정은 모두 미정이다. 공개된 이 묶음을 미열람 잠금셋으로 사용하지 않는다.

사용자가 별도로 전달한 700개 이미지 항목 ZIP은 [PR #35](https://github.com/GunP4ng/resource-ai/pull/35)의 수집본이다. 그 CSV는 권리·진위 미확인이며, 이 폴더의 라이선스 선언을 확인한 10장과 구분한다. ZIP 업로드로 H 사례 후보 인계나 현장 인수가 완료되지는 않는다.

## 팀원이 바로 받을 자료

| 자료 | 위치와 용도 |
| --- | --- |
| 후보·출처·권리·중복 그룹 | [manifest.json](manifest.json), 후보 10개·임시 출처 코호트 6개 |
| 입력 JSON | [inputs/](inputs/), 공통 CaseInput만 포함. `photoRefs=[]` 유지 |
| 공유 사진 | [photos/](photos/), 메타데이터를 제거한 PNG 10장. 원본 JPEG는 포함하지 않음 |
| 출처·라이선스 snapshot | [sources/](sources/), manifest에 sourceId/locator/SHA와 라이선스 snapshot 해시 기록 |
| 실제 로컬 host 실행 | [host-execution.json](host-execution.json), 입력·출력·질문·근거·소스 해시 |
| 실제 사진/SDK/HTTP 검사 | [photo-offline-execution.json](photo-offline-execution.json), 합성 전송과 실제 관측을 구분 |
| 두 질문 누락 개선 | [improvement-cycles.json](improvement-cycles.json), 동일 후보 전/중/후 결과 |
| O 후보 검토 준비 | [peer-review.json](peer-review.json), AI 보조 예비 검토와 실행 관측. 독립 사람 라벨 아님 |
| 상세 책임·운영 인계 | [H 인계 문서](../../../docs/h-candidate-handoff.md) |

## 후보와 저작자 표시

아래 수지/공정은 출처 제목 또는 합성 시나리오의 내용이며 사진으로 화학성분을 확정한 결과가 아니다. 각 사진의 출처 링크·저작자·라이선스와 **메타데이터 제거/PNG 변환**, 공식 축소본 사용 여부 등 변경 이력을 함께 보존한다. CC BY-SA 사진 파생물의 배포에는 해당 라이선스 조건을 유지한다. 코드 전체의 라이선스를 사진 라이선스로 변경하는 것은 아니다.

| 후보 끝번호 | 입력 | 사진/출처 | 저작자 | 출처 라이선스 |
| --- | --- | --- | --- | --- |
| 001 | [HDPE 분쇄물](inputs/HYEOB-20261112-001.json) | [PNG](photos/01.png) / [원문](https://commons.wikimedia.org/wiki/File:Clean-HDPE-drum-flakes.jpg) | Soddaa | CC BY-SA 4.0 |
| 002 | [PET 정상 정보](inputs/HYEOB-20261112-002.json) | [PNG](photos/02.png) / [원문](https://commons.wikimedia.org/wiki/File:FLAKES.jpg) | TOP PLASTIC | CC BY-SA 4.0 |
| 003 | [다층·라벨 확인](inputs/HYEOB-20261112-003.json) | [PNG](photos/03.png) / [원문](https://commons.wikimedia.org/wiki/File:PP_Birdseed_Scrap.jpg) | ScrapManagement | CC0 |
| 004 | [이전 내용물 미상](inputs/HYEOB-20261112-004.json) | [PNG](photos/04.png) / [원문](https://commons.wikimedia.org/wiki/File:HDPE_Jerry_Can_Bales.jpg) | ScrapManagement | CC BY-SA 4.0 |
| 005 | [혼합 구성](inputs/HYEOB-20261112-005.json) | [PNG](photos/05.png) / [원문](https://commons.wikimedia.org/wiki/File:EPE_Logs.jpg) | ScrapManagement | CC0 |
| 006 | [허가 미확인 업체 조건](inputs/HYEOB-20261112-006.json) | [PNG](photos/06.png) / [원문](https://commons.wikimedia.org/wiki/File:PET_Strapping_-_Opaque.jpg) | ScrapManagement | CC0 |
| 007 | [재사용 검토](inputs/HYEOB-20261112-007.json) | [PNG](photos/07.png) / [원문](https://commons.wikimedia.org/wiki/File:HDPE_Milk_Crates.jpg) | ScrapManagement | CC0 |
| 008 | [오염·접촉 기록](inputs/HYEOB-20261112-008.json) | [PNG](photos/08.png) / [원문](https://commons.wikimedia.org/wiki/File:Kunststoff_Plastik_Rest_Abfall-20180621-RM-114314.jpg) | Reinhold Möller (Ermell) | CC BY-SA 4.0 |
| 009 | [발생원·수지·질량 미상](inputs/HYEOB-20261112-009.json) | [PNG](photos/09.png) / [원문](https://commons.wikimedia.org/wiki/File:Limbah_Styrofoam.jpg) | Nafisathallah | CC BY 4.0 |
| 010 | [자료 속 악성 지시](inputs/HYEOB-20261112-010.json) | [PNG](photos/10.png) / [원문](https://commons.wikimedia.org/wiki/File:Plastic_waste_20231006_175234.jpg) | Ka23 13 | CC BY-SA 4.0 |

라이선스: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), [CC0](https://creativecommons.org/publicdomain/zero/1.0/). 수집 시 확보한 선언과 snapshot을 보존했다. 사진의 국내 발생원·현장 사실, 운영자 동의 또는 모델 전달 승인을 뜻하지 않는다. EXIF 제거로 얼굴·손·라벨·문자·로고가 사라지는 것은 아니며 목적별 검토가 필요하다.

## 재현 명령

입력 JSON과 사진은 GitHub에서 바로 열 수 있다. 저장소·이미지 저장소·SDK까지 재현하려면 **Linux x64의 로컬 파일시스템, Node 24, Bun 1.4.2**를 사용한다. Windows에서는 이 사진 저장소의 POSIX 권한/fsync 지원을 완료했다고 주장하지 않는다. WSL을 쓴다면 아래 저장소를 WSL의 홈 등 Linux 파일시스템에 둔다.

```sh
git clone --single-branch --branch hyeobikong/h2-candidate-handoff https://github.com/GunP4ng/resource-ai.git resource-ai-h-candidates
cd resource-ai-h-candidates
bun --version
bun install --frozen-lockfile --ignore-scripts
RESOURCE_MODEL_RUNNER=local bun scripts/h-candidates.ts
RESOURCE_MODEL_RUNNER=local bun scripts/h-photo-offline.ts
```

기존 저장소·작업 브랜치를 전환하지 않는 별도 clone 예시다. 같은 이름의 폴더가 있으면 새 경로를 사용한다. 출력은 Git 제외 경로인 `artifacts/h-candidates.json`, `artifacts/h-photo-offline.json`이다. 두 스크립트는 기존 실제 인증 파일을 읽지 않는다. 사진 검사는 임시 합성 credential/authority/동의와 주입 SSE 응답만 사용하고 임시 저장소를 정리한다. 실제 외부 모델 호출은 0건이다.

```sh
RESOURCE_MODEL_RUNNER=local bun test --timeout 30000 tests/assessment.test.ts tests/h-candidates.test.ts
RESOURCE_MODEL_RUNNER=local bun run typecheck
RESOURCE_MODEL_RUNNER=local bun run typecheck:o-tests
RESOURCE_MODEL_RUNNER=local bun run build
RESOURCE_MODEL_RUNNER=local bun run build:app
RESOURCE_MODEL_RUNNER=local bun test --timeout 30000
RESOURCE_MODEL_RUNNER=local bun run smoke
```

## 해석할 때 지킬 경계

- 입력 파싱·모든 사진 디코딩 통과와 법적 적합성·사례 인수는 다르다. `CaseAssessment.candidates.photoInference`는 계속 `not-performed`다.
- 사진 SHA는 공유 PNG, 저장소 정제본, SDK 전송 바이트를 구별해 기록한다. 예전 로컬 초안의 JPEG SHA에 PNG 변환 설명을 붙인 불일치를 이 묶음에서 수정했다.
- 2026-11-12 후보 10건은 현행성 등 미해결 근거 때문에 모두 `needs-review`다. 확인되지 않은 수지·코드·업체·비용·탄소를 생성하지 않는다.
- 별도 2026-11-05 합성 경계 대조는 동일 사진의 공정·오염·유해접촉 변경에 따른 조건부 코드/검토 이유 차이를 확인한다. 현재 날짜의 법령 승인이나 실제 현장 인수로 사용하지 않는다.
- 합성 request ID·usage는 합성이라고 표시하고 실제 제공자 request ID·usage는 null이다. 운영 계정·사진 전송 승인 없이 live 실행하지 않는다.
