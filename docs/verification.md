# 검증 기록

2026-11-05, Linux x64 / Bun 1.4.2. 이 기록은 설계·골격 검증이며 제품 성능 인증이 아니다.

## 실행 결과

```text
bun install --ignore-scripts
245 packages installed
exit 0

bun install --frozen-lockfile --ignore-scripts
Checked 271 installs across 296 packages (no changes)
exit 0

bun run typecheck && bun run build && bun run smoke
EXTENSION_LOAD_PASS src/extension.ts
EXTENSION_LOAD_PASS dist/extension.js
SDK_SELECTION_PASS azure-openai-responses resource_project_status
SCAFFOLD_ONLY no prompt sent; Azure connectivity and domain behavior untested
OWNED_SMOKE_RESOURCES_REMOVED
exit 0
```

최종 코드에서 비용/탄소 단위를 타입으로 분리하고 smoke의 초기 디렉터리 생성도 cleanup try 범위에 넣은 후 위 전체 명령을 다시 통과했다.

실제 senpi extension loader가 source와 bundle을 모두 로딩했고 SDK가 선택한 provider/tool 목록을 확인했다. 모델에 prompt를 보내지 않았고 Azure 서비스 연결·이미지 인식·법적 판단·업체 매칭·비용/탄소 계산은 미구현·미검증이다.

저장소가 새로 생성되어 기존 제품 테스트는 없었다. 실제 loader/SDK smoke가 이번 골격의 재현 가능한 통합 확인이다. 향후 도메인 구현 PR은 `docs/evaluation.md`의 실물 시나리오와 관련 테스트를 추가해야 한다.

## 타입 도구 한계

LSP 진단 도구는 `typescript-language-server` 및 `biome` 미설치로 실행되지 않았다. 이를 “LSP clean”이라고 표시하지 않는다. 대신 프로젝트의 실제 TypeScript compiler가 `strict`, `skipLibCheck:false` 설정으로 전체 소스/스크립트를 확인하여 종료 0을 반환했다.

패키지 연구에서 발견된 NodeNext/추가 optional-property 설정 호환성 문제는 `docs/senpi-and-azure.md`에 공개했다. 의존성 선언 수정·오류 무시·테스트 skip은 하지 않았다.

## 자료 확인과 정리

AXR 작업 전용 탭을 닫은 후 CDP 목록에서 해당 target 없음과 원래 OT 탭 존재를 확인했다. 소유자 탭·쿠키·프로필은 건드리지 않았다. 대용량 영상은 내려받지 않았고 제공 자막·썸네일을 로컬 검토에 사용했다.

클라우드 리소스 생성, 유료 모델 호출, 운영진 연락, 제품 배포는 하지 않았다. 생성한 GitHub private repo와 승인된 collaborator 초대만 외부 변경이다.

## 독립 설계 검토

독립 리뷰의 최초 판정은 REQUEST CHANGES, 설계 준비도 80/100이었다. 계산 계약 공백(B1)과 잠금 평가 절차 충돌(B2)을 반영한 뒤 타입체크·빌드·실제 loader/SDK smoke가 다시 종료 0을 반환했다. 순수 문서의 평가 절차는 리드가 교차 검토했다. [반영 기록](review-disposition.md)에 차단 사항과 비차단 메모 처리, 독립 재승인을 받지 않았다는 한계를 적었다. 실제 제품 점수는 없다.

## 2026-11-06 O4 local input/correction integration

