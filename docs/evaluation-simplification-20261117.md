# 검증 게이트 단순화와 동일 개발 18건 재평가

**발표일 2026-11-25 대조에서 compared가 0/18 → 7/18로 증가했다.**
원래 평가일을 유지한 첫 대조는 양쪽 모두 7/18이다. 두 실험을 구분한다.
과거 compared 0/18 기록은 이번 수정 전 값으로 재사용하지 않았다.
기준선 `87e04c5`에는 이미 #65, #67 등의 추천 모드 개선이 포함되어 있다.
첫 대조는 입력·평가일·코퍼스를 그대로 유지했다. 리드가 추가 요청한 두 번째 대조에서만 양쪽의 assessmentDate를 동일하게 2026-11-25로 바꿨으며 다른 입력과 위험 차단은 바꾸지 않았다.

## 원래 평가일을 유지한 동일 조건 결과

| C 서버 상태 | 수정 전 | 수정 후 |
| --- | ---: | ---: |
| compared | 7 | 7 |
| needs-review | 4 | 4 |
| needs-information | 7 | 7 |
| blocked | 0 | 0 |
| 오류 | 0 | 0 |
| 전체 시도 | 18 | 18 |

18개 사례 모두 상태가 같고, 모든 팔의 입력 SHA·실제 입력 SHA·코퍼스·모델·프롬프트·러너·출처 버전·출력 토큰 한도·호출 한도·timeout이 일치한다.
독립 사람 정답 평가나 차단 정확도 점수는 아니다. 잠금 12건은 사용하지 않았다.

| 팔 | 수정 전 성공/오류 | 수정 후 성공/오류 | 각 실행의 제공자 호출 |
| --- | ---: | ---: | ---: |
| A 일반 모델 | 17 / 1 | 17 / 1 | 18 |
| B 법령 조회 전달 | 18 / 0 | 18 / 0 | 18 |
| C 도구·서버 판정 | 18 / 0 | 18 / 0 | 36 |

수정 전 A의 `HYEOB-20261112-005`는 timeout, 수정 후 A의 `HYEOB-20261112-006`은 invalid-model-output이다.
실패를 지우거나 재시도하지 않았다. 전체 명령의 종료 코드는 양쪽 모두 1이며, C 상태표에는 오류 없는 18개 행이 있다.
각 전체 실행은 72회 호출과 중복 없는 요청 ID 72개를 기록했다. 계정 청구량을 뜻하지 않는다.

## 실행과 원시 기록

각 전체 실행 전에 같은 명령에서 `--max-cases 1 --max-calls 5`로 smoke를 수행했다.
양쪽 smoke 모두 1건, 4회 호출, 오류 0, 종료 0이었다.

```sh
RESOURCE_MODEL_RUNNER=subscription RESOURCE_MODEL_ID=gpt-6-sol \
  bun scripts/eval-development.ts \
  --cases data/evaluation/development.json \
  --out data/evaluation/simplify-before \
  --max-cases 18 --max-calls 90 --timeout-ms 60000

RESOURCE_MODEL_RUNNER=subscription RESOURCE_MODEL_ID=gpt-6-sol \
  bun scripts/eval-development.ts \
  --cases data/evaluation/development.json \
  --out data/evaluation/simplify-after \
  --max-cases 18 --max-calls 90 --timeout-ms 60000
```

- [전후 집계·사례별 상태·통제 조건](../data/evaluation/simplify-summary.json)
- [수정 전 18건](../data/evaluation/simplify-before/f34e9651-d6c8-42cc-91a6-16046a1e61eb/)
- [수정 후 18건](../data/evaluation/simplify-after/df09d11d-c4cc-4a92-a6b3-2d424cdf05e7/)
- [수정 전 smoke](../data/evaluation/simplify-before-smoke/97f31a8b-3bc6-41af-8081-361740b5924f/)
- [수정 후 smoke](../data/evaluation/simplify-after-smoke/d0e0952d-7491-4dd3-817a-772d62714116/)

