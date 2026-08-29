const SESSION_TTL_SECONDS = 8 * 60 * 60;
const MAX_FAILED_ATTEMPTS = 10;
const RATE_WINDOW_SECONDS = 60 * 60;
const encoder = new TextEncoder();

function base64url(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", key, encoder.encode(message));
}

export async function signSession(secret, expiresAt) {
  return `${expiresAt}.${base64url(await hmac(secret, String(expiresAt)))}`;
}

export async function verifySession(secret, token) {
  if (typeof token !== "string") return false;
  const separator = token.indexOf(".");
  if (separator < 1) return false;
  const expiresAt = Number(token.slice(0, separator));
  if (!Number.isInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return false;
  const expected = base64url(await hmac(secret, String(expiresAt)));
  return timingSafeEqual(expected, token.slice(separator + 1));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}

async function passwordMatches(secret, candidate) {
  if (typeof candidate !== "string") return false;
  const [expected, actual] = await Promise.all([
    hmac(secret, "password-check"),
    hmac(candidate, "password-check")
  ]);
  return timingSafeEqual(base64url(expected), base64url(actual));
}

function corsHeaders(env, request) {
  const origin = request.headers.get("origin");
  const headers = {
    "access-control-allow-methods": "GET,PUT,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    vary: "origin"
  };
  if (origin && origin === env.ALLOWED_ORIGIN) {
    headers["access-control-allow-origin"] = origin;
  }
  return headers;
}

function json(env, request, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(env, request) }
  });
}

function isMissingSecret(value) {
  return typeof value !== "string" || value.length === 0;
}

function requireSecrets(env, request, names) {
  for (const name of names) {
    if (isMissingSecret(env[name])) {
      console.error(`Worker misconfigured: ${name} is not set.`);
      return json(env, request, 500, { error: "Server misconfiguration." });
    }
  }
  return null;
}

async function handleAuth(request, env) {
  const configError = requireSecrets(env, request, ["EDITOR_PASSWORD", "SESSION_SECRET"]);
  if (configError) return configError;

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const rateKey = `auth-failures:${ip}`;
  const failures = Number((await env.RATE_LIMIT.get(rateKey)) || 0);
  if (failures >= MAX_FAILED_ATTEMPTS) {
    return json(env, request, 429, { error: "Too many attempts. Try again later." });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  if (!(await passwordMatches(env.EDITOR_PASSWORD, payload.password))) {
    await env.RATE_LIMIT.put(rateKey, String(failures + 1), {
      expirationTtl: RATE_WINDOW_SECONDS
    });
    return json(env, request, 401, { error: "Incorrect password." });
  }

  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  return json(env, request, 200, {
    token: await signSession(env.SESSION_SECRET, expiresAt),
    expiresAt
  });
}

const GITHUB_API = "https://api.github.com";
const BRANCH = "main";
const USER_AGENT = "absurdly-rational-editor";
const DATA_FILES = ["site", "readings", "podcasts", "memes"];

function pemToArrayBuffer(pem) {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function appJwt(env) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = base64url(
    encoder.encode(JSON.stringify({ iat: now - 60, exp: now + 540, iss: env.GITHUB_APP_ID }))
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(env.GITHUB_APP_PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(`${header}.${claims}`)
  );
  return `${header}.${claims}.${base64url(signature)}`;
}

let cachedToken = { value: null, expiresAt: 0 };

async function installationToken(env) {
  if (env.__installationToken) return env.__installationToken;
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken.value && cachedToken.expiresAt > now + 60) return cachedToken.value;

  const response = await fetch(
    `${GITHUB_API}/app/installations/${env.GITHUB_INSTALLATION_ID}/access_tokens`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${await appJwt(env)}`,
        accept: "application/vnd.github+json",
        "user-agent": USER_AGENT
      }
    }
  );
  if (!response.ok) throw new Error(`installation token request failed: ${response.status}`);
  const body = await response.json();
  cachedToken = { value: body.token, expiresAt: now + 55 * 60 };
  return cachedToken.value;
}

function decodeBase64Utf8(content) {
  return decodeURIComponent(
    Array.from(atob(String(content).replace(/\n/g, "")))
      .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`)
      .join("")
  );
}

