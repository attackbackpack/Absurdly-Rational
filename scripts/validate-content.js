"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const allowedFits = new Set(["cover", "contain"]);
const allowedFocuses = new Set([
  "center",
  "top",
  "bottom",
  "left",
  "right",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right"
]);
const allowedCategories = new Set(["evidence", "policy", "thinking", "hospital"]);
const allowedLayouts = new Set(["wide", "tall", "standard", "wide-low", "small"]);
const allowedVariants = new Set(["rooster", "big-reality", "receipts", "conflicts", "snake-oil", "read-less"]);
const allowedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const maxImageBytes = 10 * 1024 * 1024;
const maxImageDimension = 6000;
const recommendedMinimumWidth = 640;
const recommendedMinimumHeight = 400;
const errors = [];
const warnings = new Set();

function fail(message) {
  errors.push(message);
}

function warn(message) {
  warnings.add(message);
}

function readJson(relativePath) {
  const absolutePath = path.join(root, relativePath);
  try {
    return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  } catch (error) {
    fail(`${relativePath}: ${error.message}`);
    return null;
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateUrl(value, location) {
  if (typeof value !== "string" || !value.trim()) {
    fail(`${location}: URL is required`);
    return;
  }

  if (value.startsWith("#")) {
    return;
  }

  if (!value.includes("://")) {
    if (!/^(?:\/?[A-Za-z0-9][A-Za-z0-9._/-]*|\/[A-Za-z0-9][A-Za-z0-9._/-]*)$/.test(value)) {
      fail(`${location}: invalid internal URL "${value}"`);
    }
    return;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      fail(`${location}: use an HTTPS URL`);
    }
    if (/[\s<>]/.test(value)) {
      fail(`${location}: URL contains unsafe whitespace or markup`);
    }
  } catch (error) {
    fail(`${location}: invalid URL "${value}"`);
  }
}

function imageDimensions(buffer) {
  if (buffer.length >= 24 && buffer.readUInt32BE(0) === 0x89504e47 && buffer.toString("ascii", 1, 4) === "PNG") {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }

  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      offset += 2;
      if (marker === 0xd8 || marker === 0xd9) {
        continue;
      }
      if (offset + 2 > buffer.length) {
        break;
      }
      const segmentLength = buffer.readUInt16BE(offset);
      if (segmentLength < 2 || offset + segmentLength > buffer.length) {
        break;
      }
      const isStartOfFrame = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
      if (isStartOfFrame && offset + 7 < buffer.length) {
        return { width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3) };
      }
      offset += segmentLength;
    }
  }

  if (buffer.length >= 30 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    const chunk = buffer.toString("ascii", 12, 16);
    if (chunk === "VP8X") {
      return {
        width: 1 + buffer[24] + (buffer[25] << 8) + (buffer[26] << 16),
        height: 1 + buffer[27] + (buffer[28] << 8) + (buffer[29] << 16)
      };
    }
  }

  return null;
}

function validateAssetFile(absolutePath, relativePath) {
  const extension = path.extname(relativePath).toLowerCase();
  if (!allowedExtensions.has(extension)) {
    fail(`${relativePath}: unsupported upload extension`);
    return;
  }
  const stats = fs.statSync(absolutePath);
  if (stats.size > maxImageBytes) {
    fail(`${relativePath}: image is larger than 10 MB`);
  }
  const dimensions = imageDimensions(fs.readFileSync(absolutePath));
  if (dimensions && (dimensions.width > maxImageDimension || dimensions.height > maxImageDimension)) {
    fail(`${relativePath}: image dimensions exceed ${maxImageDimension}px`);
  }
  if (dimensions && (dimensions.width < recommendedMinimumWidth || dimensions.height < recommendedMinimumHeight)) {
    warn(`${relativePath}: ${dimensions.width}x${dimensions.height}px may look soft in a large image frame`);
  }
}

function validateUploadDirectory(directory) {
  if (!fs.existsSync(directory)) {
    return;
  }
  fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
    if (entry.isDirectory()) {
      validateUploadDirectory(absolutePath);
    } else if (entry.name !== ".gitkeep") {
      validateAssetFile(absolutePath, relativePath);
    }
  });
}

