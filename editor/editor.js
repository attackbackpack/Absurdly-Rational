import { createApi } from "./lib/api.js";
import { createDraft } from "./lib/draft.js";
import { attachOverlay } from "./lib/overlay.js";
import { openImagePanel, openMemePanel, openSettingsPanel, closePanel } from "./lib/panels.js";
import { resolvePreviewPath } from "./lib/preview.js";
import { resolveApiBase } from "./lib/apibase.js";

const searchParams = new URLSearchParams(location.search);
const api = createApi(
  resolveApiBase(location.hostname, document.body.dataset.api, searchParams.get("apiPort"))
);
const previewUrl = resolvePreviewPath(searchParams.get("preview"));

const signin = document.getElementById("signin");
const form = document.getElementById("signin-form");
const errorBox = document.getElementById("signin-error");
const workspace = document.getElementById("workspace");
const frame = document.getElementById("preview");
const status = document.getElementById("status");
const saveButton = document.getElementById("save-button");
const reloadButton = document.getElementById("reload-button");
const toolbarTitle = document.getElementById("toolbar-title");

const PAGE_NAMES = { home: "homepage", readings: "readings", podcasts: "podcasts", memes: "meme bank" };

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
  // The template, not the data, decides that door art is decorative — it passes
  // decorative=true to _includes/image.html — so it also has to say so here.
  openImagePanel({
    anchor,
    spec,
    draft,
    onDirty,
    decorative: anchor.hasAttribute("data-edit-image-decorative")
  });
}

function onMemeClick(anchor, spec) {
  openMemePanel({ anchor, spec, draft, onDirty });
}

// Navigating does not discard anything: `draft` is a single module-level
// object shared across every page, keyed by JSON path rather than by which
// page is on screen, and every write into it (the input handler on each
// keystroke, blur's normalize-and-commit, and every panel field's change
// handler) happens synchronously, before this function can ever run. There
// is nothing "in flight" for a click to lose, so no confirmation belongs
// here — unlike beforeunload and the Reload-preview confirm below, which
// guard against a real loss (leaving the editor entirely / reloading the
// module and losing the in-memory draft) and must keep their weight.
function onNavigate(href) {
  closePanel();
  frame.src = href;
}

// Registered once, outside start(): start() can run again (e.g. after a 401
// during the initial content load, then a successful retry), and a listener
// added inside its body would stack another one on every re-entry, attaching
// duplicate overlays to the same document on every later load.
frame.addEventListener("load", () => {
  if (!draft) return;
  if (overlay) overlay.detach();
  overlay = attachOverlay({ frame, draft, onDirty, onImageClick, onMemeClick, onNavigate });
  const page = frame.contentDocument?.body?.dataset.page || "";
  toolbarTitle.textContent = `Editing the draft ${PAGE_NAMES[page] || "site"}`;
  // onDirty() alone is authoritative for status: "Unsaved changes" when the
  // draft carried unsaved edits across this navigation, "" when it didn't
  // (which also covers clearing the initial "Loading…" message on first
  // load). An unconditional setStatus("") here used to run right after it
  // and always won, blanking the status even when the draft was dirty — so
  // the save button read "enabled" while the status read blank.
  onDirty();
});

async function start() {
  signin.hidden = true;
  workspace.hidden = false;
  setStatus("Loading…");
  const content = await api.loadContent();
  draft = createDraft(content.files, content.baseCommitSha);
  frame.src = previewUrl;
}

// Only a 401 means "your password was wrong" or "your session ended". A 500
// (Worker misconfigured) or a 502 (GitHub said no — including the editor branch
// not existing yet) is a server problem, and showing it under the password box
// tells the user to retype a password that was never the issue.
function showLoadFailure(error) {
  if (error.status === 401) {
    sessionStorage.clear();
    errorBox.textContent = error.message;
    errorBox.hidden = false;
    signin.hidden = false;
    workspace.hidden = true;
    return;
  }
  signin.hidden = true;
  workspace.hidden = false;
  saveButton.disabled = true;
  setStatus(`${error.message} Nothing can be edited until that is fixed.`);
  // Content never loaded, so there is no draft and no overlay. Show the site
  // read-only rather than leaving a blank workspace behind the message.
  if (!frame.getAttribute("src")) frame.src = previewUrl;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorBox.hidden = true;
  try {
    await api.login(document.getElementById("password").value);
  } catch (error) {
    // A failure of the sign-in request itself belongs on the sign-in form:
    // wrong password (401), too many attempts (429), Worker misconfigured (500).
    errorBox.textContent = error.message;
    errorBox.hidden = false;
    signin.hidden = false;
    workspace.hidden = true;
    return;
  }

  if (draft && draft.isDirty()) {
    // A prior save hit a 401 mid-edit (see the save handler below), which
    // deliberately left `draft`/`overlay`/the iframe untouched so the edit
    // survives re-authentication. Re-running start() here would discard all
    // of that and silently lose the edit — just restore the workspace view.
    signin.hidden = true;
    workspace.hidden = false;
    onDirty();
    setStatus("Signed in again — your unsaved changes are still here. Press Save to continue.");
    return;
  }

  // The password was accepted. Anything that goes wrong from here is a content
  // load problem, and must not be reported as a bad password.
  try {
    await start();
  } catch (error) {
    showLoadFailure(error);
  }
});

document.getElementById("settings-button").addEventListener("click", () => {
  // The workspace can now be on screen with no draft behind it: showLoadFailure
  // keeps it visible so a server error is readable. There is nothing to edit.
  if (!draft) return;
  const doc = frame.contentDocument;
  const page = doc && doc.body ? doc.body.dataset.page : "";
  openSettingsPanel({ draft, onDirty, page });
});

saveButton.addEventListener("click", async () => {
  // A panel left open keeps writing into whatever `draft` object it closed
  // over at open time; after a successful save that object is replaced out
  // from under it, so any further panel edits would silently vanish. Saving
  // is a document-level action — close the panel first.
  closePanel();
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
      // The save itself never went through, so it is genuinely unsaved — but
      // `draft`/`overlay`/the iframe are deliberately left untouched (not
      // reset, not discarded) so the edit survives re-authentication. The
      // sign-in handler above checks for a dirty draft and skips start() so
      // it stays that way.
      setStatus("");
      sessionStorage.clear();
      signin.hidden = false;
      workspace.hidden = true;
      errorBox.textContent =
        "Your session expired. This change was not saved yet, but your edits are still here — sign in again to save them.";
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
    draft = createDraft(content.files, content.baseCommitSha);
    if (overlay) overlay.detach();
    overlay = attachOverlay({ frame, draft, onDirty, onImageClick, onMemeClick, onNavigate });
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
  start().catch(showLoadFailure);
}
