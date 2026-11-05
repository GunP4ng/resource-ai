# senpi 확장 계약과 Azure 구성

## 고정 버전과 근거

2026-11-05 npm registry의 latest를 직접 재확인하여 `@code-yeongyu/senpi`를 **2026.11.4-2**로 고정했다. 이 버전은 2026-11-04T17:59:56.711Z 게시되었다. 실행 요구 Node >=24, 이번 검증 런타임 Bun 1.4.2.

출처:
- https://registry.npmjs.org/@code-yeongyu%2fsenpi/2026.11.4-2
- https://registry.npmjs.org/@code-yeongyu/senpi/-/senpi-2026.11.4-2.tgz
- https://registry.npmjs.org/@code-yeongyu/senpi-ai/-/senpi-ai-2026.11.4-2.tgz

아래 `S/`는 해당 senpi tarball root, `A/`는 동일 버전 senpi-ai root다. `node_modules/@code-yeongyu/senpi/`에서도 같은 파일을 읽을 수 있다.

| 계약 | 실제 패키지 파일 |
|---|---|
| root의 `ExtensionAPI`, `defineTool`, SDK exports | `S/dist/index.d.ts:18–19,28–35` |
| default factory `(pi: ExtensionAPI) => void \| Promise<void>` | `S/dist/core/extensions/types.d.ts:2615` |
| tool 정의와 execute 인자 | 같은 파일 `:952–1094` |
| `pi.registerTool` | 같은 파일 `:2169` |
| default export가 함수인지 검증·실행 | `S/dist/core/extensions/loader.js:836–899` |
| SDK `customTools`, `tools`, `resourceLoader` | `S/dist/core/sdk.d.ts:18–90` |
| inline extension factory와 발견 제어 | `S/dist/core/resource-loader.d.ts:87–110` |
| `pi` 리소스 manifest | `S/docs/packages.md:119–135,177–197` |
| MCP client 구성 | `S/docs/mcp.md:1–75` |

`src/extension.ts`는 실제 default factory와 `defineTool`을 사용한다. `resource_project_status`는 개발 준비 상태만 반환하며 폐기물 판정을 가장하지 않는다. `skills/resource-workflow/SKILL.md`는 절차 설명이고 권한/법적 판단의 집행 장치가 아니다.

도구 구현 시 실제 서명은 다음과 같다. 단순히 `(args, context)`라고 추측하지 않는다.

```ts
execute(toolCallId, params, signal, onUpdate, ctx)
```

결과에는 `content`와 `details`가 있다. 별도 `outputSchema`를 선언하면 맞는 `structuredContent`도 제공해야 한다. 현재 골격은 그 계약을 선언하지 않는다.

## SDK로 앱을 감싸는 방법

`scripts/smoke.ts`가 실제 생성 예다. 앱은 자체 `agentDir`를 갖고 `ModelRuntime.create`, `DefaultResourceLoader`, `createAgentSession`, `SessionManager.inMemory()`를 조합한다. `customTools`로 동일 도구 정의를 주입하고 `tools`로 활성 목록을 명시한다.

smoke는 **모델 호출 없이** 실제 소스·빌드된 extension 로딩과 SDK 모델/도구 선택을 확인한다. 앱 구현자는 이후 이벤트를 구독한 뒤 `session.prompt(...)`를 호출하고 취소·timeout·기록·dispose를 구현해야 한다. 이 함수 호출은 유료 inference일 수 있으므로 현재 smoke는 실행하지 않는다.

`noExtensions:true`는 사용자 확장 발견을 제한하지만 내장 factory까지 제거하지 않는다(`resource-loader.js:289–301`). 허용 목록 자체는 sandbox가 아니다. 일반 코딩 도구 비노출, 앱 전용 설정, OS 최소권한, host 경계 검증을 함께 구현한다.

## Azure 모델 공급자

실제 provider ID는 `azure-openai-responses`이다. `A/dist/providers/azure-openai-responses.js:5–12`, `A/dist/api/azure-openai-responses.js:14–38,145–209,230–238`에서 다음을 확인했다.

