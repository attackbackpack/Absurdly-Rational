import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { signSession, verifySession } from "./worker.js";

function makeEnv(overrides = {}) {
  const store = new Map();
  return {
    EDITOR_PASSWORD: "correct-horse-battery-staple",
    SESSION_SECRET: "session-secret-value",
    ALLOWED_ORIGIN: "https://absurdlyrational.com",
    RATE_LIMIT: {
      async get(key) {
        return store.has(key) ? store.get(key) : null;
      },
      async put(key, value) {
        store.set(key, value);
      }
    },
    ...overrides
  };
}

function authRequest(password, ip = "203.0.113.1") {
  return new Request("https://api.example.com/auth", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify({ password })
  });
}

test("a correct password returns a session token", async () => {
  const response = await worker.fetch(authRequest("correct-horse-battery-staple"), makeEnv());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(typeof body.token, "string");
});

test("a wrong password returns 401 and no token", async () => {
  const response = await worker.fetch(authRequest("wrong"), makeEnv());
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.token, undefined);
});

test("the eleventh failed attempt from one IP is rate limited", async () => {
  const env = makeEnv();
  for (let i = 0; i < 10; i += 1) {
    await worker.fetch(authRequest("wrong"), env);
  }
  const response = await worker.fetch(authRequest("wrong"), env);
  assert.equal(response.status, 429);
});

test("rate limiting is tracked per IP", async () => {
  const env = makeEnv();
  for (let i = 0; i < 10; i += 1) {
    await worker.fetch(authRequest("wrong", "203.0.113.1"), env);
  }
  const response = await worker.fetch(authRequest("correct-horse-battery-staple", "198.51.100.7"), env);
  assert.equal(response.status, 200);
});

test("a signed session verifies and a tampered one does not", async () => {
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  const token = await signSession("session-secret-value", expiry);
  assert.equal(await verifySession("session-secret-value", token), true);
  assert.equal(await verifySession("session-secret-value", `${expiry + 1}.${token.split(".")[1]}`), false);
  assert.equal(await verifySession("different-secret", token), false);
});

test("an expired session does not verify", async () => {
  const expiry = Math.floor(Date.now() / 1000) - 1;
  const token = await signSession("session-secret-value", expiry);
  assert.equal(await verifySession("session-secret-value", token), false);
});

test("a preflight request echoes the allowed origin only", async () => {
  const response = await worker.fetch(
    new Request("https://api.example.com/auth", {
      method: "OPTIONS",
      headers: { origin: "https://evil.example" }
    }),
    makeEnv()
  );
  assert.notEqual(response.headers.get("access-control-allow-origin"), "https://evil.example");
});

test("an unknown route returns 404", async () => {
  const response = await worker.fetch(new Request("https://api.example.com/nope"), makeEnv());
  assert.equal(response.status, 404);
});
