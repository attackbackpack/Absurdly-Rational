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

async function handleAuth(request, env) {
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env, request) });
    }
    if (url.pathname === "/auth" && request.method === "POST") {
      return handleAuth(request, env);
    }
    return json(env, request, 404, { error: "Not found" });
  }
};
