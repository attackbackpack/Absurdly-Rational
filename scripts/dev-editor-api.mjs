// dev-editor-api.mjs
//
// A local development stand-in for the real Cloudflare Worker at
// worker/src/worker.js. It exists so the repository owner can click through
// the visual site editor's UI (sign-in, hover, click-to-edit, image panel,
// save, conflict handling) on their own machine before creating a GitHub
// App or deploying anything.
//
// This script NEVER talks to GitHub. Nothing it accepts is persisted beyond
// process memory — all state (the "site" content and the fake commit head)
// lives in a plain object and is lost the moment the process exits. It
// writes NOTHING to disk.
//
// It has NO security value: the password check and the "session token" are
// not protecting anything real. Do not present this as a test of the real
// Worker's authentication, and never deploy this file or point it at
// production. It is for http://localhost:4000 only.
//
// Usage:
//   node scripts/dev-editor-api.mjs
//   DEV_EDITOR_PASSWORD=your-password node scripts/dev-editor-api.mjs

import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = 8788;
const ALLOWED_ORIGIN = "http://localhost:4000";
const PASSWORD = process.env.DEV_EDITOR_PASSWORD || "test-password";
const CONFLICT_MESSAGE =
  "Someone else changed the draft while you were editing. Reload before saving.";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_JSON_PATH = path.join(__dirname, "..", "_data", "site.json");

// In-memory only. Never written back to disk, never read again after restart.
const state = {
  site: JSON.parse(fs.readFileSync(SITE_JSON_PATH, "utf8")),
  headSha: crypto.randomUUID()
};
const sessions = new Set();

function corsHeaders(origin) {
  const headers = {
    "access-control-allow-methods": "GET,PUT,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    vary: "origin"
  };
  if (origin === ALLOWED_ORIGIN) {
    headers["access-control-allow-origin"] = origin;
  }
  return headers;
}

function sendJson(res, origin, status, body) {
  res.writeHead(status, {
    "content-type": "application/json",
    ...corsHeaders(origin)
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function bearerToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || "";
  const { pathname } = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(origin));
    res.end();
    return;
  }

  if (pathname === "/auth" && req.method === "POST") {
    let payload = {};
    try {
      payload = JSON.parse((await readBody(req)) || "{}");
    } catch {
      payload = {};
    }
    if (payload.password !== PASSWORD) {
      sendJson(res, origin, 401, { error: "Incorrect password." });
      return;
    }
    const token = crypto.randomUUID();
    sessions.add(token);
    sendJson(res, origin, 200, {
      token,
      expiresAt: Math.floor(Date.now() / 1000) + 8 * 60 * 60
    });
    return;
  }

  if (pathname === "/content" && req.method === "GET") {
    const token = bearerToken(req);
    if (!token || !sessions.has(token)) {
      sendJson(res, origin, 401, { error: "Sign in again." });
      return;
    }
    sendJson(res, origin, 200, { site: state.site, baseCommitSha: state.headSha });
    return;
  }

  if (pathname === "/content" && req.method === "PUT") {
    const token = bearerToken(req);
    if (!token || !sessions.has(token)) {
      sendJson(res, origin, 401, { error: "Sign in again." });
      return;
    }
    let payload;
    try {
      payload = JSON.parse((await readBody(req)) || "{}");
    } catch {
      sendJson(res, origin, 400, { error: "Malformed request body." });
      return;
    }
    if (payload.baseCommitSha !== state.headSha) {
      sendJson(res, origin, 409, { error: CONFLICT_MESSAGE });
      return;
    }
    const files = Array.isArray(payload.files) ? payload.files : [];
    const siteEntry = files.find((file) => file && file.path === "_data/site.json");
    if (siteEntry && typeof siteEntry.contentBase64 === "string") {
      state.site = JSON.parse(Buffer.from(siteEntry.contentBase64, "base64").toString("utf8"));
    }
    state.headSha = crypto.randomUUID();
    sendJson(res, origin, 200, { commitSha: state.headSha, files });
    return;
  }

  sendJson(res, origin, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(
    `[dev-editor-api] listening on http://localhost:${PORT} — dev stand-in only, nothing persists, never deploy this`
  );
});