function validateImage(image, location) {
  if (!isObject(image)) {
    fail(`${location}: image must be an object`);
    return;
  }

  if (!allowedFits.has(image.fit)) {
    fail(`${location}.fit: use cover or contain`);
  }
  if (!allowedFocuses.has(image.focus)) {
    fail(`${location}.focus: use a constrained focus position`);
  }
  if (typeof image.path !== "string") {
    fail(`${location}.path: path must be a string`);
    return;
  }
  if (typeof image.alt !== "string") {
    fail(`${location}.alt: alt text must be present, even when intentionally empty`);
  }
  if (!image.path) {
    return;
  }
  if (image.path.startsWith("http://")) {
    fail(`${location}.path: external image URLs must use HTTPS`);
  }
  if (image.path.includes("://")) {
    validateUrl(image.path, `${location}.path`);
    if (!image.decorative && !image.alt.trim()) {
      fail(`${location}.alt: provide alt text for a meaningful external image`);
    }
    return;
  }

  const relativePath = image.path.replace(/^\/+/, "");
  if (relativePath.includes("..")) {
    fail(`${location}.path: path traversal is not allowed`);
    return;
  }
  const absolutePath = path.resolve(root, relativePath);
  if (!absolutePath.startsWith(`${root}${path.sep}`)) {
    fail(`${location}.path: local image must stay inside the repository`);
    return;
  }
  if (!fs.existsSync(absolutePath)) {
    fail(`${location}.path: missing local asset ${image.path}`);
    return;
  }
  if (!image.decorative && !image.alt.trim()) {
    fail(`${location}.alt: provide alt text for a meaningful local image`);
  }

  const extension = path.extname(relativePath).toLowerCase();
  if (!allowedExtensions.has(extension)) {
    fail(`${location}.path: unsupported image extension ${extension || "(none)"}`);
    return;
  }
  const stats = fs.statSync(absolutePath);
  if (stats.size > maxImageBytes) {
    fail(`${location}.path: image is larger than 10 MB`);
  }
  const dimensions = imageDimensions(fs.readFileSync(absolutePath));
  if (dimensions && (dimensions.width > maxImageDimension || dimensions.height > maxImageDimension)) {
    fail(`${location}.path: image dimensions exceed ${maxImageDimension}px`);
  }
}

