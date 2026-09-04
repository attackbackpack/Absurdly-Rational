import { FITS, FOCUSES, fitClass, focusClass } from "./imagefit.js";
import { uploadRejection } from "./draft.js";
import { fieldsForPage, guestLinkFields, MEME_FIELDS } from "./pagefields.js";
import { textRejection, altRejection } from "./rules.js";

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

/**
 * A labelled control, optionally refusing values the owner's CI would reject.
 *
 * `validate` returns a sentence explaining the refusal, or null. A refused
 * value is shown inline and never written to the draft, and leaving the field
 * while it is refused puts the last accepted value back — same shape as the
 * image picker's reject() below, so the two read alike.
 *
 * Returns a fragment rather than the <label> so the message is a sibling of
 * the label instead of part of its text.
 */
function field(label, value, onChange, type = "text", validate = null) {
  const fragment = document.createDocumentFragment();
  const wrapper = document.createElement("label");
  wrapper.className = "ar-field";
  wrapper.textContent = label;
  const input = type === "textarea" ? document.createElement("textarea") : document.createElement("input");
  if (type !== "textarea") input.type = type;
  input.value = value ?? "";
  wrapper.appendChild(input);
  fragment.appendChild(wrapper);

  if (!validate) {
    input.addEventListener("input", () => onChange(input.value));
    return fragment;
  }

  const problem = document.createElement("p");
  problem.className = "ar-problem";
  problem.setAttribute("role", "alert");
  problem.hidden = true;
  fragment.appendChild(problem);

  let accepted = input.value;
  let reason = "";
  input.addEventListener("input", () => {
    reason = validate(input.value) || "";
    if (reason) {
      problem.textContent = reason;
      problem.hidden = false;
      return;
    }
    problem.hidden = true;
    accepted = input.value;
    onChange(input.value);
  });
  input.addEventListener("blur", () => {
    if (problem.hidden) return;
    input.value = accepted;
    problem.textContent = `${reason} Your earlier text has been put back.`;
  });
  return fragment;
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

const IMAGE_MIME_TYPES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp"
};

export function imageMimeType(fileName) {
  const cleaned = String(fileName).toLowerCase();
  const dot = cleaned.lastIndexOf(".");
  return IMAGE_MIME_TYPES[dot === -1 ? "" : cleaned.slice(dot + 1)] || "application/octet-stream";
}

export async function prepareImageFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return {
    bytesBase64: btoa(binary),
    // Some iPad photo-library Files are disk-backed and WebKit can fail to
    // display their object URLs. A byte-for-byte in-memory Blob avoids that
    // path, and an extension-derived MIME type keeps a blank/misreported
    // file.type from making an otherwise valid preview unreadable.
    previewBlob: new Blob([bytes], { type: imageMimeType(file.name) })
  };
}

