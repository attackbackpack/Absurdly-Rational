import { parseSpec, getValue, setValue } from "./paths.js";

const FILE_PATHS = { site: "_data/site.json" };

export function safeUploadName(name) {
  const base = String(name).split("/").pop().split("\\").pop();
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+/, "")
    .replace(/-+(\.[a-z0-9]+)$/, "$1");
  return cleaned || "upload";
}

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function createDraft(site, baseCommitSha) {
  const original = JSON.stringify(site);
  const working = JSON.parse(original);
  const uploads = new Map();

  const resolve = (spec) => {
    const { file, segments } = parseSpec(spec);
    if (file !== "site") throw new Error(`v1 edits site.json only, not "${file}"`);
    return segments;
  };

  return {
    baseCommitSha,

    read(spec) {
      return getValue(working, resolve(spec));
    },

    write(spec, value) {
      setValue(working, resolve(spec), value);
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

    isDirty() {
      return uploads.size > 0 || JSON.stringify(working) !== original;
    },

    buildPayload(message) {
      const files = [];
      if (JSON.stringify(working) !== original) {
        files.push({
          path: FILE_PATHS.site,
          contentBase64: toBase64(JSON.stringify(working, null, 2))
        });
      }
      for (const [path, contentBase64] of uploads) {
        files.push({ path, contentBase64 });
      }
      return { files, baseCommitSha, message };
    }
  };
}
