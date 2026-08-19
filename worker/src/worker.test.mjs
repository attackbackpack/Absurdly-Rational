import { test, mock } from "node:test";
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

// makeEnv spreads overrides over its defaults, so passing e.g.
// {EDITOR_PASSWORD: undefined} would still leave the key present (with an
// undefined value). To faithfully simulate a secret that was never set on
// the deployment, delete the key from the built env instead of overriding it.
function envWithout(name) {
  const env = makeEnv();
  delete env[name];
  return env;
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

test("a correct-looking password with EDITOR_PASSWORD absent from env returns 500 and no token", async () => {
  const response = await worker.fetch(
    authRequest("correct-horse-battery-staple"),
    envWithout("EDITOR_PASSWORD")
  );
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.token, undefined);
  assert.doesNotMatch(body.error, /EDITOR_PASSWORD/);
});

test("an empty-string password with EDITOR_PASSWORD absent from env returns 500 and no token", async () => {
  const response = await worker.fetch(authRequest(""), envWithout("EDITOR_PASSWORD"));
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.token, undefined);
});

test("a correct password with SESSION_SECRET absent from env returns 500 rather than authenticating", async () => {
  const response = await worker.fetch(
    authRequest("correct-horse-battery-staple"),
    envWithout("SESSION_SECRET")
  );
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.token, undefined);
  assert.doesNotMatch(body.error, /SESSION_SECRET/);
});

const PKCS8_TEST_KEY = "-----BEGIN PRIVATE KEY-----\nMIIBVQIBADANBg\n-----END PRIVATE KEY-----";

function githubEnv(overrides = {}) {
  return makeEnv({
    GITHUB_APP_ID: "123456",
    GITHUB_APP_PRIVATE_KEY: PKCS8_TEST_KEY,
    GITHUB_INSTALLATION_ID: "7891011",
    GITHUB_REPO: "attackbackpack/Absurdly-Rational",
    ...overrides
  });
}

async function bearer(env) {
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  return `Bearer ${await signSession(env.SESSION_SECRET, expiry)}`;
}

// GitHub's Contents API returns base64 of the file's raw UTF-8 bytes. btoa()
// can only encode Latin-1 strings, so test fixtures that contain non-ASCII
// characters (e.g. typographic punctuation) must be UTF-8 encoded to bytes
// first, mirroring what GitHub actually sends.
function toBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

test("GET /content without a token returns 401", async () => {
  const response = await worker.fetch(
    new Request("https://api.example.com/content"),
    githubEnv()
  );
  assert.equal(response.status, 401);
});

test("GET /content returns site.json and the branch head sha", async () => {
  const env = githubEnv();
  env.__installationToken = "ghs_test";
  const siteJson = JSON.stringify({ home: { hero: { thesis: "hi" } } });
  mock.method(globalThis, "fetch", async (input) => {
    const url = String(input.url ?? input);
    if (url.includes("/git/ref/heads/editor")) {
      return new Response(JSON.stringify({ object: { sha: "abc123" } }), { status: 200 });
    }
    if (url.includes("/contents/_data/site.json")) {
      return new Response(
        JSON.stringify({ content: btoa(siteJson), encoding: "base64" }),
        { status: 200 }
      );
    }
    throw new Error(`unexpected fetch to ${url}`);
  });

  const response = await worker.fetch(
    new Request("https://api.example.com/content", {
      headers: { authorization: await bearer(env) }
    }),
    env
  );
  mock.restoreAll();

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.baseCommitSha, "abc123");
  assert.equal(body.site.home.hero.thesis, "hi");
});

test("GET /content correctly decodes non-ASCII characters in site.json", async () => {
  const env = githubEnv();
  env.__installationToken = "ghs_test";
  const thesis = "It’s the site — reimagined.";
  const siteJson = JSON.stringify({ home: { hero: { thesis } } });
  mock.method(globalThis, "fetch", async (input) => {
    const url = String(input.url ?? input);
    if (url.includes("/git/ref/heads/editor")) {
      return new Response(JSON.stringify({ object: { sha: "def456" } }), { status: 200 });
    }
    if (url.includes("/contents/_data/site.json")) {
      return new Response(
        JSON.stringify({ content: toBase64Utf8(siteJson), encoding: "base64" }),
        { status: 200 }
      );
    }
    throw new Error(`unexpected fetch to ${url}`);
  });

  const response = await worker.fetch(
    new Request("https://api.example.com/content", {
      headers: { authorization: await bearer(env) }
    }),
    env
  );
  mock.restoreAll();

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.site.home.hero.thesis, thesis);
});

test("GET /content surfaces a GitHub failure as 502", async () => {
  const env = githubEnv();
  env.__installationToken = "ghs_test";
  mock.method(globalThis, "fetch", async () => new Response("boom", { status: 500 }));
  const response = await worker.fetch(
    new Request("https://api.example.com/content", {
      headers: { authorization: await bearer(env) }
    }),
    env
  );
  mock.restoreAll();
  assert.equal(response.status, 502);
});

test("GET /content with a missing GitHub secret returns 500, not 502", async () => {
  const env = githubEnv();
  delete env.GITHUB_APP_ID;
  const response = await worker.fetch(
    new Request("https://api.example.com/content", {
      headers: { authorization: await bearer(env) }
    }),
    env
  );
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.doesNotMatch(body.error, /GITHUB_APP_ID/);
});
