import assert from "node:assert/strict";
import { test } from "node:test";
import { createSyntheticResourceApp as createResourceApp } from "./synthetic-runtime.ts";
import { createCaseStore } from "../src/o-case-store.ts";
import { unsupportedScope } from "../src/o-supported-scope.ts";
import originalRows from "../data/evaluation/rubric-followup-20261121/conditional-alternatives/results.json" with { type: "json" };

test("scope boundary recognizes reported nonplastics without guessing unknown or mixed plastic facts", () => {
  for (const polymer of ["유리", "glass", "음식물", "고무", "폐섬유", "오니", "rubber", "sludge"]) {
    assert.ok(unsupportedScope({ polymer, description: "검토용 입력" }), polymer);
  }
  for (const polymer of ["기타 미지원 재질", "폐목재", "금속 스크랩", "종이", "wood", "steel", "포장재", "복합 포장재", "PP", "PA", "PC"]) {
    assert.equal(unsupportedScope({ polymer, description: "검토용 입력" }), null, polymer);
  }
  assert.equal(unsupportedScope({ polymer: null, description: "폐목재 절단 자투리" }), null);
  assert.equal(unsupportedScope({ polymer: null, description: "폐목재가 아닌 미상 재료" }), null);
  assert.equal(unsupportedScope({ polymer: null, description: "not wood, material unknown" }), null);
  assert.equal(unsupportedScope({ polymer: "PET", description: "종이 라벨이 부착됨" }), null);
  assert.equal(unsupportedScope({ polymer: "PP/PE 혼합", description: "재질 확인 필요" }), null);
  assert.equal(unsupportedScope({ polymer: null, description: "미상 발포재" }), null);
  assert.equal(unsupportedScope({ polymer: null, description: "종이 라벨이 붙은 재질 미상의 용기" }), null);
  assert.equal(unsupportedScope({ polymer: "미상", description: "목재 포장에 든 부품" }), null);
  assert.equal(unsupportedScope({ polymer: "알 수 없음", description: "재질 확인 필요" }), null);
  assert.equal(unsupportedScope({ polymer: null, description: "paper label; material unknown" }), null);
  for (const row of originalRows) assert.equal(unsupportedScope(row.input), null, row.caseId);
});

test("out-of-scope app input produces no evaluation or stored case and cannot overwrite a prior decision", async () => {
  const origin = "http://localhost:3000", owner = "actor:scope-test";
  const store = createCaseStore();
  let calls = 0;
  const app = createResourceApp({ origin, actorForRequest: async () => "scope-test", caseStore: store,
    runner: async () => { calls++; return {}; } });
  const post = (path: string, raw: unknown) => new Request(origin + path, {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(raw),
  });
  try {
    const { caseId: _id, ...raw } = originalRows[0]!.input;
    const rejected = await app.fetch(post("/cases", { ...raw, polymer: "유리", description: "폐유리 절단품" }));
    assert.equal(rejected.status, 422);
    assert.match(await rejected.text(), /data-out-of-scope/);
    assert.equal(calls, 0);
    assert.equal(store.list(owner).length, 0);
    const created = await app.fetch(post("/cases", raw));
    assert.equal(created.status, 303);
    const path = created.headers.get("location");
    assert.ok(path);
    const id = path.slice("/cases/".length), before = store.read(owner, id);
    assert.ok(before);
    const beforeCalls = calls;
    const update = await app.fetch(post(path + "/answers", { baseVersion: before.version, patch: { polymer: "glass" } }));
    assert.equal(update.status, 422);
    assert.equal(calls, beforeCalls);
    assert.deepEqual(store.read(owner, id), before);
  } finally { app.dispose(); }
});
