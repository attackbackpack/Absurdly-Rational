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
const BRANCH = "editor";
const USER_AGENT = "absurdly-rational-editor";

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
    throw new Error(`GitHub ${init.method || "GET"} ${pathname} failed: ${response.status}`);
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
    const file = await github(env, `/contents/_data/site.json?ref=${BRANCH}`);
    const decoded = decodeURIComponent(
      Array.from(atob(file.content.replace(/\n/g, "")))
        .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`)
        .join("")
    );
    return json(env, request, 200, {
      site: JSON.parse(decoded),
      baseCommitSha: ref.object.sha
    });
  } catch (error) {
    return json(env, request, 502, { error: `Could not read the site content. ${error.message}` });
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
    return json(env, request, 404, { error: "Not found" });
  }
};
