import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setServerDbForTesting } from "../lib/server-db.ts";
import { POST } from "../app/api/email/send/route.ts";
import { isBlockedSmtpHost, setSmtpTransportFactoryForTesting } from "../lib/email-auth.ts";

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

describe("Phase 1 Workstream A: SMTP Credential Isolation (/api/email/send)", () => {
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
    setServerDbForTesting(null);
    process.env.NODE_ENV = prevEnv.NODE_ENV;
    process.env.KAVACH_TEST_AUTH_BYPASS = prevEnv.KAVACH_TEST_AUTH_BYPASS;
    process.env.SMTP_PASSWORD = prevEnv.SMTP_PASSWORD;
  });

  beforeEach(() => {
    capturedTransportOpts = [];
    shouldThrowSmtp = false;
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

  it("ignores client-supplied config.smtpHost/Port/User for Club Admin and uses trusted appConfig", async () => {
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
    assert.equal(capturedTransportOpts[0].host, "smtp.trusted-club.example");
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
    assert.equal(capturedTransportOpts[0].host, "smtp.trusted-club.example");
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

  it("rejects private/loopback SMTP hosts to prevent SSRF", () => {
    assert.equal(isBlockedSmtpHost("127.0.0.1"), true);
    assert.equal(isBlockedSmtpHost("localhost"), true);
    assert.equal(isBlockedSmtpHost("169.254.169.254"), true);
    assert.equal(isBlockedSmtpHost("10.0.0.5"), true);
    assert.equal(isBlockedSmtpHost("192.168.1.1"), true);
    assert.equal(isBlockedSmtpHost("smtp.resend.com"), false);
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
