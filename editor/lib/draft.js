import { parseSpec, getValue, setValue } from "./paths.js";

const DATA_FILES = ["site", "readings", "podcasts", "memes"];

export function safeUploadName(name) {
  const base = String(name).split("/").pop().split("\\").pop();
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    // The Worker rejects any path containing "..", and it rejects the whole
    // batch — so a name like "v1..final.jpg" would stage happily and then make
    // every later save fail too. Collapse dot runs before that can happen.
    .replace(/\.{2,}/g, ".")
    .replace(/^[-.]+/, "")
    .replace(/-+(\.[a-z0-9]+)$/, "$1");
  return cleaned || "upload";
}

// These mirror scripts/validate-content.js (allowedExtensions, maxImageBytes,
// maxImageDimension). Anything that passes here and fails there lands on the
// editor branch and breaks the owner's CI, so the two must stay in step.
export const UPLOAD_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOAD_DIMENSION = 6000;

/**
 * A short, stable tag derived from the file's bytes.
 *
 * safeUploadName alone is not enough to name a committed file: it de-duplicates
 * only against the current session's uploads, and knows nothing about what is
 * already in assets/uploads/ on the editor branch. Two sessions that each
 * upload an "image.jpg" would produce the same path, and the second silently
 * replaces the first — the guest photo becomes the show art. Lowercasing makes
 * that likelier, not less likely (IMG_0421.JPG and img_0421.jpg converge).
 *
 * Content-derived rather than time-derived so that re-picking the same file
 * produces the same name instead of a new copy each time, and so the result is
 * testable. Two 32-bit FNV-1a passes with different seeds, rendered base36:
 * [0-9a-z] only, which keeps the Worker's ^assets/uploads/[A-Za-z0-9._-]+$
 * allowlist satisfied.
 */
export function uploadTag(bytesBase64) {
  const text = String(bytesBase64);
  let a = 0x811c9dc5;
  let b = 0x7fffffff;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x85ebca6b) >>> 0;
  }
  return `${a.toString(36).padStart(7, "0")}${b.toString(36).padStart(7, "0")}`.slice(0, 12);
}

// How a save is described in the commit the Worker writes.
const FILE_LABELS = {
  site: "homepage",
  readings: "readings",
  podcasts: "podcasts",
  memes: "meme bank"
};

/**
 * The commit subject for a save, from the files it actually touches.
 *
 * A save can now span four data files, and the point of committing them
 * together is that the owner can review one change — which only works if the
 * subject says what changed.
 */
