import { FITS, FOCUSES, fitClass, focusClass } from "./imagefit.js";

const LINK_FIELDS = [["site:home.hero.cta_url", "Hero button link"]];

const SEO_FIELDS = [
  ["site:home.seo.title", "Search result title"],
  ["site:home.seo.description", "Search result description"],
  ["site:home.seo.og_title", "Social share title"],
  ["site:home.seo.og_description", "Social share description"],
  ["site:home.seo.twitter_description", "Twitter description"]
];

function panelRoot() {
  let root = document.getElementById("ar-panel");
  if (root) root.remove();
  root = document.createElement("div");
  root.id = "ar-panel";
  document.body.appendChild(root);

  const close = () => root.remove();
  root.addEventListener("click", (event) => {
    if (event.target === root) close();
  });
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") close();
    },
    { once: true }
  );
  return { root, close };
}

function field(label, value, onChange, type = "text") {
  const wrapper = document.createElement("label");
  wrapper.className = "ar-field";
  wrapper.textContent = label;
  const input = type === "textarea" ? document.createElement("textarea") : document.createElement("input");
  if (type !== "textarea") input.type = type;
  input.value = value ?? "";
  input.addEventListener("input", () => onChange(input.value));
  wrapper.appendChild(input);
  return wrapper;
}

function select(label, options, value, onChange) {
  const wrapper = document.createElement("label");
  wrapper.className = "ar-field";
  wrapper.textContent = label;
  const element = document.createElement("select");
  for (const option of options) {
    const node = document.createElement("option");
    node.value = option;
    node.textContent = option;
    element.appendChild(node);
  }
  element.value = value;
  element.addEventListener("change", () => onChange(element.value));
  wrapper.appendChild(element);
  return wrapper;
}

async function fileToBase64(file) {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of buffer) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function openImagePanel({ anchor, spec, draft, onDirty }) {
  const { root, close } = panelRoot();
  const box = document.createElement("div");
  box.className = "ar-panel-box";
  const image = draft.read(spec);
  const img = anchor.querySelector("img.image-object");

  const heading = document.createElement("h2");
  heading.textContent = "Image";
  box.appendChild(heading);

  if (!img) {
    const notice = document.createElement("p");
    notice.className = "ar-notice";
    notice.textContent =
      "This spot currently shows the built-in artwork. Choose an image, then save — the preview shows it after the site rebuilds.";
    box.appendChild(notice);
  }

  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = ".jpg,.jpeg,.png,.webp";
  picker.addEventListener("change", async () => {
    const file = picker.files[0];
    if (!file) return;
    const repoPath = draft.stageUpload(file.name, await fileToBase64(file));
    draft.write(`${spec}.path`, repoPath);
    if (img) img.src = URL.createObjectURL(file);
    onDirty();
  });
  const pickerLabel = document.createElement("label");
  pickerLabel.className = "ar-field";
  pickerLabel.textContent = "Replace image";
  pickerLabel.appendChild(picker);
  box.appendChild(pickerLabel);

  box.appendChild(
    field("Alternative text", image.alt, (value) => {
      draft.write(`${spec}.alt`, value);
      if (img) img.alt = value;
      onDirty();
    })
  );

  box.appendChild(
    select("Image fit", FITS, image.fit || "cover", (value) => {
      draft.write(`${spec}.fit`, value);
      if (img) {
        img.classList.remove(...FITS.map(fitClass));
        img.classList.add(fitClass(value));
      }
      onDirty();
    })
  );

  box.appendChild(
    select("Crop focus", FOCUSES, image.focus || "center", (value) => {
      draft.write(`${spec}.focus`, value);
      if (img) {
        img.classList.remove(...FOCUSES.map(focusClass));
        img.classList.add(focusClass(value));
      }
      onDirty();
    })
  );

  const done = document.createElement("button");
  done.textContent = "Done";
  done.addEventListener("click", close);
  box.appendChild(done);

  root.appendChild(box);
}

export function openSettingsPanel({ draft, onDirty }) {
  const { root, close } = panelRoot();
  const box = document.createElement("div");
  box.className = "ar-panel-box";

  const heading = document.createElement("h2");
  heading.textContent = "Page settings";
  box.appendChild(heading);

  for (const [spec, label] of LINK_FIELDS) {
    box.appendChild(
      field(label, draft.read(spec), (value) => {
        draft.write(spec, value);
        onDirty();
      })
    );
  }

  const note = document.createElement("p");
  note.className = "ar-notice";
  note.textContent = "The rest do not appear on the page. They are what search engines and social sites show.";
  box.appendChild(note);

  for (const [spec, label] of SEO_FIELDS) {
    box.appendChild(
      field(
        label,
        draft.read(spec),
        (value) => {
          draft.write(spec, value);
          onDirty();
        },
        "textarea"
      )
    );
  }

  const done = document.createElement("button");
  done.textContent = "Done";
  done.addEventListener("click", close);
  box.appendChild(done);

  root.appendChild(box);
}
