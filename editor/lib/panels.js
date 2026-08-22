import { FITS, FOCUSES, fitClass, focusClass } from "./imagefit.js";
import { uploadRejection } from "./draft.js";
import { fieldsForPage } from "./pagefields.js";

let closeOpenPanel = null;

export function closePanel() {
  if (closeOpenPanel) closeOpenPanel();
  const stray = document.getElementById("ar-panel");
  if (stray) stray.remove();
}

function panelRoot() {
  closePanel();
  const root = document.createElement("div");
  root.id = "ar-panel";
  document.body.appendChild(root);

  // Not { once: true }: that removed the listener on the first keydown of any
  // key, so typing one character into a field disarmed Escape. Remove it
  // explicitly when the panel closes instead.
  const onKeydown = (event) => {
    if (event.key === "Escape") close();
  };
  const close = () => {
    document.removeEventListener("keydown", onKeydown);
    if (closeOpenPanel === close) closeOpenPanel = null;
    root.remove();
  };
  closeOpenPanel = close;

  root.addEventListener("click", (event) => {
    if (event.target === root) close();
  });
  document.addEventListener("keydown", onKeydown);
  return { root, close };
}

// The click that opens a panel happens inside the preview iframe, so focus is
// still in the iframe's document and keydown never reaches the shell — Escape
// would be dead until the user clicked the shell. Focusing the panel's first
// control fixes that and gives keyboard users an entry point.
function present(root, box) {
  root.appendChild(box);
  const first = box.querySelector("input, select, textarea, button");
  if (first) first.focus();
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

/**
 * The writes that make an image object complete enough for
 * scripts/validate-content.js to judge it, given how the template renders it.
 *
 * validateImage only runs on an object carrying path, alt, fit and focus as own
 * properties, and every image in _data/site.json ships with fit and focus but
 * neither path nor alt. Without the seed, whether the alt-text gate ran at all
 * depended on which controls the user happened to touch.
 *
 * `decorative` is how the TEMPLATE renders the slot (index.html passes
 * decorative=true to _includes/image.html for door art). validateImage gates the
 * alt requirement on the DATA field, which knows nothing about that — so a
 * decorative slot must have decorative: true written into the data, or an
 * uploaded door image would fail CI with no way to fix it from the panel, since
 * the alt field is hidden precisely because it can never render.
 */
export function seedImageWrites(image, decorative) {
  const writes = [];
  for (const key of ["path", "alt"]) {
    if (typeof image[key] !== "string") writes.push([key, ""]);
  }
  if (decorative && image.decorative !== true) writes.push(["decorative", true]);
  return writes;
}

export function openImagePanel({ anchor, spec, draft, onDirty, decorative = false }) {
  const { root, close } = panelRoot();
  const box = document.createElement("div");
  box.className = "ar-panel-box";
  const image = draft.read(spec);
  const img = anchor.querySelector("img.image-object");
  // _includes/image.html renders alt="" when `include.decorative or
  // image.decorative`; mirror both inputs. `decorative` comes from the template
  // via the call site (door art is always decorative there, whatever the data
  // says), `image.decorative` from the content itself.
  const isDecorative = decorative || image.decorative === true;

  // Applied by every handler that changes this slot — never on open, so that
  // looking at an image and closing the panel leaves the draft clean.
  const completeShape = () => {
    for (const [key, value] of seedImageWrites(image, isDecorative)) {
      draft.write(`${spec}.${key}`, value);
    }
  };

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

  const problem = document.createElement("p");
  problem.className = "ar-problem";
  problem.setAttribute("role", "alert");
  problem.hidden = true;
  const reject = (text) => {
    problem.textContent = text;
    problem.hidden = false;
    // Without this the same file cannot be chosen twice in a row: no change
    // event fires when the value is unchanged.
    picker.value = "";
  };

  picker.addEventListener("change", async () => {
    const file = picker.files[0];
    if (!file) return;
    problem.hidden = true;
    // `accept` is only a dialog hint, and assets/uploads/ is re-validated in CI
    // on every push — an oversized or wrong-format file staged here would fail
    // the owner's build long after this panel closed. Check before staging.
    const nameOrSize = uploadRejection({ name: file.name, size: file.size });
    if (nameOrSize) {
      reject(nameOrSize);
      return;
    }
    let bitmap = null;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      bitmap = null;
    }
    const dimensions = uploadRejection({
      name: file.name,
      size: file.size,
      width: bitmap && bitmap.width,
      height: bitmap && bitmap.height
    });
    if (bitmap && bitmap.close) bitmap.close();
    if (dimensions) {
      reject(dimensions);
      return;
    }
    completeShape();
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
  box.appendChild(problem);

  if (isDecorative) {
    const note = document.createElement("p");
    note.className = "ar-notice";
    note.textContent = "This artwork is decorative, so screen readers skip it. It needs no description.";
    box.appendChild(note);
  } else {
    box.appendChild(
      field("Alternative text (describe the image for screen readers)", image.alt, (value) => {
        completeShape();
        draft.write(`${spec}.alt`, value);
        if (img) img.alt = value;
        onDirty();
      })
    );
  }

  box.appendChild(
    select("Image fit", FITS, image.fit || "cover", (value) => {
      completeShape();
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
      completeShape();
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

  present(root, box);
}

export function openMemePanel({ anchor, spec, draft, onDirty }) {
  const { root, close } = panelRoot();
  const box = document.createElement("div");
  box.className = "ar-panel-box";

  const heading = document.createElement("h2");
  heading.textContent = "Meme";
  box.appendChild(heading);

  const note = document.createElement("p");
  note.className = "ar-notice";
  note.textContent = "Title and caption appear when someone opens this meme, not on the wall.";
  box.appendChild(note);

  for (const [suffix, label, type] of [
    ["title", "Title", "text"],
    ["caption", "Caption", "textarea"],
    ["art.headline", "Artwork headline", "textarea"],
    ["art.accent", "Artwork accent", "textarea"]
  ]) {
    let current;
    try {
      current = draft.read(`${spec}.${suffix}`);
    } catch {
      continue;
    }
    box.appendChild(
      field(label, current, (value) => {
        draft.write(`${spec}.${suffix}`, value);
        onDirty();
      }, type)
    );
  }

  const done = document.createElement("button");
  done.textContent = "Done";
  done.addEventListener("click", close);
  box.appendChild(done);

  present(root, box);
}

export function openSettingsPanel({ draft, onDirty, page }) {
  const { root, close } = panelRoot();
  const box = document.createElement("div");
  box.className = "ar-panel-box";

  const { links, seo } = fieldsForPage(page);

  const heading = document.createElement("h2");
  heading.textContent = page ? `Page settings — ${page[0].toUpperCase()}${page.slice(1)}` : "Page settings";
  box.appendChild(heading);

  for (const [spec, label] of links) {
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

  for (const [spec, label] of seo) {
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

  present(root, box);
}
