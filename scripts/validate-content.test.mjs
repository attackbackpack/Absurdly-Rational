import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { seedImageWrites } from "../editor/lib/panels.js";
import { textRejection, altRejection } from "../editor/lib/rules.js";

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
      url: `https://example.com/post-${index}`,
      visible: true
    }))
  };
}

function guest(key) {
  return {
    key,
    class_name: "stanford",
    visible: true,
    links: [{ label: "Listen", url: "https://example.com", new_tab: true }]
  };
}

function memeItem(key) {
  return {
    key,
    layout: "wide",
    variant: "rooster",
    visible: true,
    title: "Title",
    caption: "Caption"
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

/**
 * Runs the real validator over a throwaway repository; returns its output.
 *
 * `realAssets` copies this repository's assets/ across, which the cases built
 * from the real _data need: site.json points brand_image at a committed file,
 * and validateImage fails on a local path with nothing behind it.
 */
function validate({ site, uploads = {}, readingsData, podcastsData, memesData, realAssets = false }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ar-validate-"));
  try {
    fs.mkdirSync(path.join(root, "scripts"));
    fs.copyFileSync(validator, path.join(root, "scripts", "validate-content.js"));
    fs.mkdirSync(path.join(root, "_data"));
    const write = (name, value) =>
      fs.writeFileSync(path.join(root, "_data", name), JSON.stringify(value));
    write("site.json", site);
    write("readings.json", readingsData || readings());
    write("podcasts.json", podcastsData || { guests: [] });
    write("memes.json", memesData || { items: [] });
    if (realAssets) {
      fs.cpSync(path.join(repoRoot, "assets"), path.join(root, "assets"), { recursive: true });
    }
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

// --- The exact documents the image panel produces, built from the real
// _data/site.json, the real index.html, and the panel's own seeding helper.
// Hand-written fixtures are what let the door-art regression through: they said
// decorative: true while the panel produced decorative: false.

const repoRoot = path.resolve(here, "..");
const realSite = JSON.parse(fs.readFileSync(path.join(repoRoot, "_data", "site.json"), "utf8"));
const realReadings = JSON.parse(fs.readFileSync(path.join(repoRoot, "_data", "readings.json"), "utf8"));
const realPodcasts = JSON.parse(fs.readFileSync(path.join(repoRoot, "_data", "podcasts.json"), "utf8"));
const realMemes = JSON.parse(fs.readFileSync(path.join(repoRoot, "_data", "memes.json"), "utf8"));
const indexHtml = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");

/** The whole element carrying data-edit-image="<spec>" in index.html. */
function editableImageTag(spec) {
  const at = indexHtml.indexOf(`data-edit-image="${spec}"`);
  assert.notEqual(at, -1, `index.html has no data-edit-image="${spec}"`);
  return indexHtml.slice(indexHtml.lastIndexOf("<", at), indexHtml.indexOf(">", at) + 1);
}

/** How editor.js reads decorativeness: the presence of the boolean attribute. */
const rendersDecorative = (spec) => editableImageTag(spec).includes("data-edit-image-decorative");

const DOOR_SPEC = "site:home.formats[key={{ format.key }}].image";
const HERO_SPEC = "site:home.hero.image";

/** What openImagePanel's file-picker handler leaves in the draft. */
function afterUpload(image, decorative, repoPath) {
  const result = JSON.parse(JSON.stringify(image));
  for (const [key, value] of seedImageWrites(result, decorative)) {
    result[key] = value;
  }
  result.path = repoPath;
  return result;
}

test("index.html marks the door art decorative and the hero not", () => {
  // Both assertions below depend on this, so state it rather than assume it.
  assert.equal(rendersDecorative(DOOR_SPEC), true);
  assert.equal(rendersDecorative(HERO_SPEC), false);
});

test("a door upload with no alt text passes the real validator", () => {
  const decorative = rendersDecorative(DOOR_SPEC);
  const formats = realSite.home.formats.map((format, index) =>
    index === 0
      ? { ...format, image: afterUpload(format.image, decorative, "assets/uploads/door.png") }
      : format
  );
  // The panel hides the alt field for this slot, so CI must not demand alt text
  // for it — there would be no way to supply it.
  assert.equal(formats[0].image.decorative, true);
  assert.equal(formats[0].image.alt, "");
  const result = validate({ site: baseSite({ formats }), uploads: { "door.png": ONE_PIXEL_PNG } });
  assert.ok(result.ok, result.output);
});

test("a hero upload with no alt text still fails the real validator", () => {
  const image = afterUpload(realSite.home.hero.image, rendersDecorative(HERO_SPEC), "assets/uploads/hero.png");
  // The accessibility gate on meaningful images must not be weakened by the
  // door-art fix: the panel shows an alt field here, so CI may demand one.
  assert.equal(image.decorative, false);
  assert.equal(image.alt, "");
  const result = validate({
    site: baseSite({ hero: { image } }),
    uploads: { "hero.png": ONE_PIXEL_PNG }
  });
  assert.equal(result.ok, false);
  assert.match(result.output, /provide alt text for a meaningful local image/);
});

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

// --- collection key uniqueness ---
//
// The editor addresses collection items by key — podcasts.guests[key=…],
// memes.items[key=…], readings.posts[url=…]. Two items sharing a key resolve
// to the same one, so an edit silently lands on the wrong card.

test("a duplicate reading url fails validation", () => {
  const readingsData = readings();
  readingsData.posts[1].url = readingsData.posts[0].url;
  const result = validate({ site: baseSite(), readingsData });
  assert.equal(result.ok, false);
  assert.match(result.output, /readings\.json.*posts.*url.*duplicate/i);
});

test("a duplicate meme key fails validation", () => {
  const memesData = { items: [memeItem("same-key"), memeItem("same-key")] };
  const result = validate({ site: baseSite(), memesData });
  assert.equal(result.ok, false);
  assert.match(result.output, /memes\.json.*items.*key.*duplicate/i);
});

test("a duplicate podcast guest key fails validation", () => {
  const podcastsData = { guests: [guest("same-key"), guest("same-key")] };
  const result = validate({ site: baseSite(), podcastsData });
  assert.equal(result.ok, false);
  assert.match(result.output, /podcasts\.json.*guests.*key.*duplicate/i);
});

test("the real repository data has no duplicates", () => {
  const result = validate({
    site: baseSite(),
    readingsData: realReadings,
    podcastsData: realPodcasts,
    memesData: realMemes
  });
  assert.ok(result.ok, result.output);
});

// --- The editor's rules and this validator must agree ----------------------
// editor/lib/rules.js mirrors the checks below so an edit that would break the
// owner's CI is refused at the point of edit instead. Each case is one row of
// the reviewer's reproduction: make the edit the editor allows, run the REAL
// validator over it, and assert both that CI would have failed and that the
// editor now refuses it.

function withReadings(mutate) {
  const copy = structuredClone(realReadings);
  mutate(copy);
  return copy;
}

function withPodcasts(mutate) {
  const copy = structuredClone(realPodcasts);
  mutate(copy);
  return copy;
}

function withMemes(mutate) {
  const copy = structuredClone(realMemes);
  mutate(copy);
  return copy;
}

test("the real data as it ships passes the validator", () => {
  const result = validate({
    site: realSite,
    realAssets: true,
    readingsData: realReadings,
    podcastsData: realPodcasts,
    memesData: realMemes
  });
  assert.ok(result.ok, result.output);
});

test("deleting a reading's title fails the validator, and the editor refuses it", () => {
  const spec = `readings:posts[url=${realReadings.posts[0].url}].title`;
  const result = validate({
    site: realSite,
    realAssets: true,
    readingsData: withReadings((data) => {
      data.posts[0].title = "";
    }),
    podcastsData: realPodcasts,
    memesData: realMemes
  });
  assert.equal(result.ok, false);
  assert.match(result.output, /posts\[0\]\.title: title is required/);
  assert.ok(textRejection(spec, ""), "the editor must refuse the same edit");
});

test("clearing a meme's title fails the validator, and the editor refuses it", () => {
  const spec = `memes:items[key=${realMemes.items[0].key}].title`;
  const result = validate({
    site: realSite,
    realAssets: true,
    readingsData: realReadings,
    podcastsData: realPodcasts,
    memesData: withMemes((data) => {
      data.items[0].title = "  ";
    })
  });
  assert.equal(result.ok, false);
  assert.match(result.output, /items\[0\]\.title: title is required/);
  assert.ok(textRejection(spec, "  "));
});

test("clearing the Listen or Invite link fails the validator, and the editor refuses it", () => {
  for (const [key, spec] of [
    ["show", "podcasts:page.show.url"],
    ["invite", "podcasts:page.invite.url"]
  ]) {
    const result = validate({
      site: realSite,
      realAssets: true,
      readingsData: realReadings,
      podcastsData: withPodcasts((data) => {
        data.page[key].url = "";
      }),
      memesData: realMemes
    });
    assert.equal(result.ok, false, key);
    assert.match(result.output, new RegExp(`page\\.${key}\\.url: URL is required`));
    assert.ok(textRejection(spec, ""), spec);
  }
});

test("an http:// link fails the validator, and the editor refuses it", () => {
  const result = validate({
    site: realSite,
    realAssets: true,
    readingsData: realReadings,
    podcastsData: withPodcasts((data) => {
      data.page.show.url = "http://open.spotify.com/show/x";
    }),
    memesData: realMemes
  });
  assert.equal(result.ok, false);
  assert.match(result.output, /page\.show\.url: use an HTTPS URL/);
  assert.ok(textRejection("podcasts:page.show.url", "http://open.spotify.com/show/x"));
});

test("a guest link's http:// URL fails the validator, and the editor refuses it", () => {
  const result = validate({
    site: realSite,
    realAssets: true,
    readingsData: realReadings,
    podcastsData: withPodcasts((data) => {
      data.guests[0].links[1].url = "http://example.com/elsewhere";
    }),
    memesData: realMemes
  });
  assert.equal(result.ok, false);
  assert.match(result.output, /guests\[0\]\.links\[1\]\.url: use an HTTPS URL/);
  assert.ok(
    textRejection(
      `podcasts:guests[key=${realPodcasts.guests[0].key}].links[index=1].url`,
      "http://example.com/elsewhere"
    )
  );
});

test("a guest photo with no alt text fails the validator, and the editor refuses staging it", () => {
  const result = validate({
    site: realSite,
    realAssets: true,
    readingsData: realReadings,
    podcastsData: withPodcasts((data) => {
      data.guests[0].image.path = "assets/uploads/guest.png";
      data.guests[0].image.alt = "";
    }),
    memesData: realMemes,
    uploads: { "guest.png": ONE_PIXEL_PNG }
  });
  assert.equal(result.ok, false);
  assert.match(result.output, /guests\[0\]\.image\.alt: provide alt text/);
  assert.ok(altRejection({ alt: "", decorative: false }), "the picker must refuse to stage it");
});

test("script content anywhere fails the validator, and the editor refuses it", () => {
  const result = validate({
    site: realSite,
    realAssets: true,
    readingsData: realReadings,
    podcastsData: realPodcasts,
    memesData: withMemes((data) => {
      data.items[0].caption = "see <script>alert(1)</script>";
    })
  });
  assert.equal(result.ok, false);
  assert.match(result.output, /script content is not allowed/);
  assert.ok(textRejection("memes:items[key=x].caption", "see <script>alert(1)</script>"));
});

test("the editor allows every edit the validator allows in these same fields", () => {
  const result = validate({
    site: realSite,
    realAssets: true,
    readingsData: withReadings((data) => {
      data.posts[0].subtitle = "";
    }),
    podcastsData: withPodcasts((data) => {
      data.page.show.url = "#anchor";
    }),
    memesData: withMemes((data) => {
      data.items[0].caption = "";
      data.items[0].art.stamp = "";
    })
  });
  assert.ok(result.ok, result.output);
  assert.equal(textRejection("readings:posts[index=0].subtitle", ""), null);
  assert.equal(textRejection("podcasts:page.show.url", "#anchor"), null);
  assert.equal(textRejection("memes:items[key=x].caption", ""), null);
  assert.equal(textRejection("memes:items[key=x].art.stamp", ""), null);
});