기준선은 `87e04c541408df6c6f3aed14d08548c621de738c`다.
수정 후 실행은 커밋 전 변경 파일을 읽어 시작했으므로 원시 `gitSha`도 기준선이다.
그 실행의 소스 바이트는 이후 변경 없이 `e5d4bbf7c2d6670b3ff61f189770a58ff1903c68`로 커밋했다.
원시 gitSha를 수정하거나 깨끗한 기준선에서 수정 후 실행했다고 주장하지 않는다.
수정 전 프로세스는 편집 전에 모듈을 로드했다. `src/session.ts`는 도메인/확장 함수를 정적으로 가져오며 세션별 파일 탐색 확장을 사용하지 않는다.

## 제거·유지 근거

[심사 기준](rubric-and-demo.md)의 판단 신뢰성은 시행일·인용 위치·위험 차단을 요구하며 무조건 보류를 감점 위험으로 본다.
[추천 목표](recommendation-goal.md)는 실패한 인용을 제외하고 가능한 비교를 유지하도록 구분한다.

| 처리 | 근거와 코드 위치 |
| --- | --- |
| verifiedThrough 만료 차단 제거 | 조회 확인일 경과는 법령 효력 종료와 다르다. 실제 시행기간은 그대로 확인한다 (`src/evidence.ts:145-153`). |
| maxSnapshotAgeDays 수집 경과일 차단 제거 | 동일한 유효 조문이 수집 후 30일 경과만으로 사라지는 것은 추천 근거가 아니다 (`src/evidence.ts:158-198`). |
| 해시·원본·사용권·접근·claimVerified를 라벨로 전환 | 근거 문장과 위치가 있는 인용을 메타데이터 확인 상태만으로 배제하지 않는다. issues와 실행 전 확인사항에 표시한다 (`src/evidence-registry.ts:44-78`, `src/evidence.ts:194-198`, `src/recommendation.ts:13-21`). |
| 전체 법령 issue에 의한 모든 경로 보류 제거 | 문제 인용은 조회에서 제외하고 남은 근거로 판단한다. 필수 경로 근거가 없으면 여전히 추천하지 않는다 (`src/assessment.ts:154-161`, `src/recommendation.ts:32-49`). |
| 보충 검토의 반복 해시·리비전 대조 제거 | 서버가 제공한 검토를 문서 해시/eligibility snapshot/route snapshot으로 반복 대조하지 않는다. 사례 ID와 revision 한 번 및 실제 인용 ID/위치는 남긴다 (`src/assessment.ts:132-180`). |
| 추가 사용권 veto 제거 | 최종 추천 파서와 모델 제안 경로에서 법령 사용권 플래그를 다시 차단하던 중복 검사를 제거했다 (`src/o-decision.ts:47-50`, `src/domain.ts:108-114`, `src/domain.ts:140-148`). |
| 유해 접촉 의심·입력 모순 유지 | 위험한 통과를 막는 판단 신뢰성 기준이다 (`src/recommendation.ts:34-49`, `src/evidence.ts:147`). |
| 법령 시행기간 유지 | 효력이 없는 시행본을 인용하지 않는다 (`src/evidence.ts:149-150`, `src/evidence.ts:163-172`). `stale`은 effectiveTo 만료 진단으로만 남고 수집 경과일에는 사용하지 않는다. |
| 조항 위치·근거 문장 유지 | 인용할 실제 내용이 있어야 추천 근거가 보인다. 등록 출처, 읽을 수 있는 발췌, 원문 안의 인용문 일치도 유지한다 (`src/evidence.ts:151-152`, `src/evidence-registry.ts:36-56`). |
| siteSpecific 제외 유지 | 특정 현장의 자료를 다른 사례의 일반 법령 근거로 쓰지 않는다 (`src/evidence.ts:146`). |
| 사례 revision 유지 | 질량·날짜 등 답변을 바꾼 뒤 예전 검토를 새 사실에 재사용하지 않도록 한다 (`src/assessment.ts:158`). |

