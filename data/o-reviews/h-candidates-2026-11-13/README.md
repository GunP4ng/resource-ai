# H 후보 AI 예비 검토 묶음

H 후보 10건의 AI 보조 예비 검토다. 소스 커밋: `ceb9e48b6db3e1a16b1eb69a65a35da8482b0dc4`. 폴더 날짜는 요청된 묶음 이름이며 작성일은 2026-11-14 KST (UTC+09:00)다. 정답·현장 채택·분류·split을 확정하지 않는다.

2026-11-14 제출 범위: [팀 공통 작업표](../../../docs/team-tasks.md)의 수집자 외 교차검토에 따라 오연석 담당의 H 후보 검토를 준비한 자료다. AI 예비 검토와 빈 인간 양식만 제출하며 오연석 본인의 독립 라벨 완료를 뜻하지 않는다. 원본 입력은 변경하지 않는다. 과거 로컬 검증 자료는 파일명과 SHA-256만 보존하며 저장소에 번들되지 않았다. 현재 저장소에서 재현한 제출 검사는 `validation.json`의 `publicationChecks`를 따른다.

독립적 인간 판단이 필요하면 **[원본 입력](../../h-candidates/2026-11-12/inputs/) → [빈 인간 양식](human-review.json)** 순서로 먼저 읽는다. 이 README에는 사례별 AI 판단을 넣지 않았다. AI 문서를 먼저 읽었다면 `priorAIDraftExposure`에 그 사실을 기록하며 blinded라고 부르지 않는다.

- [human-review.json](human-review.json): 사례 ID와 inputSHA만 사전 기재. 신원·자격·검토 시각·자기 라벨·판단·근거·채택·split·사전 AI 노출·동의·서명은 모두 null이다. null은 미작성/미확인이며 거절·미노출·승인을 뜻하지 않는다.
- [읽기용 AI 보고서](../../../docs/o-h-candidate-review.md): 10건의 근거와 질문, 출처·승인 한계, H/O 주제 비교.
- [ai-preliminary-review.json](ai-preliminary-review.json): reviewerType=AI-assisted, status=preliminary. 입력 전체 필드와 합성/미상 구분, 파일·JSON 포인터 및 해시.
- [validation.json](validation.json): 기존 Bun 검사, 별도 부모 검증 및 이번 산출물 확인을 구분한 영수증. 내용 판정이나 현장 사실의 검증과 구별한다.

같은 assistant/session은 앱 제작과 과거 H 인계 문서에 노출되었다. 원본 설명에도 시나리오 단서가 있어 이 묶음은 blind·인간·독립 ground truth·잠긴 holdout이 아니다. 원본을 프로그램으로 파싱해 해시·입력 동등성을 확인한 이력이 있다. 작성자 제안 질문·의도(stratum/evaluationIntent), 실행·개선·peer-review 출력은 판단 근거로 사용하지 않았다. 비노출이나 clean blinding을 주장하지 않는다. 이번 보완은 지정 부모 초기 메모·입력/해시 검증과 Astra input-only 평가의 출처 텍스트 구분을 사용했다. 사진은 픽셀 검토하지 않았으며 10건 모두 모델 전송 승인과 운영자 동의가 false이다.

H/O 비교는 20건에 한정된다. 원본 이미지 바이트는 번들에 없고 H008–010의 sourceOriginal 해시 선언도 없다. 전체 30건이나 raw700은 검토하지 않았다. 원래 로컬 검토 뒤 사용자의 PR 제출 지시에 따라 텍스트 자료만 제출한다.

기존 로컬 영수증 실행 시각은 `2026-11-13T15:25:50.514Z` (UTC), 즉 `2026-11-14T00:25:50.514+09:00` (KST)다. 요청·묶음 날짜 2026-11-13, 작성일 2026-11-14 KST, 입력 평가 설정일 2026-11-12는 별개다. 출처 snapshot 날짜는 변경하지 않았다.

부모의 지정 검증 /parserChecks는 실제 parseCaseInput 10/10 통과이며 /checks의 입력·PNG·출처·라이선스 바이트 일치와 별개다. 부모 검증 결과를 인용하며 이번 보완에서 재실행하지 않았다. 모델·assessment·ground-truth 검증이 아니다. Astra 출처 텍스트 구분은 AI 보고서·JSON에 반영했다. 인간 검토 완료나 acceptance가 아니며 인간 작성 칸은 모두 null이다.
