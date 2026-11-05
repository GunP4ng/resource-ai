# Re:Source AI

중소 제조업체 환경 담당자를 위한 **근거 기반 폐플라스틱 의사결정 지원** 설계와 구현 시작 골격.
AXR AI Bootcamp Innovation Challenger 2026 Microsoft 주제를 대상으로 한다.

**현재 상태: 설계 + 검증된 senpi 등록 골격. 실제 제품 기능은 아직 구현하지 않았다.**
사진 분류, 규정 판정, 업체 매칭, 비용/탄소 계산, 웹 앱과 Azure 실호출은 팀원의 구현 작업이다.

## 추천 구조

작은 사용자 앱 → 하나의 senpi SDK 세션 → Azure OpenAI 모델 + 독립 도메인 도구 → 출처·조건·불확실성이 있는 비교 보고서.
도구는 공식 extension으로도 로딩한다. skill/MCP/Foundry 네이티브 조합을 비교한 뒤 이 구조를 택했다.

## 시작

팀원은 [docs/team-tasks.md](docs/team-tasks.md)부터 읽고 자기 담당 작업을 시작한다.

검증 환경: Linux x64, Bun 1.4.2. senpi의 Node 요구는 >=24다.

```sh
bun install --frozen-lockfile --ignore-scripts
bun run typecheck
bun run build
bun run smoke
```

smoke는 소스와 빌드된 extension을 **실제 senpi loader**로 열고, SDK에서 Azure provider와 명시적 도구 선택을 확인한다. 모델에 프롬프트를 보내지 않아 Azure 키나 유료 호출은 필요하지 않다. 생성한 임시 상태는 종료 시 삭제한다. 사용자 global senpi 설정을 사용하지 않는다.

현재 도구 `resource_project_status`는 `stage=scaffold`, `decisionEngine=not-implemented`를 반환한다. 이것을 제품 데모나 성능 결과로 제시하지 않는다.

도메인 구현을 시작할 때 `src/contracts.ts`부터 합의하고, `data/*.example.json`을 실제 데이터와 구분한다. `.env.example`에는 변수명만 있으며 실제 키를 커밋하지 않는다.

## 읽는 순서

1. [대회 근거와 영상 확인](docs/competition-evidence.md)
2. [대안 비교·권장 아키텍처](docs/architecture.md)
3. [senpi 실제 API·Azure 구성](docs/senpi-and-azure.md)
4. [데이터 출처·비용/탄소 방법](docs/data-sources.md)
5. [30건 평가·개선 기록](docs/evaluation.md)
6. [100점 심사 매핑·발표](docs/rubric-and-demo.md)
7. [역할·일정·작업 목록](docs/delivery-plan.md)
8. [검증·독립 검토 결과](docs/verification.md)

## 범위와 정직한 한계

- 법적 폐기물 코드·유해성은 사진만으로 확정하지 않는다.
- 출처/허가/계수가 부족하면 질문·보류·비교 불가로 표시한다.
- 원가·탄소 수치는 실제 quote/계수·단위·경계가 확보된 경우에만 계산한다.
- 대회 제출 형식·최종 업로드 시각·Azure 크레딧 금액은 운영진/팀 계정 확인이 남아 있다.
- 교육용 가상 데이터 정확도는 현장 재활용 판단의 정확도가 아니다.
- 비공개 저장소다. 교육 영상/자막/로그인 화면·실제 키·개인정보를 업로드하지 않는다.
