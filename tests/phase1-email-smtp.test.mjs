import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setServerDbForTesting } from "../lib/server-db.ts";
import { POST } from "../app/api/email/send/route.ts";
import {
  isBlockedIpAddress,
  isBlockedSmtpHost,
  resolveAndValidateSmtpTarget,
  setDnsLookupForTesting,
  setSmtpTransportFactoryForTesting,
} from "../lib/email-auth.ts";

function makeFakeDb(appConfigData) {
  return {
    collection(name) {
      return {
        doc(id) {
          return {
            async get() {
              if (name === "appConfig" && id === "default" && appConfigData) {
                return { exists: true, data: () => appConfigData };
              }
              return { exists: false, data: () => undefined };
            },
          };
        },
      };
    },
  };
}

function makeReq(headers, body) {
  return new Request("https://play.kavachcricket.com/api/email/send", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("Phase 1 Workstream A: SMTP Credential Isolation & SSRF Protection (/api/email/send)", () => {
  const prevEnv = {};
  let capturedTransportOpts = [];
  let shouldThrowSmtp = false;

  before(() => {
    prevEnv.NODE_ENV = process.env.NODE_ENV;
    prevEnv.KAVACH_TEST_AUTH_BYPASS = process.env.KAVACH_TEST_AUTH_BYPASS;
    prevEnv.SMTP_PASSWORD = process.env.SMTP_PASSWORD;
    process.env.NODE_ENV = "test";
    process.env.KAVACH_TEST_AUTH_BYPASS = "true";
    process.env.SMTP_PASSWORD = "super-secret-smtp-password";

    setSmtpTransportFactoryForTesting((opts) => {
      capturedTransportOpts.push(opts);
      return {
        async sendMail() {
          if (shouldThrowSmtp) {
            throw new Error("AUTH failed for super-secret-smtp-password");
          }
          return { messageId: "mock-msg-1" };
        },
      };
    });
  });

  after(() => {
    setSmtpTransportFactoryForTesting(null);
    setDnsLookupForTesting(null);
    setServerDbForTesting(null);
    process.env.NODE_ENV = prevEnv.NODE_ENV;
    process.env.KAVACH_TEST_AUTH_BYPASS = prevEnv.KAVACH_TEST_AUTH_BYPASS;
    process.env.SMTP_PASSWORD = prevEnv.SMTP_PASSWORD;
  });

  beforeEach(() => {
    capturedTransportOpts = [];
    shouldThrowSmtp = false;
    setDnsLookupForTesting(async (hostname) => {
      if (hostname === "smtp.trusted-club.example") {
        return [{ address: "93.184.216.34", family: 4 }];
      }
      throw new Error("ENOTFOUND");
    });
    setServerDbForTesting(
      makeFakeDb({
        emailProvider: "smtp",
        smtpHost: "smtp.trusted-club.example",
        smtpPort: 587,
        smtpUser: "noreply@kavachcricket.com",
        smtpFrom: "noreply@kavachcricket.com",
      }),
    );
  });

  it("ignores client-supplied config.smtpHost/Port/User for Club Admin and pins validated IP + SNI", async () => {
    const res = await POST(
      makeReq(
        { "x-test-uid": "club1", "x-test-role": "clubAdmin" },
        {
          to: ["player@example.com"],
          subject: "Match Update",
          text: "Ground changed.",
          config: {
            emailProvider: "smtp",
            smtpHost: "evil.attacker.example",
            smtpPort: 2525,
            smtpUser: "attacker",
          },
        },
      ),
    );
    assert.equal(res.status, 200);
    assert.equal(capturedTransportOpts.length, 1);
    assert.equal(capturedTransportOpts[0].host, "93.184.216.34");
    assert.equal(capturedTransportOpts[0].tls.servername, "smtp.trusted-club.example");
    assert.equal(capturedTransportOpts[0].port, 587);
    assert.equal(capturedTransportOpts[0].auth.user, "noreply@kavachcricket.com");
  });

  it("ignores client-supplied config for Super Admin as well", async () => {
    const res = await POST(
      makeReq(
        { "x-test-uid": "super1", "x-test-admin": "true" },
        {
          to: ["admin@example.com"],
          subject: "Test Email",
          text: "Testing SMTP",
          config: {
            emailProvider: "smtp",
            smtpHost: "evil.attacker.example",
            smtpPort: 465,
            smtpUser: "attacker",
          },
        },
      ),
    );
    assert.equal(res.status, 200);
    assert.equal(capturedTransportOpts.length, 1);
    assert.equal(capturedTransportOpts[0].host, "93.184.216.34");
    assert.equal(capturedTransportOpts[0].tls.servername, "smtp.trusted-club.example");
  });

  it("prevents DNS rebinding TOCTOU: transport receives pinned IP, never re-resolves hostname", async () => {
    let calls = 0;
    setDnsLookupForTesting(async () => {
      calls++;
      // If a second lookup happened, it would return loopback
      return calls === 1
        ? [{ address: "93.184.216.34", family: 4 }]
        : [{ address: "127.0.0.1", family: 4 }];
    });
    const res = await POST(
      makeReq(
        { "x-test-uid": "super1", "x-test-admin": "true" },
        { to: ["admin@example.com"], subject: "Test", text: "Body" },
      ),
    );
    assert.equal(res.status, 200);
    assert.equal(calls, 1);
    assert.equal(capturedTransportOpts[0].host, "93.184.216.34");
  });

  it("denies Finance Admin for non-due_reminder emails (even with config)", async () => {
    const res = await POST(
      makeReq(
        { "x-test-uid": "fin1", "x-test-role": "financeAdmin" },
        {
          to: ["player@example.com"],
          subject: "Arbitrary",
          text: "Hello",
          config: { emailProvider: "smtp", smtpHost: "evil.example" },
        },
      ),
    );
    assert.equal(res.status, 403);
    assert.equal(capturedTransportOpts.length, 0);
  });

  it("blocks private IPv4, loopback IPv4/IPv6, link-local, private IPv6, IPv4-mapped IPv6, and alt encodings", () => {
    const blockedIps = [
      "127.0.0.1",
      "10.0.0.5",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "::1",
      "0:0:0:0:0:0:0:1",
      "::",
      "fe80::1",
      "fc00::1",
      "fd12:3456:789a::1",
      "ff02::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "::ffff:169.254.169.254",
      "::ffff:a00:1",
      "0:0:0:0:0:ffff:7f00:1",
      "0:0:0:0:0:ffff:127.0.0.1",
      "0:0:0:0:0:ffff:10.0.0.1",
      "0:0:0:0:0:ffff:a9fe:a9fe",
    ];
    for (const ip of blockedIps) {
      assert.equal(isBlockedIpAddress(ip), true, `Expected IP ${ip} to be blocked`);
    }
    assert.equal(isBlockedIpAddress("93.184.216.34"), false);
    assert.equal(isBlockedIpAddress("2606:2800:220:1:248:1893:25c8:1946"), false);

    for (const host of ["localhost", "0x7f000001", "2130706433", "0177.0.0.1", "127.1", "mail.internal"]) {
      assert.equal(isBlockedSmtpHost(host), true, `Expected host ${host} to be blocked`);
    }
    assert.equal(isBlockedSmtpHost("smtp.resend.com"), false);
  });

  it("rejects public hostname resolving to a private IP or mixed public+private DNS answers", async () => {
    setDnsLookupForTesting(async () => [{ address: "10.0.0.8", family: 4 }]);
    const r1 = await resolveAndValidateSmtpTarget("rebind.example.com");
    assert.equal(r1.ok, false);

    setDnsLookupForTesting(async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "192.168.1.50", family: 4 },
    ]);
    const r2 = await resolveAndValidateSmtpTarget("mixed.example.com");
    assert.equal(r2.ok, false);

    // Also verify end-to-end via POST route
    setServerDbForTesting(
      makeFakeDb({
        emailProvider: "smtp",
        smtpHost: "mixed.example.com",
        smtpPort: 587,
        smtpUser: "noreply@kavachcricket.com",
      }),
    );
    const res = await POST(
      makeReq(
        { "x-test-uid": "super1", "x-test-admin": "true" },
        { to: ["admin@example.com"], subject: "Test", text: "Body" },
      ),
    );
    assert.equal(res.status, 400);
    assert.equal(capturedTransportOpts.length, 0);
  });

  it("fails safely with HTTP 400 when DNS resolution fails (ENOTFOUND) without attempting SMTP or leaking secrets", async () => {
    setDnsLookupForTesting(async () => {
      throw Object.assign(new Error("getaddrinfo ENOTFOUND non-existent.example"), { code: "ENOTFOUND" });
    });
    setServerDbForTesting(
      makeFakeDb({
        emailProvider: "smtp",
        smtpHost: "non-existent.example",
        smtpPort: 587,
        smtpUser: "noreply@kavachcricket.com",
      }),
    );
    const res = await POST(
      makeReq(
        { "x-test-uid": "super1", "x-test-admin": "true" },
        { to: ["admin@example.com"], subject: "Test", text: "Body" },
      ),
    );
    assert.equal(res.status, 400);
    assert.equal(capturedTransportOpts.length, 0);
    const bodyText = await res.text();
    assert.equal(bodyText.includes("super-secret-smtp-password"), false);
    assert.equal(bodyText.includes("getaddrinfo"), false);
    assert.equal(bodyText.includes("ENOTFOUND"), false);
  });

  it("fails safely with HTTP 500 when SMTP config is missing", async () => {
    setServerDbForTesting(makeFakeDb({ emailProvider: "smtp" }));
    const res = await POST(
      makeReq(
        { "x-test-uid": "super1", "x-test-admin": "true" },
        { to: ["admin@example.com"], subject: "Test", text: "Body" },
      ),
    );
    assert.equal(res.status, 500);
    const data = await res.json();
    assert.equal(data.success, false);
  });

  it("returns HTTP 500 (not 200) on SMTP failure and never leaks secrets or raw exception text", async () => {
    shouldThrowSmtp = true;
    const res = await POST(
      makeReq(
        { "x-test-uid": "super1", "x-test-admin": "true" },
        { to: ["admin@example.com"], subject: "Test", text: "Body" },
      ),
    );
    assert.equal(res.status, 500);
    const bodyText = await res.text();
    assert.equal(bodyText.includes("super-secret-smtp-password"), false);
    assert.equal(bodyText.includes("AUTH failed"), false);
  });
});
