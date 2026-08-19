import { createApi } from "./lib/api.js";

const api = createApi(document.body.dataset.api);
const previewUrl = new URLSearchParams(location.search).get("preview") || "/preview/index.html";

const signin = document.getElementById("signin");
const form = document.getElementById("signin-form");
const errorBox = document.getElementById("signin-error");
const workspace = document.getElementById("workspace");
const frame = document.getElementById("preview");

function showWorkspace() {
  signin.hidden = true;
  workspace.hidden = false;
  frame.src = previewUrl;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorBox.hidden = true;
  try {
    await api.login(document.getElementById("password").value);
    showWorkspace();
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  }
});

if (api.hasSession()) {
  showWorkspace();
}