- `AZURE_OPENAI_API_KEY`: 서버 비밀값.
- `AZURE_OPENAI_BASE_URL`: Azure OpenAI resource root.
- 또는 `AZURE_OPENAI_RESOURCE_NAME`: resource 이름.
- `AZURE_OPENAI_DEPLOYMENT_NAME_MAP`: `모델ID=실제배포명`. 카탈로그 `gpt-4.1`은 해당 tenant에 배포가 있다는 보장이 아니다.
- `AZURE_OPENAI_API_VERSION`: 구현 기본값 `v1`. 패키지 guide의 오래된 `2024-02-01` 예제를 복사하지 않는다.
- 실제 호출은 `AzureOpenAI`의 `responses.create`, 인식된 resource root에 `/openai/v1` 추가, 요청 `store:false`.

예시(실제 값은 `.env` 또는 서버 secret store):

```sh
export AZURE_OPENAI_BASE_URL='https://YOUR-RESOURCE.openai.azure.com'
export AZURE_OPENAI_DEPLOYMENT_NAME_MAP='gpt-4.1=YOUR-DEPLOYMENT'
export AZURE_OPENAI_API_KEY='YOUR-SERVER-SECRET'
```

이 예시를 그대로 실행하면 연결되지 않는다. 실제 resource/배포/키는 팀 계정에서 확인해야 한다. 제공 Azure 권한, 모델의 이미지/tool 지원, 지역, quota, 비용 상한을 먼저 검증한다.

**지원 경계:** 이 버전의 검증된 경로는 API key 인증이다. managed identity/Entra 자동 인증을 구현했다고 주장하지 않는다. `.services.ai.azure.com/api/projects/...` Foundry project endpoint를 OpenAI resource URL 대신 넣는 것도 검증되지 않았다.

## Foundry와 혼동하지 않기

Azure OpenAI 모델을 senpi에서 호출하는 것과 Foundry Agent Service에 agent를 생성하는 것은 다르다. 후자는 관리형 상태·도구·인증·배포 수명주기를 추가로 설계해야 한다.

공식 자료:
- Responses: https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/responses
- Agent Service: https://learn.microsoft.com/en-us/azure/foundry/agents/overview
- 관측: https://learn.microsoft.com/en-us/azure/foundry/observability/concepts/trace-agent-concept

심사에는 실제 Azure resource/배포명, 요청 추적·사용량과 결과를 보여준다. 로컬 senpi 로그가 자동으로 Foundry portal trace가 되는 것은 아니다. Application Insights 연계는 선택적 후속 구현이며 비용/개인정보 정책을 확인한다.

## 타입체크 호환성과 검증 한계

현재 `strict`, `noUncheckedIndexedAccess`, `skipLibCheck:false`, Bundler 해석을 사용한다. 패키지 연구에서 NodeNext + `exactOptionalPropertyTypes` 조합은 upstream 선언에서 47개 진단을 냈다: AuthStorage의 optional method, MCP OAuth metadata, provider JSON import attribute 문제. 해당 의존성 코드를 수정하거나 `skipLibCheck`로 숨기지 않았다. 지원하지 않는 설정을 지원한다고 광고하지 않는다.

`bun install --ignore-scripts`에서 기본 import·loader·SDK smoke는 동작했다. native PTY/이미지 변환/브라우저 기능까지 검증했다는 의미는 아니다.

라이선스는 패키지 metadata의 MIT 선언을 확인했지만 전체 transitive license audit는 하지 않았다. 프레임워크 라이선스는 데이터/모델/교육자료 재배포 권한과 별개다.

## 팀의 첫 Azure 통합 검증

1. 서버에서 실제 resource/배포/모델 권한을 확인한다. 비밀값은 출력하지 않는다.
2. 허용된 소액 예산 안에서 텍스트 1회, 이미지 1회, 도구 호출 1회를 각각 실제 요청한다.
3. 성공 응답·실제 deployment·request ID·사용량과 실패 응답을 저장한다.
4. 키 누락/잘못된 배포/429/timeout/취소에서 오류를 사용자에게 정직하게 보여준다.
5. 앱의 케이스 상태와 로그를 분리하고 요청 종료 시 session을 dispose한다.

현재 단계에서는 Azure 실호출·제품 E2E·분류 정확도·탄소 감축을 검증하지 않았다.
