import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// scripts/validate-content.js is a top-level script with no exports: requiring
// it runs the whole validation against this repository's real _data. Rather
// than restructure it, each case below builds a throwaway repository (the
// script's root is `path.resolve(__dirname, "..")`, so a copy of the script in
// <fixture>/scripts validates <fixture>/_data) and runs it as a child process.

const here = path.dirname(fileURLToPath(import.meta.url));
const validator = path.join(here, "validate-content.js");

// A real 1x1 PNG: imageDimensions() parses the IHDR out of it.
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

function readings() {
  const slugs = ["evidence", "policy", "thinking", "hospital"];
  return {
    topics: slugs.map((slug) => ({ slug, path: `readings-${slug}.html` })),
    posts: Array.from({ length: 23 }, (_, index) => ({
      category: slugs[index % 4],
      date: "2026-01-01",
      title: `Post ${index}`,
      subtitle: "",
      visible: true
    }))
  };
}

function baseSite(home = {}) {
  return {
    url: "https://absurdlyrational.com",
    home: {
      formats: [{ key: "readings" }, { key: "podcasts" }, { key: "memes" }],
      ...home
    }
  };
}

/** Runs the real validator over a throwaway repository; returns its output. */
function validate({ site, uploads = {} }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ar-validate-"));
  try {
    fs.mkdirSync(path.join(root, "scripts"));
    fs.copyFileSync(validator, path.join(root, "scripts", "validate-content.js"));
    fs.mkdirSync(path.join(root, "_data"));
    const write = (name, value) =>
      fs.writeFileSync(path.join(root, "_data", name), JSON.stringify(value));
    write("site.json", site);
    write("editor-guide.json", {
      branch: "editor",
      preview_url: "https://absurdlyrational.com/preview/"
    });
    write("readings.json", readings());
    write("podcasts.json", { guests: [] });
    write("memes.json", { items: [] });
    for (const [name, contents] of Object.entries(uploads)) {
      fs.mkdirSync(path.join(root, "assets", "uploads"), { recursive: true });
      fs.writeFileSync(path.join(root, "assets", "uploads", name), contents);
    }

    try {
      const stdout = execFileSync(process.execPath, [path.join(root, "scripts", "validate-content.js")], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      });
      return { ok: true, output: stdout };
    } catch (error) {
      return { ok: false, output: `${error.stdout || ""}${error.stderr || ""}` };
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// --- The shape the image panel seeds (path and alt as own properties) ---

test("the seeded shape passes for a slot with no image", () => {
  const result = validate({
    site: baseSite({
      hero: { image: { path: "", alt: "", fit: "contain", focus: "center", decorative: false } }
    })
  });
  assert.ok(result.ok, result.output);
});

test("the seeded shape passes for a decorative slot with no image", () => {
  const result = validate({
    site: baseSite({
      hero: { image: { path: "", alt: "", fit: "cover", focus: "center", decorative: true } }
    })
  });
  assert.ok(result.ok, result.output);
});

test("the seeded shape passes for an uploaded image with alt text", () => {
  const result = validate({
    site: baseSite({
      hero: {
        image: {
          path: "assets/uploads/rooster.png",
          alt: "A rooster mid-crow",
          fit: "cover",
          focus: "center",
          decorative: false
        }
      }
    }),
    uploads: { "rooster.png": ONE_PIXEL_PNG }
  });
  assert.ok(result.ok, result.output);
});

test("an uploaded image with no alt text now fails, instead of shipping alt=\"\"", () => {
  // This is the point of seeding: without an `alt` own property the validator
  // skipped the image entirely and the accessibility gate never ran.
  const result = validate({
    site: baseSite({
      hero: {
        image: {
          path: "assets/uploads/rooster.png",
          alt: "",
          fit: "cover",
          focus: "center",
          decorative: false
        }
      }
    }),
    uploads: { "rooster.png": ONE_PIXEL_PNG }
  });
  assert.equal(result.ok, false);
  assert.match(result.output, /provide alt text for a meaningful local image/);
});

test("a decorative uploaded image with no alt text is allowed", () => {
  const result = validate({
    site: baseSite({
      hero: {
        image: {
          path: "assets/uploads/rooster.png",
          alt: "",
          fit: "cover",
          focus: "center",
          decorative: true
        }
      }
    }),
    uploads: { "rooster.png": ONE_PIXEL_PNG }
  });
  assert.ok(result.ok, result.output);
});

test("an image object without path and alt is still skipped entirely", () => {
  // Documents the behaviour the seeding works around: this is what every image
  // in _data/site.json looked like before the panel started seeding.
  const result = validate({
    site: baseSite({ hero: { image: { fit: "cover", focus: "center", decorative: false } } })
  });
  assert.ok(result.ok, result.output);
});

// --- home.formats[].key ---

test("the three shipped format keys are accepted", () => {
  assert.ok(validate({ site: baseSite() }).ok);
});

test("a format key containing a bracket is rejected", () => {
  const result = validate({
    site: baseSite({ formats: [{ key: "read]ings" }] })
  });
  assert.equal(result.ok, false);
  assert.match(result.output, /home\.formats\[0\]\.key/);
});

test("a format key containing a quote or a space is rejected", () => {
  for (const key of ['read"ings', "read ings", "readings."]) {
    const result = validate({ site: baseSite({ formats: [{ key }] }) });
    assert.equal(result.ok, false, `expected ${key} to be rejected`);
    assert.match(result.output, /home\.formats\[0\]\.key/);
  }
});

test("an empty or missing format key is rejected", () => {
  for (const format of [{ key: "" }, {}, { key: 7 }, null]) {
    const result = validate({ site: baseSite({ formats: [format] }) });
    assert.equal(result.ok, false, `expected ${JSON.stringify(format)} to be rejected`);
    assert.match(result.output, /home\.formats\[0\]\.key/);
  }
});

test("hyphens and underscores are accepted in a format key", () => {
  assert.ok(validate({ site: baseSite({ formats: [{ key: "long-reads_2" }] }) }).ok);
});

test("a non-array formats value is reported rather than crashing", () => {
  const result = validate({ site: baseSite({ formats: "readings" }) });
  assert.equal(result.ok, false);
  assert.match(result.output, /home\.formats: expected a list of formats/);
});