별도 계산·업체 자료의 `src/o-validation.ts:60-89` 해시·관측일·사용권 검사는 이번 법령/경로 보충 검토에서 분리했다.
가격·계수·허가 근거의 유효성을 버릴 근거는 확인되지 않았다. 평가 계획도 권리·단위·경계가 검증되지 않은 값을 계산 근거로 쓰지 않도록 명시하므로 그 공유 검증기는 바꾸지 않았다.
사진 전송 동의·사례 소유권·모델 제안과 서버 결과의 일치 검사는 요청한 행정 메타데이터 차단과 목적이 달라 유지했다.

## 코드 검증과 실제 화면

- Bun 1.4.4: `bun test --timeout 30000` → **1050 pass, 0 fail**, 50개 파일.
- `bun run typecheck` → 세 구성 모두 종료 0.
- `bun run build` → 종료 0.
- LSP 진단은 3초 freshness timeout으로 미확인이다. 이를 clean으로 기록하지 않으며 위 저장소 타입 검사를 근거로 삼는다.
- 최초 테스트 실행은 잘못 구성한 신규 음성 대조군과 구조상 잘못된 license fixture를 잡았다. `선별`은 등록 문구의 부분 일치이므로 context-ambiguous를 기대하도록 고쳤고, 사용권 미상은 null로 표현했다. 기능 assertion과 기존 차단 테스트를 삭제하거나 skip하지 않았다.
- 선택적 원본 provenance를 렌더러가 필수 문자열로 받던 TS2345를 타입 검사가 잡아, 원본 ID/해시 미확인을 화면에 그대로 표시하도록 수정했다.

실제 앱을 `PORT=3179 RESOURCE_MODEL_RUNNER=local bun scripts/app.ts`로 띄우고 omowright 소유 브라우저에서 폼을 제출했다.
공통 입력은 사출/PP/오염 없음/100kg/울산/2026-11-25다.
정상 사례는 `기계적 재활용 추천`, 291947 시행본의 원문 발췌 5개, 현장 승인 대기를 표시했다.
유해 접촉 yes와 `PP (라벨 ABS와 불일치)`는 각각 `검토 필요`이며 추천을 표시하지 않았다.
데스크톱과 390×844 모바일 화면에서 빈 출력·겹침·가로 넘침이 없음을 확인했다.
브라우저 UI 증거는 로컬 서버 판정이며, 실제 구독 연결 증거는 위 18건 실행과 구분한다.

로컬 캡처와 로그는 레인 폴더 `../evidence/`의 `browser-results.json`, `normal.png`, `normal-mobile.png`, `hazard.png`, `contradiction.png`, `full-tests-final.log`, `typecheck-final.log`, `build-final.log`에 보존했다.
브라우저를 닫고 전용 프로필을 제거했으며 앱 종료 후 3179 포트 연결 거부를 확인했다.

## 추가 대조: 모든 평가일을 2026-11-25로 고정

리드 요청에 따라 같은 18건의 `assessmentDate`만 2026-11-25로 바꿔 한 번 더 대조했다.
기존 사례의 고정 날짜는 verifiedThrough 만료 전이므로 첫 대조가 이 만료 차단을 실행하지 않았다는 가설을 검사한다.
이것은 별도 날짜 시나리오이며 원래 코퍼스의 7→7 결과를 대체하지 않는다.

| C 서버 상태 | 기준선 87e04c5 | PR 67bf56a |
| --- | ---: | ---: |
| compared | 0 | 7 |
| needs-review | 18 | 4 |
| needs-information | 0 | 7 |
| blocked | 0 | 0 |
| 오류 | 0 | 0 |
| 전체 시도 | 18 | 18 |

추천 산출은 **0% → 38.9% (7/18)**다. 날짜와 무관한 유해 접촉·입력 모순 등으로 보류된 H003/H005/O006/O008 네 사례는 계속 needs-review이며, 정보가 부족한 일곱 사례는 needs-information으로 돌아왔다.
이는 산출 상태 관측으로, 독립 사람 라벨 기반 정확도·위험 탐지 성능을 뜻하지 않는다.
발표일 비교는 변경 묶음의 효과를 보여주며, 수집 후 30일 경과 검사와 verifiedThrough 검사 각각의 독립 효과를 분리한 실험은 아니다.

