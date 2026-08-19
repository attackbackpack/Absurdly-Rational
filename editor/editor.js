import { createApi } from "./lib/api.js";
import { createDraft } from "./lib/draft.js";
import { attachOverlay } from "./lib/overlay.js";
import { openImagePanel, openSettingsPanel } from "./lib/panels.js";

const api = createApi(document.body.dataset.api);
const previewUrl = new URLSearchParams(location.search).get("preview") || "/preview/index.html";

const signin = document.getElementById("signin");
const form = document.getElementById("signin-form");
const errorBox = document.getElementById("signin-error");
const workspace = document.getElementById("workspace");
const frame = document.getElementById("preview");
const status = document.getElementById("status");
const saveButton = document.getElementById("save-button");
const reloadButton = document.getElementById("reload-button");

let draft = null;
let overlay = null;

function setStatus(message) {
  status.textContent = message;
}

function onDirty() {
  saveButton.disabled = !draft || !draft.isDirty();
  setStatus(draft && draft.isDirty() ? "Unsaved changes" : "");
}

function onImageClick(anchor, spec) {
  openImagePanel({ anchor, spec, draft, onDirty });
}

async function start() {
  signin.hidden = true;
  workspace.hidden = false;
  setStatus("Loading…");
  const content = await api.loadContent();
  draft = createDraft(content.site, content.baseCommitSha);
  frame.addEventListener("load", () => {
    if (overlay) overlay.detach();
    overlay = attachOverlay({ frame, draft, onDirty, onImageClick });
    onDirty();
    setStatus("");
  });
  frame.src = previewUrl;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorBox.hidden = true;
  try {
    await api.login(document.getElementById("password").value);
    await start();
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
    signin.hidden = false;
    workspace.hidden = true;
  }
});

document.getElementById("settings-button").addEventListener("click", () => {
  openSettingsPanel({ draft, onDirty });
});

saveButton.addEventListener("click", async () => {
  if (!draft || !draft.isDirty()) return;
  saveButton.disabled = true;
  setStatus("Saving…");

  try {
    await api.save(draft.buildPayload("content(update): homepage edited in the site editor"));
  } catch (error) {
    if (error.status === 409) {
      setStatus("Someone else changed the draft. Reload the page before saving again.");
      saveButton.disabled = false;
    } else if (error.status === 401) {
      // The save itself never went through, so the draft is genuinely unsaved —
      // say so rather than implying the edit is safe on the server.
      setStatus("");
      sessionStorage.clear();
      signin.hidden = false;
      workspace.hidden = true;
      errorBox.textContent = "Your session expired. This change was not saved — sign in again to continue editing.";
      errorBox.hidden = false;
    } else {
      setStatus(error.message);
      saveButton.disabled = false;
    }
    return;
  }

  // The save has already succeeded at this point. Everything below is best-effort
  // cleanup (refreshing content, rebuilding the draft/overlay against the new
  // baseCommitSha) — its failure must never be reported as a save failure.
  const savedMessage = "Saved. The preview rebuilds in about a minute — use Reload preview to see it.";
  setStatus(savedMessage);

  try {
    const content = await api.loadContent();
    draft = createDraft(content.site, content.baseCommitSha);
    if (overlay) overlay.detach();
    overlay = attachOverlay({ frame, draft, onDirty, onImageClick });
    // onDirty() re-derives status/button state from the fresh (clean) draft,
    // which would clear the success message we just set — restore it after.
    onDirty();
    setStatus(savedMessage);
  } catch {
    setStatus(`${savedMessage} The editor could not refresh itself — reload the page before saving again.`);
    saveButton.disabled = false;
  }
});

reloadButton.addEventListener("click", () => {
  if (draft && draft.isDirty() && !confirm("Reloading discards unsaved changes. Continue?")) return;
  location.reload();
});

window.addEventListener("beforeunload", (event) => {
  if (draft && draft.isDirty()) event.preventDefault();
});

if (api.hasSession()) {
  start().catch((error) => {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
    signin.hidden = false;
    workspace.hidden = true;
  });
}
