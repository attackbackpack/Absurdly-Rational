// dev-editor-api.mjs
//
// A local development stand-in for the real Cloudflare Worker at
// worker/src/worker.js. It exists so the repository owner can click through
// the visual site editor's UI (sign-in, hover, click-to-edit, image panel,
// save, conflict handling) on their own machine before creating a GitHub
// App or deploying anything.
//
// This script NEVER talks to GitHub. Saves DO persist locally, though: by
// default a PUT /content writes the received bytes straight to the real
// working-tree files (_data/*.json and assets/uploads/*) so that
// "Reload site" in Jekyll shows the change, the same way it will after a
// real commit in production. This is a modification of tracked files in
// your checkout, not a commit — undo it any time with:
//   git checkout -- _data/ && git clean -fd assets/uploads
// Set DEV_EDITOR_MEMORY_ONLY=1 to fall back to the old behaviour (nothing
// touches disk, state lives only in process memory and is lost on exit).
//
// It has NO security value: the password check and the "session token" are
// not protecting anything real. Do not present this as a test of the real
// Worker's authentication, and never deploy this file or point it at
// production. It is for http://localhost:4000 only.
//
// Usage:
//   node scripts/dev-editor-api.mjs
//   DEV_EDITOR_PASSWORD=your-password node scripts/dev-editor-api.mjs
//   DEV_EDITOR_MEMORY_ONLY=1 node scripts/dev-editor-api.mjs

import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = 8788;
const ALLOWED_ORIGIN = "http://localhost:4000";
const PASSWORD = process.env.DEV_EDITOR_PASSWORD || "test-password";
const PERSIST_TO_DISK = process.env.DEV_EDITOR_MEMORY_ONLY !== "1";
const CONFLICT_MESSAGE =
  "Someone else changed the site while you were editing. Reload before publishing.";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
const DATA_FILES = ["site", "readings", "podcasts", "memes"];

// Same allowlist shape the real Worker enforces (worker/src/worker.js).
const ALLOWED_PATHS = [/^_data\/[a-z-]+\.json$/, /^assets\/uploads\/[A-Za-z0-9._-]+$/];

function isAllowedPath(candidate) {
  if (typeof candidate !== "string" || candidate.includes("..")) return false;
  return ALLOWED_PATHS.some((pattern) => pattern.test(candidate));
}

// state.files mirrors current content for GET /content and conflict checks.
// When PERSIST_TO_DISK is true, the on-disk files are the source of truth
// after each save; state.files is kept in sync alongside them.
const state = {
  files: Object.fromEntries(
    DATA_FILES.map((name) => [
      name,
      JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "_data", `${name}.json`), "utf8"))
    ])
  ),
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

  if (pathname === "/" && req.method === "GET") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8", ...corsHeaders(origin) });
    res.end(
      `This is the local dev stand-in API for the visual site editor.\n` +
        `It has no web page of its own — open the editor at:\n` +
        `  http://localhost:4000/editor/?preview=/index.html\n\n` +
        `Endpoints served here:\n` +
        `  POST /auth      sign in, returns a session token\n` +
        `  GET  /content   fetch current site content (requires session)\n` +
        `  PUT  /content   save site content (requires session)\n`
    );
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
    sendJson(res, origin, 200, { files: state.files, baseCommitSha: state.headSha });
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

    const files = Array.isArray(payload.files) ? payload.files : [];
    if (files.length === 0) {
      sendJson(res, origin, 400, { error: "No files to save." });
      return;
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
      sendJson(res, origin, 400, {
        error: `This editor may not write: ${rejected.map(describeFile).join(", ")}`
      });
      return;
    }

    if (payload.baseCommitSha !== state.headSha) {
      sendJson(res, origin, 409, { error: CONFLICT_MESSAGE });
      return;
    }

    const written = [];
    if (PERSIST_TO_DISK) {
      for (const file of files) {
        const absPath = path.join(REPO_ROOT, file.path);
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        // Write the decoded bytes verbatim — no re-serialisation — so the
        // file on disk matches what editor/lib/draft.js sent byte-for-byte.
        fs.writeFileSync(absPath, Buffer.from(file.contentBase64, "base64"));
        written.push(file.path);
      }
    }

    for (const name of DATA_FILES) {
      const entry = files.find((file) => file.path === `_data/${name}.json`);
      if (entry && typeof entry.contentBase64 === "string") {
        state.files[name] = JSON.parse(Buffer.from(entry.contentBase64, "base64").toString("utf8"));
      }
    }
    state.headSha = crypto.randomUUID();

    if (written.length) {
      console.log(`[dev-editor-api] wrote: ${written.join(", ")}`);
    }

    sendJson(res, origin, 200, { commitSha: state.headSha, files });
    return;
  }

  sendJson(res, origin, 404, { error: "Not found" });
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `[dev-editor-api] port ${PORT} is already in use. Clear it with: lsof -ti :${PORT} | xargs kill -9`
    );
    process.exit(1);
  }
  throw error;
});

server.listen(PORT, () => {
  console.log(`[dev-editor-api] listening on http://localhost:${PORT} — dev stand-in only, never deploy this`);
  if (PERSIST_TO_DISK) {
    console.log(
      `[dev-editor-api] saves WRITE TO DISK: _data/ and assets/uploads/ in this checkout will change.`
    );
    console.log(`[dev-editor-api] undo everything with: git checkout -- _data/ && git clean -fd assets/uploads`);
  } else {
    console.log(`[dev-editor-api] DEV_EDITOR_MEMORY_ONLY=1 set — saves stay in memory only, nothing touches disk.`);
  }
});