### 통제와 실행

- 기준선: `87e04c541408df6c6f3aed14d08548c621de738c`의 별도 detached worktree.
- PR: `67bf56a6c8a6bd1add2bf21de861c39d261d93e0`. 양쪽 원시 gitSha가 실제 실행 커밋과 일치한다.
- [공유 manifest](../data/evaluation/simplify-presentation/development.json)와 그 하위 18개 입력을 양쪽에서 그대로 사용했다. manifest SHA는 `9754dfe060db420839750f4c8c1004a78a168739f8c9ee0f17b0a32e8a351c30`이다.
- [날짜 변경 증명](../data/evaluation/simplify-presentation/date-only-changes.json): 원본 JSON에서 assessmentDate 문자열만 교체했고, 모든 다른 필드는 동일하다. manifest의 inputRef/sourceHash만 복사본 경로와 실제 바이트에 맞춰 갱신했다.
- H 입력 10개의 원래 CRLF도 보존했다. 따라서 `git diff --check`는 그 복사본 120행의 CR을 trailing whitespace로 보고한다. 평가 입력 SHA와 날짜 외 바이트 동일성을 보존하기 위해 줄바꿈을 정규화하지 않았으며 그 검사를 통과했다고 주장하지 않는다.
- 팔별로 입력 SHA·실제 입력 SHA·코퍼스·모델·프롬프트·러너·출처 버전·토큰/호출 한도·timeout이 전부 일치한다. 사진 전송은 없다.
- 각각 1건 smoke를 먼저 실행: 기준선 `e0368b1b-2119-4a8e-928c-2ad3773ced47`, PR `b4cc16e5-4451-4118-b357-502f2897330a`. 각각 4회 호출·오류 0·exit 0이며 동일 첫 사례는 needs-review → compared다.
- 이후 양쪽 전체 18건: 각각 A/B/C 54행, 72회 호출, 오류 0, **exit 0**. A/B/C 모두 18/18 성공이다. 실패를 없애기 위한 재시도는 없다.

각 체크아웃에서 같은 명령을 실행하고 출력 디렉터리만 구분했다.

```sh
RESOURCE_MODEL_RUNNER=subscription RESOURCE_MODEL_ID=gpt-6-sol \
  bun scripts/eval-development.ts \
  --cases /home/gunp4ng/working/resource-simplify-20261117/resource-ai/data/evaluation/simplify-presentation/development.json \
  --out /home/gunp4ng/working/resource-simplify-20261117/resource-ai/data/evaluation/simplify-presentation-before \
  --max-cases 18 --max-calls 90 --timeout-ms 60000
```

PR 실행의 `--out`은 `simplify-presentation-after`다. 각 smoke는 같은 입력에 `--max-cases 1 --max-calls 5`, 출력에 `-smoke`를 붙였다.
기존 설치한 잠금 의존성을 공유했고 실행 Bun은 모두 1.4.4다. 평가 이후 기준선 node_modules 링크와 임시 worktree를 제거했다.

- [발표일 전후 집계·통제 조건·사례별 상태](../data/evaluation/simplify-presentation-summary.json)
- [기준선 전체 원시 기록](../data/evaluation/simplify-presentation-before/1845efdf-054d-45fd-9eb6-1443150e50ba/)
- [PR 전체 원시 기록](../data/evaluation/simplify-presentation-after/84f0a096-7379-473e-b0b2-dd6dc8c3631d/)
- [기준선 smoke](../data/evaluation/simplify-presentation-before-smoke/e0368b1b-2119-4a8e-928c-2ad3773ced47/)
- [PR smoke](../data/evaluation/simplify-presentation-after-smoke/b4cc16e5-4451-4118-b357-502f2897330a/)
