import { test, mock } from "node:test";
import assert from "node:assert/strict";
import worker, { signSession, verifySession, isAllowedPath } from "./worker.js";

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
    if (
      url.includes("/contents/_data/readings.json") ||
      url.includes("/contents/_data/podcasts.json") ||
      url.includes("/contents/_data/memes.json")
    ) {
      return new Response(JSON.stringify({ content: btoa("{}"), encoding: "base64" }), { status: 200 });
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
  assert.equal(body.files.site.home.hero.thesis, "hi");
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
    if (
      url.includes("/contents/_data/readings.json") ||
      url.includes("/contents/_data/podcasts.json") ||
      url.includes("/contents/_data/memes.json")
    ) {
      return new Response(JSON.stringify({ content: btoa("{}"), encoding: "base64" }), { status: 200 });
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
  assert.equal(body.files.site.home.hero.thesis, thesis);
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

test("the allowlist accepts data files and uploads", () => {
  assert.equal(isAllowedPath("_data/site.json"), true);
  assert.equal(isAllowedPath("_data/readings.json"), true);
  assert.equal(isAllowedPath("assets/uploads/rooster-2.png"), true);
});

test("the allowlist rejects templates, workflows, and traversal", () => {
  assert.equal(isAllowedPath("index.html"), false);
  assert.equal(isAllowedPath("_includes/head.html"), false);
  assert.equal(isAllowedPath(".github/workflows/deploy-pages-with-draft-preview.yml"), false);
  assert.equal(isAllowedPath("_data/../index.html"), false);
  assert.equal(isAllowedPath("assets/uploads/../../main.js"), false);
  assert.equal(isAllowedPath("/_data/site.json"), false);
  assert.equal(isAllowedPath("_data/site.json.bak"), false);
  assert.equal(isAllowedPath("_data/Site.json"), false);
});

// Adversarial cases beyond the brief's baseline list. None of these slip
// through ALLOWED_PATHS today, but each documents a specific attack shape
// against the allowlist so a future regex edit can't reopen it silently.
test("the allowlist rejects percent-encoded traversal", () => {
  assert.equal(isAllowedPath("_data/%2e%2e%2fsite.json"), false);
  assert.equal(isAllowedPath("_data%2f..%2fsite.json"), false);
  assert.equal(isAllowedPath("assets/uploads/..%2f..%2fmain.js"), false);
});

test("the allowlist rejects a backslash separator", () => {
  assert.equal(isAllowedPath("_data\\..\\site.json"), false);
});

test("the allowlist rejects a leading ./", () => {
  assert.equal(isAllowedPath("./_data/site.json"), false);
});

test("the allowlist rejects an absolute filesystem path", () => {
  assert.equal(isAllowedPath("/etc/passwd"), false);
});

test("the allowlist rejects an empty string", () => {
  assert.equal(isAllowedPath(""), false);
});

test("the allowlist rejects non-string values", () => {
  assert.equal(isAllowedPath(undefined), false);
  assert.equal(isAllowedPath(null), false);
  assert.equal(isAllowedPath(123), false);
  assert.equal(isAllowedPath(["_data/site.json"]), false);
});

test("the allowlist rejects a trailing space or newline", () => {
  assert.equal(isAllowedPath("_data/site.json "), false);
  assert.equal(isAllowedPath("_data/site.json\n"), false);
  assert.equal(isAllowedPath("\n_data/site.json"), false);
});

test("the allowlist rejects a Unicode look-alike underscore", () => {
  assert.equal(isAllowedPath("＿data/site.json"), false);
});

test("the allowlist rejects _data subdirectories", () => {
  assert.equal(isAllowedPath("_data/sub/foo.json"), false);
  assert.equal(isAllowedPath("assets/uploads/sub/x.png"), false);
});

// Pins the `candidate.includes("..")` guard specifically. ".." is inside the
// assets/uploads character class ([A-Za-z0-9._-]), so these three paths
// match ALLOWED_PATHS[1] on the regex alone and are stopped only by the
// substring guard. Without this test, deleting `includes("..")` as
// "redundant with the regex" leaves the whole suite green while
// assets/uploads/.. (and friends) become writable again.
test("the .. guard rejects traversal-shaped filenames the regex alone would allow", () => {
  assert.equal(isAllowedPath("assets/uploads/.."), false);
  assert.equal(isAllowedPath("assets/uploads/..."), false);
  assert.equal(isAllowedPath("assets/uploads/a..b"), false);
});

function mockCommitApi({ headSha = "abc123", refUpdateStatus = 200 } = {}) {
  const calls = [];
  mock.method(globalThis, "fetch", async (input, init = {}) => {
    const url = String(input.url ?? input);
    calls.push({ url, method: init.method || "GET", body: init.body });
    // GitHub's real API is asymmetric here: reading a ref is singular
    // (`/git/ref/{ref}`) but updating one is plural (`/git/refs/{ref}`).
    // Match both so the PATCH that lands the commit isn't mistaken for an
    // unexpected call.
    if (url.includes("/git/ref/heads") || url.includes("/git/refs/heads")) {
      if ((init.method || "GET") === "GET") {
        return new Response(JSON.stringify({ object: { sha: headSha } }), { status: 200 });
      }
      if (refUpdateStatus !== 200) {
        return new Response(JSON.stringify({ message: "Update is not a fast forward" }), {
          status: refUpdateStatus
        });
      }
      return new Response(JSON.stringify({ object: { sha: "newcommit" } }), { status: 200 });
    }
    if (url.endsWith("/git/blobs")) {
      return new Response(JSON.stringify({ sha: "blobsha" }), { status: 200 });
    }
    if (url.includes("/git/commits/")) {
      return new Response(JSON.stringify({ tree: { sha: "treesha" } }), { status: 200 });
    }
    if (url.endsWith("/git/trees")) {
      return new Response(JSON.stringify({ sha: "newtreesha" }), { status: 200 });
    }
    if (url.endsWith("/git/commits")) {
      return new Response(JSON.stringify({ sha: "newcommit" }), { status: 200 });
    }
    throw new Error(`unexpected fetch to ${url}`);
  });
  return calls;
}

async function putRequest(env, body) {
  return new Request("https://api.example.com/content", {
    method: "PUT",
    headers: { authorization: await bearer(env), "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

test("PUT /content writes an allowed file and returns the new commit sha", async () => {
  const env = githubEnv();
  env.__installationToken = "ghs_test";
  const calls = mockCommitApi();
  const response = await worker.fetch(
    await putRequest(env, {
      files: [{ path: "_data/site.json", contentBase64: btoa("{}") }],
      baseCommitSha: "abc123",
      message: "edit homepage"
    }),
    env
  );
  mock.restoreAll();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).commitSha, "newcommit");

  // Pins the write target: mutating BRANCH to "main" must fail this test.
  // mockCommitApi matches ref URLs branch-agnostically, so without this
  // assertion nothing in the PUT suite would notice a write to main.
  const refUpdate = calls.find((call) => call.method === "PATCH");
  assert.ok(refUpdate, "expected a PATCH call updating the branch ref");
  assert.ok(
    refUpdate.url.endsWith("/git/refs/heads/editor"),
    `ref update must target the editor branch, got ${refUpdate.url}`
  );

  // Pins the blob mode: mutating "100644" to "120000" (a symlink) must fail
  // this test. A symlink blob under assets/uploads/ pointing outside the
  // repo is exactly the escalation the allowlist exists to prevent.
  const treeCall = calls.find((call) => call.url.endsWith("/git/trees"));
  assert.ok(treeCall, "expected a POST call creating the tree");
  const treeBody = JSON.parse(treeCall.body);
  for (const entry of treeBody.tree) {
    assert.equal(entry.mode, "100644");
  }
});

test("PUT /content rejects a disallowed path before calling GitHub", async () => {
  const env = githubEnv();
  env.__installationToken = "ghs_test";
  const calls = mockCommitApi();
  const response = await worker.fetch(
    await putRequest(env, {
      files: [{ path: "index.html", contentBase64: btoa("<h1>hi</h1>") }],
      baseCommitSha: "abc123",
      message: "sneaky"
    }),
    env
  );
  mock.restoreAll();
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

test("PUT /content rejects the whole batch if any one path is disallowed", async () => {
  const env = githubEnv();
  env.__installationToken = "ghs_test";
  const calls = mockCommitApi();
  const response = await worker.fetch(
    await putRequest(env, {
      files: [
        { path: "_data/site.json", contentBase64: btoa("{}") },
        { path: "main.js", contentBase64: btoa("evil()") }
      ],
      baseCommitSha: "abc123",
      message: "mixed"
    }),
    env
  );
  mock.restoreAll();
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

// A malformed files array must produce a normal 400 response, not an
// uncaught TypeError. An uncaught throw inside worker.fetch escapes the
// json()/corsHeaders() path entirely, so Cloudflare renders a bare 500 with
// no CORS headers at all — the browser then reports a CORS failure instead
// of the real error, which is a dead end for the editor UI. Checking the
// CORS header here (not just the status code) is what would have caught
// that: a response built by json() always carries it, one built by
// Cloudflare's own crash page never does.
test("PUT /content with a null file entry returns 400 with CORS headers, not a crash", async () => {
  const env = githubEnv();
  env.__installationToken = "ghs_test";
  const calls = mockCommitApi();
  const response = await worker.fetch(
    new Request("https://api.example.com/content", {
      method: "PUT",
      headers: {
        authorization: await bearer(env),
        "content-type": "application/json",
        origin: env.ALLOWED_ORIGIN
      },
      body: JSON.stringify({ files: [null], baseCommitSha: "abc123", message: "x" })
    }),
    env
  );
  mock.restoreAll();
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("access-control-allow-origin"), env.ALLOWED_ORIGIN);
  assert.equal(calls.length, 0);
});

// JSON has no literal for JS's `undefined` (JSON.stringify collapses an
// undefined array element to null, which is exactly the case above), so the
// only way an "undefined" reaches the parser over the wire is as invalid
// JSON syntax — the bare keyword where a value is expected. That must still
// come back as an ordinary 400 through the existing "Malformed request
// body" branch, not an uncaught exception.
test("PUT /content with a body containing a bare `undefined` token returns 400 with CORS headers, not a crash", async () => {
  const env = githubEnv();
  env.__installationToken = "ghs_test";
  const calls = mockCommitApi();
  const response = await worker.fetch(
    new Request("https://api.example.com/content", {
      method: "PUT",
      headers: {
        authorization: await bearer(env),
        "content-type": "application/json",
        origin: env.ALLOWED_ORIGIN
      },
      body: '{"files":[undefined],"baseCommitSha":"abc123","message":"x"}'
    }),
    env
  );
  mock.restoreAll();
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("access-control-allow-origin"), env.ALLOWED_ORIGIN);
  assert.equal(calls.length, 0);
});

test("PUT /content rejects a mixed batch of a valid entry and non-object entries without crashing", async () => {
  const env = githubEnv();
  env.__installationToken = "ghs_test";
  const calls = mockCommitApi();
  const response = await worker.fetch(
    new Request("https://api.example.com/content", {
      method: "PUT",
      headers: {
        authorization: await bearer(env),
        "content-type": "application/json",
        origin: env.ALLOWED_ORIGIN
      },
      body: JSON.stringify({
        files: [{ path: "_data/site.json", contentBase64: btoa("{}") }, 42, "x"],
        baseCommitSha: "abc123",
        message: "mixed"
      })
    }),
    env
  );
  mock.restoreAll();
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("access-control-allow-origin"), env.ALLOWED_ORIGIN);
  assert.equal(calls.length, 0);
  const body = await response.json();
  // The error message must be readable for non-object entries, not the
  // empty-string join that came from mapping straight to `.path`.
  assert.match(body.error, /42/);
  assert.match(body.error, /"x"/);
});

test("PUT /content returns 409 when the base commit is stale", async () => {
  const env = githubEnv();
  env.__installationToken = "ghs_test";
  mockCommitApi({ headSha: "somethingelse" });
  const response = await worker.fetch(
    await putRequest(env, {
      files: [{ path: "_data/site.json", contentBase64: btoa("{}") }],
      baseCommitSha: "abc123",
      message: "stale"
    }),
    env
  );
  mock.restoreAll();
  assert.equal(response.status, 409);
});

test("PUT /content maps a non-fast-forward ref update to 409, not 502", async () => {
  // The ref passed the stale check but moved before the PATCH landed. GitHub
  // refuses the non-fast-forward update with 422; that is a conflict the user
  // can resolve by reloading, not a server fault.
  const env = githubEnv();
  env.__installationToken = "ghs_test";
  mockCommitApi({ refUpdateStatus: 422 });
  const response = await worker.fetch(
    await putRequest(env, {
      files: [{ path: "_data/site.json", contentBase64: btoa("{}") }],
      baseCommitSha: "abc123",
      message: "race"
    }),
    env
  );
  mock.restoreAll();
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /Reload before saving/);
});

test("PUT /content still reports other GitHub failures on the ref update as 502", async () => {
  const env = githubEnv();
  env.__installationToken = "ghs_test";
  mockCommitApi({ refUpdateStatus: 500 });
  const response = await worker.fetch(
    await putRequest(env, {
      files: [{ path: "_data/site.json", contentBase64: btoa("{}") }],
      baseCommitSha: "abc123",
      message: "boom"
    }),
    env
  );
  mock.restoreAll();
  assert.equal(response.status, 502);
});

test("the stale-baseCommitSha 409 and the ref-race 409 say the same thing", async () => {
  const env = githubEnv();
  env.__installationToken = "ghs_test";
  mockCommitApi({ headSha: "somethingelse" });
  const stale = await worker.fetch(
    await putRequest(env, {
      files: [{ path: "_data/site.json", contentBase64: btoa("{}") }],
      baseCommitSha: "abc123",
      message: "stale"
    }),
    env
  );
  mock.restoreAll();
  mockCommitApi({ refUpdateStatus: 422 });
  const race = await worker.fetch(
    await putRequest(env, {
      files: [{ path: "_data/site.json", contentBase64: btoa("{}") }],
      baseCommitSha: "abc123",
      message: "race"
    }),
    env
  );
  mock.restoreAll();
  assert.equal((await stale.json()).error, (await race.json()).error);
});

test("PUT /content without a session returns 401 and calls no GitHub API", async () => {
  const env = githubEnv();
  env.__installationToken = "ghs_test";
  const calls = mockCommitApi();
  const response = await worker.fetch(
    new Request("https://api.example.com/content", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ files: [], baseCommitSha: "abc123", message: "x" })
    }),
    env
  );
  mock.restoreAll();
  assert.equal(response.status, 401);
  assert.equal(calls.length, 0);
});

test("PUT /content with a missing GitHub secret returns 500, not 502, and writes nothing", async () => {
  const env = githubEnv();
  delete env.GITHUB_APP_ID;
  const calls = mockCommitApi();
  const response = await worker.fetch(
    await putRequest(env, {
      files: [{ path: "_data/site.json", contentBase64: btoa("{}") }],
      baseCommitSha: "abc123",
      message: "edit homepage"
    }),
    env
  );
  mock.restoreAll();
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.doesNotMatch(body.error, /GITHUB_APP_ID/);
  assert.equal(calls.length, 0);
});

function mockFourFiles() {
  const bodies = {
    site: JSON.stringify({ home: { hero: { thesis: "hi" } } }),
    readings: JSON.stringify({ page: { title: "R" } }),
    podcasts: JSON.stringify({ page: { title: "P" } }),
    memes: JSON.stringify({ page: { title: "M" } })
  };
  mock.method(globalThis, "fetch", async (input) => {
    const url = String(input.url ?? input);
    if (url.includes("/git/ref/heads/editor")) {
      return new Response(JSON.stringify({ object: { sha: "abc123" } }), { status: 200 });
    }
    for (const name of Object.keys(bodies)) {
      if (url.includes(`/contents/_data/${name}.json`)) {
        return new Response(
          JSON.stringify({ content: btoa(bodies[name]), encoding: "base64" }),
          { status: 200 }
        );
      }
    }
    throw new Error(`unexpected fetch to ${url}`);
  });
}

test("GET /content returns all four data files", async () => {
  const env = githubEnv();
  env.__installationToken = "ghs_test";
  mockFourFiles();
  const response = await worker.fetch(
    new Request("https://api.example.com/content", { headers: { authorization: await bearer(env) } }),
    env
  );
  mock.restoreAll();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.baseCommitSha, "abc123");
  assert.deepEqual(Object.keys(body.files).sort(), ["memes", "podcasts", "readings", "site"]);
  assert.equal(body.files.readings.page.title, "R");
});

test("GET /content surfaces a failure on any one file as 502", async () => {
  const env = githubEnv();
  env.__installationToken = "ghs_test";
  mock.method(globalThis, "fetch", async (input) => {
    const url = String(input.url ?? input);
    if (url.includes("/git/ref/heads/editor")) {
      return new Response(JSON.stringify({ object: { sha: "abc123" } }), { status: 200 });
    }
    if (url.includes("/contents/_data/memes.json")) return new Response("boom", { status: 500 });
    return new Response(JSON.stringify({ content: btoa("{}"), encoding: "base64" }), { status: 200 });
  });
  const response = await worker.fetch(
    new Request("https://api.example.com/content", { headers: { authorization: await bearer(env) } }),
    env
  );
  mock.restoreAll();
  assert.equal(response.status, 502);
});