function walk(value, location, visitor) {
  visitor(value, location);
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${location}[${index}]`, visitor));
  } else if (isObject(value)) {
    Object.entries(value).forEach(([key, child]) => walk(child, `${location}.${key}`, visitor));
  }
}

function validateLinks(value, location) {
  walk(value, location, (current, currentLocation) => {
    if (!isObject(current)) {
      return;
    }
    Object.entries(current).forEach(([key, child]) => {
      if ((key === "url" || key === "linkedin") && typeof child === "string") {
        validateUrl(child, `${currentLocation}.${key}`);
      }
    });
  });
}

function validateText(value, location) {
  if (typeof value === "string" && /<\/?script\b|javascript:/i.test(value)) {
    fail(`${location}: script content is not allowed`);
  }
}

const site = readJson("_data/site.json");
const editorGuide = readJson("_data/editor-guide.json");
const readings = readJson("_data/readings.json");
const podcasts = readJson("_data/podcasts.json");
const memes = readJson("_data/memes.json");
const datasets = { site, editorGuide, readings, podcasts, memes };

Object.entries(datasets).forEach(([name, data]) => {
  if (!data) {
    return;
  }
  walk(data, `_data/${name}.json`, (value, location) => {
    if (isObject(value) && Object.prototype.hasOwnProperty.call(value, "path") && Object.prototype.hasOwnProperty.call(value, "alt") && Object.prototype.hasOwnProperty.call(value, "fit") && Object.prototype.hasOwnProperty.call(value, "focus")) {
      validateImage(value, location);
    }
    validateText(value, location);
  });
  validateLinks(data, `_data/${name}.json`);
});

if (site) {
  validateUrl(site.url, "_data/site.json.url");

  // index.html builds an edit path from this key — data-edit="site:home.formats
  // [key={{ format.key }}].title" — and the editor parses that path at runtime.
  // The build-time check above only ever sees the Liquid wildcard, so a key
  // containing "]" or a quote, or an empty key, passes CI and then breaks the
  // editor inside an iframe with nothing but a console error.
  const formats = site.home && site.home.formats;
  if (formats !== undefined && !Array.isArray(formats)) {
    fail("_data/site.json.home.formats: expected a list of formats");
  }
  (Array.isArray(formats) ? formats : []).forEach((format, index) => {
    const location = `_data/site.json.home.formats[${index}].key`;
    if (!isObject(format) || typeof format.key !== "string" || !/^[A-Za-z0-9_-]+$/.test(format.key)) {
      fail(`${location}: use letters, numbers, hyphens, or underscores only — the editor builds an edit path from this key`);
    }
  });
}

if (editorGuide) {
  if (editorGuide.branch !== "editor") {
    fail("_data/editor-guide.json.branch: the protected editing branch must remain editor");
  }
  if (editorGuide.preview_url !== "https://absurdlyrational.com/preview/") {
    fail("_data/editor-guide.json.preview_url: the draft preview URL must remain https://absurdlyrational.com/preview/");
  }
}

if (readings) {
  if (!Array.isArray(readings.topics) || readings.topics.length !== 4) {
    fail("_data/readings.json.topics: expected the four fixed reading topics");
  }
  if (!Array.isArray(readings.posts) || readings.posts.length < 23) {
    fail("_data/readings.json.posts: the migrated library must retain all 23 reading posts");
  }
  (readings.topics || []).forEach((topic, index) => {
    if (!allowedCategories.has(topic.slug)) {
      fail(`_data/readings.json.topics[${index}].slug: invalid topic ${topic.slug}`);
    }
    if (!/^readings-(?:evidence|policy|thinking|hospital)\.html$/.test(topic.path || "")) {
      fail(`_data/readings.json.topics[${index}].path: invalid public topic URL`);
    }
  });
  (readings.posts || []).forEach((post, index) => {
    const location = `_data/readings.json.posts[${index}]`;
    if (!allowedCategories.has(post.category)) {
      fail(`${location}.category: invalid reading category ${post.category}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(post.date || "") || Number.isNaN(Date.parse(`${post.date}T00:00:00Z`))) {
      fail(`${location}.date: use a real YYYY-MM-DD date`);
    }
    if (typeof post.title !== "string" || !post.title.trim()) {
      fail(`${location}.title: title is required`);
    }
    if (typeof post.subtitle !== "string") {
      fail(`${location}.subtitle: subtitle is required`);
    }
    if (typeof post.visible !== "boolean") {
      fail(`${location}.visible: use a boolean`);
    }
  });
}

if (podcasts) {
  (podcasts.guests || []).forEach((guest, index) => {
    if (!guest.class_name || !["stanford", "architect"].includes(guest.class_name)) {
      fail(`_data/podcasts.json.guests[${index}].class_name: invalid guest layout`);
    }
    if (!Array.isArray(guest.links) || guest.links.length === 0) {
      fail(`_data/podcasts.json.guests[${index}].links: at least one link is required`);
    }
    if (typeof guest.visible !== "boolean") {
      fail(`_data/podcasts.json.guests[${index}].visible: use a boolean`);
    }
  });
}

if (memes) {
  (memes.items || []).forEach((item, index) => {
    const location = `_data/memes.json.items[${index}]`;
    if (!allowedLayouts.has(item.layout)) {
      fail(`${location}.layout: invalid constrained layout ${item.layout}`);
    }
    if (!allowedVariants.has(item.variant)) {
      fail(`${location}.variant: invalid constrained art variant ${item.variant}`);
    }
    if (typeof item.visible !== "boolean") {
      fail(`${location}.visible: use a boolean`);
    }
    if (typeof item.title !== "string" || !item.title.trim()) {
      fail(`${location}.title: title is required`);
    }
    if (typeof item.caption !== "string") {
      fail(`${location}.caption: caption is required`);
    }
  });
}

validateUploadDirectory(path.join(root, "assets", "uploads"));

if (warnings.size) {
  console.warn(`Content validation completed with ${warnings.size} image warning${warnings.size === 1 ? "" : "s"}:`);
  warnings.forEach((warning) => console.warn(`- ${warning}`));
}

if (errors.length) {
  console.error(`Content validation failed with ${errors.length} issue${errors.length === 1 ? "" : "s"}:`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  console.log("Content validation passed: JSON structure, URLs, image settings, local assets, and image limits are valid.");
}
