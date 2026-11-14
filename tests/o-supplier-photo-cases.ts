import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { PhotonImage } from "@silvia-odwyer/photon-node";
import { readFile, rename, writeFile } from "node:fs/promises";
import { createOperatorRuntime } from "../src/o-operational-runtime.ts";
import { parseHOperationalConfiguration } from "../src/o-operations-config.ts";
import { revision } from "../src/o-validation.ts";
import { fixture, origin, login, post, response, signal } from "./o-operational-fixtures.ts";
import { hConfiguration, supplierFixture } from "./o-supplier-fixture.ts";

export function registerSupplierPhotoCases() {
  for (const scenario of ["success", "account", "auth-inode", "withdrawal", "expiry", "approval", "stale-ticket"] as const) test(`H shared photo authority final dispatch ${scenario}`, async t => {
    // Given real private photo bytes associated with the native case and an exact renewed grant.
    const f = await fixture(t), h = await supplierFixture(f.root); t.after(() => h.dispose());
    const { authPath: _auth, ...target } = f.config.target;
    const c = parseHOperationalConfiguration({ ...hConfiguration(f.config), permitLifetimeMs: 60000, photos: { enabled: true,
      mappings: [{ target, scope: { provider: target.provider, purpose: f.config.purpose } }] } });
    let calls = 0, input = f.snapshot.input;
    let expireAt: number | undefined, wallTime: number | undefined;
    const wallNow = Date.now, wall = mock.method(Date, "now", () => wallTime ?? wallNow());
    const runtime = await createOperatorRuntime({ ...f, origin, configuration: c, privatePhotos: true,
      backend: { kind: "h-suppliers", open: async context => {
        const bundle = await h.open(context);
        return { ...bundle, privateFileGuard: () => {
          const ready = bundle.privateFileGuard();
          if (expireAt !== undefined) {
            wallTime = expireAt; expireAt = undefined;
          }
          return ready;
        } };
      } }, transport: async () => { calls++; return response(input); } });
    try {
      const cookie = await login(runtime.app), ticket = runtime.authority.current(), photos = runtime.photoStore;
      assert.ok(ticket && photos);
      const image = new PhotonImage(new Uint8Array([255, 0, 0, 255]), 1, 1);
      let bytes: Uint8Array; try { bytes = new Uint8Array(image.get_bytes()); } finally { image.free(); }
      const photo = await photos.put(f.actor.actorId, input.caseId, bytes, "image/png", {
        recordId: "test-only-photo-consent", store: true, model: true, visibleContentReviewed: true,
        modelBindingId: ticket.bindingId, modelScope: ticket.scope, expiresAt: Date.now() + 20000,
      }, signal());
      const owner = `actor:${f.actor.actorId}`, lease = runtime.caseStore.begin(owner, input.caseId, 1);
      try { runtime.caseStore.associate(lease, photo, () => {}); } finally { runtime.caseStore.rollback(lease); }
      const snapshot = runtime.caseStore.read(owner, input.caseId); assert.ok(snapshot);
      input = { ...snapshot.input, photoRefs: [photo.photoRef] };
      const next = parseHOperationalConfiguration({ ...c, approvalId: "explicit-photo-grant", validUntil: Math.min(c.validUntil, Date.now() + 30000),
        grants: [{ actorId: f.actor.actorId, caseId: input.caseId, inputRevision: revision(input), artifactSha256: null }] });
      await runtime.reloadConfiguration(next); assert.equal(runtime.authority.current(), ticket);
      const assertCanTransmit = photos.assertCanTransmit;
      let crossed = false;
      photos.assertCanTransmit = async (...args) => {
        await assertCanTransmit(...args);
        // When H has completed payload/photo validation, change live authority before O's final guard.
        crossed = true;
        if (scenario === "account") await runtime.localAuth.disable("operator");
        if (scenario === "auth-inode") {
          await rename(c.target.authPath, c.target.authPath + ".old");
          await writeFile(c.target.authPath, await readFile(c.target.authPath + ".old"), { mode: 0o600 });
        }
        if (scenario === "withdrawal") runtime.caseStore.withdraw(owner, input.caseId, photo.photoRef, false);
        if (scenario === "stale-ticket") runtime.authority.publish(c.target, c.photos.mappings);
        if (scenario === "expiry" || scenario === "approval") {
          expireAt = scenario === "expiry" ? photo.expiresAt : next.validUntil;
        }
      };
      const result = await runtime.app.fetch(post(f.path + "/answers", cookie, { baseVersion: snapshot.version, patch: { photoRefs: input.photoRefs } }));
      wallTime = undefined; await runtime.settled();
      // Then success transmits the selected bytes once; every revocation sends zero underlying requests.
      assert.equal(crossed, true); assert.equal(calls, scenario === "success" ? 1 : 0);
      assert.equal(result.status, scenario === "success" ? 303 : scenario === "withdrawal" ? 408 : 502);
      const row = h.ledger.query<{ run: string }, []>("SELECT run FROM reservations").get(); assert.ok(row);
      const terminal = h.store.readAudit(row.run).at(-1); assert.equal(terminal?.phase, "finish");
      if (scenario === "success") assert.equal(terminal?.images[0]?.sha256, photo.sha256);
      else {
        assert.deepEqual(runtime.caseStore.read(owner, input.caseId)?.assessment, snapshot.assessment);
        assert.equal(terminal?.usage, null);
      }
      // H conservatively marks wrapper invocation as started even if O's last guard refuses it.
      if (["account", "auth-inode", "expiry", "approval"].includes(scenario)) {
        assert.equal(terminal?.requests[0]?.transportStarted, true); assert.equal(h.count("settlements"), 1);
      }
    } finally { wallTime = undefined; try { await runtime.close(); } finally { wall.mock.restore(); } }
  });
}