export function describeFiles(changedFiles) {
  const names = (changedFiles || []).map((name) => FILE_LABELS[name] || name);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function commitMessage(changedFiles) {
  const listed = describeFiles(changedFiles);
  if (!listed) return "content(update): edited in the site editor";
  return `content(update): ${listed} edited in the site editor`;
}

function megabytes(bytes) {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

/**
 * Why an image may not be uploaded, in words for the person choosing it, or
 * null when it is fine. `width`/`height` may be omitted to check only the
 * things known before the file is decoded; pass them as null to say the file
 * could not be decoded at all.
 */
export function uploadRejection({ name, size, width, height }) {
  // The extension has to be read off the cleaned name, not the original: the
  // cleaned name is what is committed, and cleaning can remove an extension
  // entirely (".png" and "....png" both become "png").
  const cleaned = safeUploadName(name);
  const dot = cleaned.lastIndexOf(".");
  const extension = dot === -1 ? "" : cleaned.slice(dot + 1);
  if (!UPLOAD_EXTENSIONS.includes(extension)) {
    return `“${String(name)}” is not a kind of image this site can use. Save it as a JPG, PNG, or WebP first (allowed: ${UPLOAD_EXTENSIONS.map((e) => `.${e}`).join(", ")}).`;
  }
  if (typeof size === "number" && size > MAX_UPLOAD_BYTES) {
    return `That image is ${megabytes(size)}. The limit is ${megabytes(MAX_UPLOAD_BYTES)} — make it smaller and try again.`;
  }
  if (width === null || height === null) {
    return "That file could not be read as an image. Try opening it and re-saving it as a JPG, PNG, or WebP.";
  }
  if (
    (typeof width === "number" && width > MAX_UPLOAD_DIMENSION) ||
    (typeof height === "number" && height > MAX_UPLOAD_DIMENSION)
  ) {
    return `That image is ${width}×${height} pixels. The limit is ${MAX_UPLOAD_DIMENSION} pixels on each side — most phone photos need to be resized first.`;
  }
  return null;
}

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function createDraft(files, baseCommitSha) {
  const originals = {};
  const working = {};
  for (const name of DATA_FILES) {
    const text = JSON.stringify(files[name] ?? null);
    originals[name] = text;
    working[name] = JSON.parse(text);
  }
  const uploads = new Map();
  // Which staged file belongs to which image slot, so re-picking replaces.
  const stagedBySpec = new Map();
  // Moves when rebase() re-points the draft at a newer branch head.
  let currentSha = baseCommitSha;

  const locate = (spec) => {
    const { file, segments } = parseSpec(spec);
    if (!DATA_FILES.includes(file)) {
      throw new Error(`"${spec}": unknown data file "${file}"`);
    }
    return { file, segments };
  };

  return {
    get baseCommitSha() {
      return currentSha;
    },

    read(spec) {
      const { file, segments } = locate(spec);
      return getValue(working[file], segments);
    },

    write(spec, value) {
      const { file, segments } = locate(spec);
      setValue(working[file], segments, value);
    },

    /**
     * Stages a file for the next save and returns the repository path it will
     * be committed to. Pass `spec` — the image slot this file is for — so that
     * re-picking an image in the same session replaces the file staged for that
     * slot instead of committing the abandoned one alongside it.
     */
    stageUpload(fileName, bytesBase64, spec) {
      const name = safeUploadName(fileName);
      const dot = name.lastIndexOf(".");
      const stem = dot === -1 ? name : name.slice(0, dot);
      const extension = dot === -1 ? "" : name.slice(dot);
      const candidate = `assets/uploads/${stem}-${uploadTag(bytesBase64)}${extension}`;

      if (spec !== undefined) {
        const previous = stagedBySpec.get(spec);
        // Only drop the abandoned file if nothing else still points at it —
        // the same picture staged into two slots shares one path.
        if (previous && previous !== candidate) {
          let shared = false;
          for (const [otherSpec, otherPath] of stagedBySpec) {
            if (otherSpec !== spec && otherPath === previous) shared = true;
          }
          if (!shared) uploads.delete(previous);
        }
        stagedBySpec.set(spec, candidate);
      }

      uploads.set(candidate, bytesBase64);
      return candidate;
    },

    /**
     * Re-points the draft at a newer branch head after a save came back 409.
     *
     * A 409 used to be answered with "reload before saving again", which throws
     * away a draft that can now span four files. Most conflicts are not real
     * ones: the other writer (Pages CMS, or the same person in another tab)
     * touched a file this draft never edited. In that case the edits still
     * apply cleanly to the newer head, so take the newer version of every file
     * this draft left alone and move on.
     *
     * This is NOT a merge. If the other writer changed a file this draft also
     * changed, nothing is touched — the draft is left exactly as it was, so the
     * text can still be copied out — and the conflicting files are named.
     */
    rebase(files, nextCommitSha) {
      const conflicts = [];
      const adopt = [];
      for (const name of DATA_FILES) {
        const remote = JSON.stringify(files[name] ?? null);
        if (remote === originals[name]) continue;
        if (JSON.stringify(working[name]) === originals[name]) {
          adopt.push([name, remote]);
        } else {
          conflicts.push(name);
        }
      }
      if (conflicts.length) return { ok: false, files: conflicts };
      for (const [name, remote] of adopt) {
        originals[name] = remote;
        working[name] = JSON.parse(remote);
      }
      currentSha = nextCommitSha;
      return { ok: true, files: [] };
    },

    changedFiles() {
      return DATA_FILES.filter((name) => JSON.stringify(working[name]) !== originals[name]);
    },

    isDirty() {
      return uploads.size > 0 || this.changedFiles().length > 0;
    },

    buildPayload(message) {
      const out = [];
      for (const name of this.changedFiles()) {
        out.push({
          path: `_data/${name}.json`,
          contentBase64: toBase64(JSON.stringify(working[name], null, 2) + "\n")
        });
      }
      for (const [path, contentBase64] of uploads) {
        out.push({ path, contentBase64 });
      }
      return { files: out, baseCommitSha: currentSha, message };
    }
  };
}