export function decodeImagePreview(blob, dependencies = {}) {
  const createUrl = dependencies.createUrl || ((value) => URL.createObjectURL(value));
  const revokeUrl = dependencies.revokeUrl || ((value) => URL.revokeObjectURL(value));
  const createImage = dependencies.createImage || (() => new Image());
  const url = createUrl(blob);

  return new Promise((resolve, reject) => {
    const probe = createImage();
    probe.onload = () => {
      resolve({
        url,
        width: probe.naturalWidth || probe.width,
        height: probe.naturalHeight || probe.height
      });
    };
    probe.onerror = () => {
      revokeUrl(url);
      reject(new Error("The selected image could not be decoded."));
    };
    probe.src = url;
  });
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
  // The alt text and path as they stand right now, so the picker and the alt
  // field can ask about each other without re-reading the draft.
  let currentAlt = typeof image.alt === "string" ? image.alt : "";
  let currentPath = typeof image.path === "string" ? image.path : "";

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
  const selectionStatus = document.createElement("p");
  selectionStatus.className = "ar-confirmation";
  selectionStatus.setAttribute("role", "status");
  selectionStatus.hidden = true;
  const reject = (text) => {
    problem.textContent = text;
    problem.hidden = false;
    selectionStatus.hidden = true;
    // Without this the same file cannot be chosen twice in a row: no change
    // event fires when the value is unchanged.
    picker.value = "";
  };

  picker.addEventListener("change", async () => {
    const file = picker.files[0];
    if (!file) return;
    problem.hidden = true;
    // Once this file is staged the image has a path, and validateImage then
    // requires alt text on any image the data does not mark decorative. Ask for
    // it before staging rather than letting the save break the owner's build —
    // which is why the description box sits above this one.
    const missingAlt = altRejection({ alt: currentAlt, decorative: isDecorative });
    if (missingAlt) {
      reject(`${missingAlt} Type it in the box above, then choose the picture again.`);
      return;
    }
    // `accept` is only a dialog hint, and assets/uploads/ is re-validated in CI
    // on every push — an oversized or wrong-format file staged here would fail
    // the owner's build long after this panel closed. Check before staging.
    const nameOrSize = uploadRejection({ name: file.name, size: file.size });
    if (nameOrSize) {
      reject(nameOrSize);
      return;
    }

    picker.disabled = true;
    selectionStatus.textContent = `Preparing “${file.name}”…`;
    selectionStatus.hidden = false;

    let prepared;
    let preview;
    try {
      prepared = await prepareImageFile(file);
      preview = await decodeImagePreview(prepared.previewBlob);
    } catch {
      reject("That file could not be read as an image. Try opening it and re-saving it as a JPG, PNG, or WebP.");
      picker.disabled = false;
      return;
    }
    const dimensions = uploadRejection({
      name: file.name,
      size: file.size,
      width: preview.width,
      height: preview.height
    });
    if (dimensions) {
      URL.revokeObjectURL(preview.url);
      reject(dimensions);
      picker.disabled = false;
      return;
    }
    completeShape();
    // Passing the spec lets the draft drop the file staged for this same slot
    // a moment ago: without it, changing your mind about a picture committed
    // both the one you kept and the one you abandoned.
    const repoPath = draft.stageUpload(file.name, prepared.bytesBase64, spec);
    draft.write(`${spec}.path`, repoPath);
    currentPath = repoPath;
    if (img) {
      const previousPreview = img.dataset.editorPreviewUrl;
      img.src = preview.url;
      img.dataset.editorPreviewUrl = preview.url;
      if (previousPreview) URL.revokeObjectURL(previousPreview);
      selectionStatus.textContent = `Selected “${file.name}”. The preview now shows the image that will upload.`;
    } else {
      URL.revokeObjectURL(preview.url);
      selectionStatus.textContent = `Selected “${file.name}”. It will replace the built-in artwork after publishing.`;
    }
    selectionStatus.hidden = false;
    picker.disabled = false;
    onDirty();
  });

  // The description has to be filled in before a picture can be chosen, so it
  // is asked for first.
  if (isDecorative) {
    const note = document.createElement("p");
    note.className = "ar-notice";
    note.textContent = "This artwork is decorative, so screen readers skip it. It needs no description.";
    box.appendChild(note);
  } else {
    box.appendChild(
      field(
        "Alternative text (describe the image for screen readers)",
        image.alt,
        (value) => {
          completeShape();
          currentAlt = value;
          draft.write(`${spec}.alt`, value);
          if (img) img.alt = value;
          onDirty();
        },
        "text",
        // Only a refusal once there is a picture to describe — validateImage
        // ignores alt on an image with no path, and so must this.
        (value) => altRejection({ alt: value, path: currentPath, decorative: isDecorative })
      )
    );
  }

  const pickerLabel = document.createElement("label");
  pickerLabel.className = "ar-field";
  pickerLabel.textContent = "Replace image";
  pickerLabel.appendChild(picker);
  box.appendChild(pickerLabel);
  box.appendChild(problem);
  box.appendChild(selectionStatus);

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

export function openMemePanel({ anchor, spec, draft, onDirty, onEditImage }) {
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

  const drifted = [];
  for (const [suffix, label, type] of MEME_FIELDS) {
    const fieldSpec = `${spec}.${suffix}`;
    let current;
    try {
      current = draft.read(fieldSpec);
    } catch (error) {
      // A key that is genuinely absent is fine to leave out: art.kicker,
      // art.accent and art.stamp are optional in .pages.yml. Anything else —
      // a renamed key, a preview showing a meme the draft no longer has — is
      // drift, and a bare `catch { continue }` used to hide it completely:
      // the panel just came up with fewer fields than it should have.
      if (/: no such key$/.test(error.message)) continue;
      drifted.push(`${label}: ${error.message}`);
      continue;
    }
    box.appendChild(
      field(
        label,
        current,
        (value) => {
          draft.write(fieldSpec, value);
          onDirty();
        },
        type,
        (value) => textRejection(fieldSpec, value)
      )
    );
  }

  // The picture reaches the image panel from here rather than from its own
  // annotation on the tile: the tile IS the [data-edit-meme] target, so a
  // [data-edit-image] on the same element would give two handlers one click,
  // and one on the art inside it would swallow the click before the meme
  // panel could ever open. One click opens this panel; this button opens the
  // picture controls.
  if (onEditImage) {
    let hasImage = true;
    try {
      draft.read(`${spec}.image`);
    } catch {
      hasImage = false;
    }
    if (hasImage) {
      const picture = document.createElement("button");
      picture.type = "button";
      picture.textContent = "Change the picture…";
      picture.addEventListener("click", () => onEditImage(anchor, `${spec}.image`));
      box.appendChild(picture);
    }
  }

  if (drifted.length) {
    const problem = document.createElement("p");
    problem.className = "ar-problem";
    problem.setAttribute("role", "alert");
    problem.textContent = `Some fields could not be shown: ${drifted.join("; ")}. Reload the preview and try again.`;
    box.appendChild(problem);
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

  const linkField = ([spec, label]) =>
    field(
      label,
      draft.read(spec),
      (value) => {
        draft.write(spec, value);
        onDirty();
      },
      "text",
      (value) => textRejection(spec, value)
    );

  for (const entry of links) {
    box.appendChild(linkField(entry));
  }

  // Where each guest's buttons point. Per-guest and variable in number, so
  // they are built from the draft rather than declared in CONFIG — see
  // guestLinkFields for why they belong here and not on a per-guest panel.
  if (page === "podcasts") {
    let guests = [];
    try {
      guests = draft.read("podcasts:guests");
    } catch {
      guests = [];
    }
    const guestLinks = guestLinkFields(guests);
    if (guestLinks.length) {
      const guestNote = document.createElement("p");
      guestNote.className = "ar-notice";
      guestNote.textContent =
        "Where each guest's buttons go. The wording on the buttons is edited on the page itself.";
      box.appendChild(guestNote);
      for (const entry of guestLinks) {
        box.appendChild(linkField(entry));
      }
    }
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