Bun 1.4.2; branch `feat/oyeonseok-o4-input-questions`, base
`b2ca2c427e1da7570907a4bf8192de4885eb99e1`.
Packaging and the test correction are complete. **Astra final review: APPROVE**
(`gpt-6-astra`, xhigh; full diff and all 42 full-page captures).
Scope and remaining integration limits: [O4 handoff](o-handoff.md#o4-local-h-integration--2026-11-06).

| Reproduction command/check | Observed result and evidence |
| --- | --- |
| `bun test` | Latest corrected suite: **298 pass / 0 fail**, 11 files, 6.42 s; `/tmp/resource-ai-o4-final-tests.log`. Includes actual source and packaged launchers after fresh build/asset staging. |
| `bun run typecheck` | Passed after the latest test correction. Earlier project and `bun run typecheck:o-tests` checks also passed. |
| `bun run build`, `bun run build:app`, `bun run smoke` | Both builds and official offline smoke passed in `/tmp/resource-ai-o4-final-checks.log` before packaging/test correction, with unchanged application source. Final app build and asset staging also passed, including within the latest launcher regression. Smoke sent no prompt and does not verify Azure. |
| Manifest inventory/SHA-256 check (`node --input-type=module` assertions) | Exactly 14 staged assets matched manifest hashes. |
| `check-test-junk.ts tests/app.test.ts tests/report.test.ts`; packaging follow-up on `tests/app.test.ts` | Exit 0, no findings. |
| Optional `check-no-excuse-rules.ts`, bounded to 20 seconds | Timed out, exit 124 without diagnostics; **not a pass**. LSP/linter unavailable. |

The launcher regression clears stale `dist/data`, builds/stages once, then runs
`scripts/app.ts` and `dist/app/app.js` from unrelated temporary directories.
Both pass native submission → polymer + mass questions → mass only after
polymer correction → needs-review after numeric mass correction, preserving
the case ID and correction form. Both reject `snapshot-unavailable`, serve
form-free printable reports and exit 0 on SIGTERM. Distribution requires
`dist/app/` plus sibling `dist/data/` and external package dependencies.

Failed-first record: `/tmp/resource-ai-o4-red.log` contains 28 pass / 15 fail:
14 behavior regressions plus one environment listener failure before launcher
spawn. The final test expectation asserts H's instructional list item once and
excludes it when comparing missing-fact questions. All tests remain enabled,
including the 21 added instances. Earlier sandbox listener failures are
historical; the latest actual launcher regression passes.

Actual browser/HTTP evidence is under `/tmp/resource-ai-o4-qa-vqI0QI/`:

| Check | Evidence/result |
| --- | --- |
| Packaged launcher after restart | `bundle-fixed.json`, `packaged-questions-mobile.png`: needs-information, polymer + mass, no `snapshot-unavailable`. Original missing-asset failure: `bundle-initial.html`. |
| Native corrections/currentness | `question-refresh-partial.json`, `currentness-after.json`: partial question reduction, same-case review and November 6 currentness hold; corrections remain available. |
| HTTP boundaries | `http-isolation.json`: cross-session GET/report/answer 404, foreign Origin 403, invalid answer 400. |
| Occupied-port launcher | Exit 1, static startup message; `/tmp/resource-ai-o4-bind-failure.log`. |
| Seven states × 390/1440/1920px × light/dark | 42 combinations: zero detector errors/warnings, no horizontal overflow; `*-after-checks.json` and matching captures. |
| 320px expanded text spacing; keyboard focus | `reflow.json`, `focus.json` and screenshots: no overflow, controls at least 44px tall, visible 2px submit focus outline. |
| Synthetic comparison correction | `compared-after.json`, `stale-comparison-after.json`: QA-only comparison loses its prior total and returns to review after correction. |

`qa-summary.md` explains capture setup and evidence. Detector advisories include
an uninstalled script-error probe and mobile heading wrapping. Astra confirmed
the heading behavior in the baseline captures and found no new blocking
readability defect. Two long mobile comparison images reach the capture height
limit; their bottom captures provide the remaining evidence. No Lighthouse
audit or comprehensive WCAG certification is claimed.

No actual Azure/model calls, operational resources or H/J/shared/dependency
changes. November 6 remains currentness-held; synthetic comparisons establish
QA behavior only. Live Azure, reviewed operational supplements and refreshed
legal coverage remain unverified. The final review retains a nonblocking note
about the launcher's exact H guidance expectation:
`/tmp/resource-ai-o4-astra-final-review.txt`. Draft guard: both changed screen
files clean. Owned QA browsers, profiles and servers were cleaned up.