async function github(env, pathname, init = {}) {
  const token = await installationToken(env);
  const response = await fetch(`${GITHUB_API}/repos/${env.GITHUB_REPO}${pathname}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "user-agent": USER_AGENT,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers
    }
  });
  if (!response.ok) {
    const error = new Error(`GitHub ${init.method || "GET"} ${pathname} failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function authorize(request, env) {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return verifySession(env.SESSION_SECRET, token);
}

async function handleGetContent(request, env) {
  const configError = requireSecrets(env, request, [
    "SESSION_SECRET",
    "GITHUB_APP_ID",
    "GITHUB_APP_PRIVATE_KEY",
    "GITHUB_INSTALLATION_ID",
    "GITHUB_REPO"
  ]);
  if (configError) return configError;

  if (!(await authorize(request, env))) {
    return json(env, request, 401, { error: "Sign in again." });
  }
  try {
    const ref = await github(env, `/git/ref/heads/${BRANCH}`);
    const files = {};
    for (const name of DATA_FILES) {
      const file = await github(env, `/contents/_data/${name}.json?ref=${BRANCH}`);
      files[name] = JSON.parse(decodeBase64Utf8(file.content));
    }
    return json(env, request, 200, { files, baseCommitSha: ref.object.sha });
  } catch (error) {
    return json(env, request, 502, { error: `Could not read the site content. ${error.message}` });
  }
}

const CONFLICT_MESSAGE = "Someone else changed the site while you were editing. Reload before publishing.";

const ALLOWED_PATHS = [/^_data\/[a-z-]+\.json$/, /^assets\/uploads\/[A-Za-z0-9._-]+$/];

export function isAllowedPath(candidate) {
  if (typeof candidate !== "string" || candidate.includes("..")) return false;
  return ALLOWED_PATHS.some((pattern) => pattern.test(candidate));
}

async function handlePutContent(request, env) {
  const configError = requireSecrets(env, request, [
    "SESSION_SECRET",
    "GITHUB_APP_ID",
    "GITHUB_APP_PRIVATE_KEY",
    "GITHUB_INSTALLATION_ID",
    "GITHUB_REPO"
  ]);
  if (configError) return configError;

  if (!(await authorize(request, env))) {
    return json(env, request, 401, { error: "Sign in again." });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json(env, request, 400, { error: "Malformed request body." });
  }

  const files = Array.isArray(payload.files) ? payload.files : [];
  if (files.length === 0) {
    return json(env, request, 400, { error: "No files to save." });
  }
  const isFileEntry = (file) => file !== null && typeof file === "object" && !Array.isArray(file);
  const describeFile = (file) =>
    isFileEntry(file) && typeof file.path === "string"
      ? file.path
      : file === undefined
        ? "undefined"
        : JSON.stringify(file);
  const rejected = files.filter((file) => !isFileEntry(file) || !isAllowedPath(file.path));
  if (rejected.length) {
    return json(env, request, 400, {
      error: `This editor may not write: ${rejected.map(describeFile).join(", ")}`
    });
  }

  try {
    const ref = await github(env, `/git/ref/heads/${BRANCH}`);
    if (ref.object.sha !== payload.baseCommitSha) {
      return json(env, request, 409, { error: CONFLICT_MESSAGE });
    }

    const blobs = [];
    for (const file of files) {
      const blob = await github(env, "/git/blobs", {
        method: "POST",
        body: JSON.stringify({ content: file.contentBase64, encoding: "base64" })
      });
      blobs.push({ path: file.path, mode: "100644", type: "blob", sha: blob.sha });
    }

    const baseCommit = await github(env, `/git/commits/${ref.object.sha}`);
    const tree = await github(env, "/git/trees", {
      method: "POST",
      body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree: blobs })
    });
    const commit = await github(env, "/git/commits", {
      method: "POST",
      body: JSON.stringify({
        message: String(payload.message || "content(update): site editor"),
        tree: tree.sha,
        parents: [ref.object.sha]
      })
    });
    try {
      await github(env, `/git/refs/heads/${BRANCH}`, {
        method: "PATCH",
        body: JSON.stringify({ sha: commit.sha })
      });
    } catch (error) {
      // No `force`, so GitHub requires a fast-forward and answers 422 when the
      // ref moved between the read above and this write. That is the same
      // conflict as a stale baseCommitSha, not a server fault — report it the
      // same way so the client shows the reload-and-retry copy.
      if (error.status === 422) {
        return json(env, request, 409, { error: CONFLICT_MESSAGE });
      }
      throw error;
    }

    return json(env, request, 200, { commitSha: commit.sha });
  } catch (error) {
    return json(env, request, 502, { error: `Could not save. ${error.message}` });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env, request) });
    }
    if (url.pathname === "/auth" && request.method === "POST") {
      return handleAuth(request, env);
    }
    if (url.pathname === "/content" && request.method === "GET") {
      return handleGetContent(request, env);
    }
    if (url.pathname === "/content" && request.method === "PUT") {
      return handlePutContent(request, env);
    }
    return json(env, request, 404, { error: "Not found" });
  }
};
