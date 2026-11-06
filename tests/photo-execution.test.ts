import assert from "node:assert/strict";
import { test } from "node:test";
import { createPhotoExecutionAuthority, matchesPhotoConsent } from "../src/photo-execution.ts";

const target = { endpoint: "https://synthetic.openai.azure.com", deployment: "synthetic-a", modelId: "gpt-4.1", apiVersion: "v1" };
const config = { ...target, apiKey: "synthetic-secret" };
const scope = { provider: "synthetic provider", purpose: "synthetic purpose" };
const mapping = [{ target, scope }];

test("only exact unambiguous explicit mappings issue immutable identity-checked tickets", () => {
  const authority = createPhotoExecutionAuthority();
  assert.equal(authority.current(), null);
  for (const mappings of [[], [mapping[0]!, mapping[0]!], [{ target, scope: { ...scope, purpose: " " } }],
    ...(["endpoint", "deployment", "modelId", "apiVersion"] as const).map(key => [{ target: { ...target, [key]: "different" }, scope }])]) {
    authority.publish(config, mappings); assert.equal(authority.current(), null);
  }
  authority.publish(config, mapping);
  const ticket = authority.current()!;
  assert.ok(ticket); assert.ok(Object.isFrozen(ticket)); assert.ok(Object.isFrozen(ticket.target)); assert.ok(Object.isFrozen(ticket.scope));
  assert.equal(JSON.stringify(ticket).includes(config.apiKey), false);
  authority.assertCurrent(ticket);
  assert.throws(() => authority.assertCurrent({ ...ticket }));
  const other = createPhotoExecutionAuthority(); other.publish(config, mapping);
  assert.throws(() => other.assertCurrent(ticket));
  const consent = { model: true, visibleContentReviewed: true, modelScope: scope, modelBindingId: ticket.bindingId };
  assert.equal(matchesPhotoConsent(consent, ticket), true);
  for (const changed of [{ modelScope: undefined }, { modelBindingId: undefined }, { modelBindingId: "wrong" },
    { modelScope: { ...scope, provider: "other" } }, { modelScope: { ...scope, purpose: "other" } }]) {
    assert.equal(matchesPhotoConsent({ ...consent, ...changed }, ticket), false);
  }
});

test("atomic publication separates credential generation from consent binding and prevents ABA reuse", () => {
  const authority = createPhotoExecutionAuthority(); authority.publish(config, mapping);
  const first = authority.current()!;
  authority.publish({ ...config, apiKey: "rotated-synthetic-secret" }, mapping);
  const rotated = authority.current()!;
  assert.equal(rotated.bindingId, first.bindingId); assert.notEqual(rotated.generation, first.generation);
  assert.throws(() => authority.configuration(first));
  assert.equal(authority.configuration(rotated).apiKey, "rotated-synthetic-secret");
  assert.throws(() => authority.publish({ ...config, endpoint: "https://invalid.example" }, mapping));
  assert.equal(authority.current(), rotated);
  for (const changed of [{ ...target, deployment: "synthetic-b" }, target]) {
    authority.publish({ ...changed, apiKey: "synthetic-key" }, [{ target: changed, scope }]);
    assert.notEqual(authority.current()!.bindingId, first.bindingId);
  }
  assert.throws(() => authority.assertCurrent(rotated));
  const before = authority.current()!;
  authority.publish(config, [{ target, scope: { ...scope, purpose: "changed purpose" } }]);
  assert.notEqual(authority.current()!.bindingId, before.bindingId);
  authority.publish(config); assert.equal(authority.current(), null);
  authority.publish(config, mapping); assert.notEqual(authority.current()!.bindingId, before.bindingId);
});
