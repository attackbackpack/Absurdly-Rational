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

  const locate = (spec) => {
    const { file, segments } = parseSpec(spec);
    if (!DATA_FILES.includes(file)) {
      throw new Error(`"${spec}": unknown data file "${file}"`);
    }
    return { file, segments };
  };

  return {
    baseCommitSha,

    read(spec) {
      const { file, segments } = locate(spec);
      return getValue(working[file], segments);
    },

    write(spec, value) {
      const { file, segments } = locate(spec);
      setValue(working[file], segments, value);
    },

    stageUpload(fileName, bytesBase64) {
      let name = safeUploadName(fileName);
      let candidate = `assets/uploads/${name}`;
      let counter = 2;
      while (uploads.has(candidate)) {
        const dot = name.lastIndexOf(".");
        const stem = dot === -1 ? name : name.slice(0, dot);
        const extension = dot === -1 ? "" : name.slice(dot);
        candidate = `assets/uploads/${stem}-${counter}${extension}`;
        counter += 1;
      }
      uploads.set(candidate, bytesBase64);
      return candidate;
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
      return { files: out, baseCommitSha, message };
    }
  };
}
