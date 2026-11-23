/**
 * R1 — client ID-token refresh-on-401 (tests/r1-id-token-fetch.test.mjs)
 * Imports production lib/id-token-fetch.ts; only fetch and the token source are stubbed.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchWithIdToken, SessionEndedError } from "../lib/id-token-fetch.ts";

function tokenSource({ refreshFails = false } = {}) {
  const calls = [];
  return {
    calls,
    async getIdToken(force = false) {
      calls.push(force);
      if (force && refreshFails) throw Object.assign(new Error("refresh refused"), { code: "auth/user-token-expired" });
      return force ? "fresh-token" : "cached-token";
    },
  };
}

function recordingFetch(statuses) {
  const sent = [];
  const impl = async (_input, init) => {
    sent.push({ auth: new Headers(init.headers).get("Authorization"), body: init.body, method: init.method });
    return new Response("{}", { status: statuses[sent.length - 1] ?? 200 });
  };
  return { sent, impl };
}

describe("R1: fetchWithIdToken", () => {
  it("success on first try: one request, no forced refresh", async () => {
    const user = tokenSource();
    const f = recordingFetch([200]);
    const res = await fetchWithIdToken(user, "/api/x", { method: "POST" }, f.impl);
    assert.equal(res.status, 200);
    assert.deepEqual(user.calls, [false]);
    assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0].auth, "Bearer cached-token");
  });

  it("401 with a still-valid session: refreshes once and the retry succeeds with the same body", async () => {
    const user = tokenSource();
    const f = recordingFetch([401, 200]);
    const body = JSON.stringify({ playerId: "p1" });
    const res = await fetchWithIdToken(user, "/api/x", { method: "POST", body }, f.impl);
    assert.equal(res.status, 200);
    assert.deepEqual(user.calls, [false, true]);
    assert.equal(f.sent.length, 2);
    assert.equal(f.sent[1].auth, "Bearer fresh-token");
    assert.equal(f.sent[1].body, body);
    assert.equal(f.sent[1].method, "POST");
  });

  it("401 and the refresh is refused (revoked/disabled/deleted): throws SessionEndedError, no second request", async () => {
    const user = tokenSource({ refreshFails: true });
    const f = recordingFetch([401]);
    await assert.rejects(fetchWithIdToken(user, "/api/x", {}, f.impl), (err) => {
      assert.ok(err instanceof SessionEndedError);
      assert.match(err.message, /sign in again/i);
      return true;
    });
    assert.equal(f.sent.length, 1);
  });

  it("retries at most once: a second 401 is returned to the caller", async () => {
    const user = tokenSource();
    const f = recordingFetch([401, 401]);
    const res = await fetchWithIdToken(user, "/api/x", {}, f.impl);
    assert.equal(res.status, 401);
    assert.equal(f.sent.length, 2);
  });

  it("non-401 errors (403, 503) are not retried", async () => {
    for (const status of [403, 503]) {
      const user = tokenSource();
      const f = recordingFetch([status]);
      const res = await fetchWithIdToken(user, "/api/x", {}, f.impl);
      assert.equal(res.status, status);
      assert.equal(f.sent.length, 1);
      assert.deepEqual(user.calls, [false]);
    }
  });

  it("caller headers are preserved and Authorization is set by the helper", async () => {
    const user = tokenSource();
    const f = recordingFetch([200]);
    let seen;
    await fetchWithIdToken(user, "/api/x", { headers: { "Content-Type": "application/json", Authorization: "Bearer forged" } }, async (_i, init) => {
      seen = new Headers(init.headers);
      return new Response("{}", { status: 200 });
    });
    assert.equal(seen.get("Content-Type"), "application/json");
    assert.equal(seen.get("Authorization"), "Bearer cached-token");
  });
});
