# Default demo source binding and bounded baseline evidence

Work performed on 2026-11-20. Authenticated `/demo/normal` selects original PET `OYS-20261110-001` (fictional 24 kg); its HDPE navigation selects `OYS-20261110-002` (fictional 18 kg). Both the decision and research attachment now use the SAME `source.original`: `createResourceDomain(source.original).decide()` and `buildCaseResearchAttachment`. Presentation stays synthetic, with the configured local runtime retained. The generic `synthetic-case` decision/quote is no longer attached to an authenticated PET/HDPE result. Anonymous and explicit commercial demos retain the original synthetic output and exclude research fields.

The owning test independently derives each original input's domain decision, then compares the rendered heading, recommendation content, execution checks and decision case identity with the actual demo DOM. Before correction it failed with `synthetic-case` / `조건부 비교` versus `OYS-20261110-001` / `기계적 재활용 추천`. After correction the two-material test passed in 15.13 seconds using a temporary 20-second diagnostic window. This is functional wiring evidence, not a claim that the default-timeout suite is green.

Existing serialized recycling values remain PET -13867 KRW / -27.51 kgCO2e and HDPE -5493 KRW / -11.98 kgCO2e. All three routes, missing incineration fee, US WARM boundary, synthetic/unmeasured/reference-price limitations and provenance remain displayed. The parent's four public recycling inquiry rows use separate `data-recycling-directory-row`; the original eight disposal rows retain `data-directory-row`. These are not operational verified ProcessorCandidates or model resources.

## Original lifecycle comparison

Same installed Bun 1.4.4 and the same locked `node_modules`, reused by symlink without installation. Baseline was an owned detached worktree at `fad796cbf2fbaae892add8988f11e7faaecdf266`; current was the shared working tree. Both used separate temporary roots/cache, `RESOURCE_MODEL_RUNNER=local`, `PORT=4853`, and exactly:

```sh
bun test ./tests/app-research.test.ts -t '^committed research uses one atomic report read and only explicit private report includes it$'
```

No timeout option, skip or weakened assertion:

| Tree | Exit | Test result | Bun duration | Wall duration |
| --- | --- | --- | --- | --- |
| Baseline fad796cb | 1 | 0 pass, 1 fail: timed out after 5000 ms | 5.97 s | 6.001383794 s |
| Current | 1 | 0 pass, 1 fail: timed out after 5000 ms | 5.94 s | 5.965400741 s |

Thus the original lifecycle timeout also exists before this worker's changes in the same environment/dependency state. It is unresolved; no passing full-suite claim is made.

Final `bun run typecheck` passed (exit 0); `git diff --check` for the five changed source/test files also passed.

## Bounded SDK import observation

Commands ran from the repository root in owned temporary environments, without opening a model session or calling a provider:

```sh
bun -e 'import {readFile,realpath,stat} from "node:fs/promises"; const p="data/reference/legal/annex4-code.txt"; for(let i=0;i<3;i++){let t=performance.now();await realpath(p);await stat(p);const b=await readFile(p);console.log("PLAIN FS",i,b.length,performance.now()-t);}'
bun -e 'import fs from "node:fs/promises"; import {readdirSync} from "node:fs"; const before={readFile:fs.readFile,realpath:fs.realpath,stat:fs.stat}; console.log("SDK BEFORE",readdirSync("/proc/self/fd").length); await import("@code-yeongyu/senpi"); console.log("SDK AFTER",readdirSync("/proc/self/fd").length,before.readFile===fs.readFile,before.realpath===fs.realpath,before.stat===fs.stat); const p="data/reference/legal/annex4-code.txt"; for(let i=0;i<3;i++){let t=performance.now();await fs.realpath(p);await fs.stat(p);const b=await fs.readFile(p);console.log("SDK FS",i,b.length,performance.now()-t);}'
```

The 283-byte file took 0.645488 / 0.163443 / 0.191804 ms without SDK import, versus 1051.851680 / 3002.874407 / 3003.239534 ms after import; the three API function identities were unchanged. No internal SDK cause is asserted.

The required public-root synchronous `createRequire(import.meta.url)("@code-yeongyu/senpi")` probe exited 1 with `Cannot find module`; the package exposes only an `import` root condition. No resolved/private entry, fallback loader or shim was attempted. Session-only deferral did not remove the indirect eager SDK chain through `photo-execution.ts` → `subscription-configuration.ts`; ALL experimental loading changes were restored. `session.ts`, `extension.ts` and `subscription-configuration.ts` have no worker diff.

Temporary stage logs and filesystem instrumentation were removed. The owned baseline worktree, dependency symlink and temporary roots were removed. No live credentials/provider calls, commit/push, contract/domain changes or visibility changes were made. Parent owns real-browser/login/accessibility proof and subsequent conditional-alternative UI work.
