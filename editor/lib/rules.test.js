import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { specShape, textRejection, urlRejection, altRejection } from "./rules.js";
import { parseSpec, collectMatches } from "./paths.js";

const data = {
  site: JSON.parse(fs.readFileSync(new URL("../../_data/site.json", import.meta.url), "utf8")),
  readings: JSON.parse(fs.readFileSync(new URL("../../_data/readings.json", import.meta.url), "utf8")),
  podcasts: JSON.parse(fs.readFileSync(new URL("../../_data/podcasts.json", import.meta.url), "utf8")),
  memes: JSON.parse(fs.readFileSync(new URL("../../_data/memes.json", import.meta.url), "utf8"))
};

const valuesFor = (spec) => {
  const { file, segments } = parseSpec(spec);
  return collectMatches(data[file], segments);
};

// --- specShape -------------------------------------------------------------

test("specShape flattens every addressing form to the same shape", () => {
  assert.equal(specShape("readings:posts[url=https://x.test/a].title"), "readings:posts[].title");
  assert.equal(specShape("readings:posts[index=3].title"), "readings:posts[].title");
  assert.equal(specShape("readings:posts[url={{ post.url }}].title"), "readings:posts[].title");
});

test("specShape flattens a compound spec", () => {
  assert.equal(
    specShape("podcasts:guests[key=stanford].links[index=1].url"),
    "podcasts:guests[].links[].url"
  );
});

test("specShape leaves a plain path alone", () => {
  assert.equal(specShape("podcasts:page.show.url"), "podcasts:page.show.url");
});

// --- required text ---------------------------------------------------------

const REQUIRED_TITLE_SPECS = [
  "readings:posts[url={{ post.url }}].title",
  "memes:items[key={{ item.key }}].title"
];

test("every required title in the real data passes the rule as it stands", () => {
  for (const spec of REQUIRED_TITLE_SPECS) {
    for (const value of valuesFor(spec)) {
      assert.equal(textRejection(spec, value), null, `${spec}: ${JSON.stringify(value)}`);
    }
  }
});

test("clearing a required title is refused, in words", () => {
  for (const spec of REQUIRED_TITLE_SPECS) {
    for (const value of ["", "   ", "\n\t "]) {
      const message = textRejection(spec, value);
      assert.match(String(message), /needs a title/, `${spec}: ${JSON.stringify(value)}`);
    }
  }
});

test("a required title is refused however the template addresses the item", () => {
  assert.ok(textRejection("readings:posts[index=0].title", ""));
  assert.ok(textRejection("memes:items[key=receipts].title", ""));
});

test("an optional field the validator only type-checks may be cleared", () => {
  // validate-content.js checks subtitle and caption for `typeof string` only.
  // Refusing "" here would be stricter than CI, which is its own bug.
  assert.equal(textRejection("readings:posts[index=0].subtitle", ""), null);
  assert.equal(textRejection("memes:items[key=receipts].caption", ""), null);
  assert.equal(textRejection("memes:items[key=receipts].art.stamp", ""), null);
  assert.equal(textRejection("site:home.hero.thesis", ""), null);
});

test("the two link fields the validator never URL-checks may hold anything", () => {
  // validateLinks matches keys named exactly "url" or "linkedin", so neither of
  // these is ever checked. The editor must not invent a rule CI does not have.
  assert.equal(textRejection("site:home.hero.cta_url", ""), null);
  assert.equal(textRejection("readings:page.archive_url", "not a url at all"), null);
});

// --- script content --------------------------------------------------------

test("script content is refused anywhere, mirroring validateText", () => {
  assert.match(String(textRejection("site:home.hero.thesis", "<script>alert(1)</script>")), /script/);
  assert.match(String(textRejection("memes:items[key=receipts].caption", "javascript:alert(1)")), /script/);
  assert.match(String(textRejection("site:footer.note", "</SCRIPT >")), /script/);
});

test("ordinary prose about scripts is not refused", () => {
  assert.equal(textRejection("site:home.hero.thesis", "A script for the podcast"), null);
});

// --- URLs ------------------------------------------------------------------

const URL_SPECS = [
  "podcasts:page.show.url",
  "podcasts:page.invite.url",
  "podcasts:guests[key={{ guest.key }}].links[index={{ forloop.index0 }}].url"
];

test("every URL in the real data passes the rule as it stands", () => {
  for (const spec of URL_SPECS) {
    for (const value of valuesFor(spec)) {
      assert.equal(textRejection(spec, value), null, `${spec}: ${value}`);
    }
  }
});

test("a URL field cannot be emptied", () => {
  for (const spec of URL_SPECS) {
    assert.match(String(textRejection(spec, "")), /cannot be left empty/, spec);
    assert.match(String(textRejection(spec, "   ")), /cannot be left empty/, spec);
  }
});

test("an http:// address is refused for every URL field", () => {
  for (const spec of URL_SPECS) {
    assert.match(String(textRejection(spec, "http://example.com/show")), /https:\/\//, spec);
  }
});

test("urlRejection mirrors validateUrl's accepted shapes", () => {
  assert.equal(urlRejection("https://example.com/a?b=c#d"), null);
  assert.equal(urlRejection("#formats"), null, "a fragment is accepted");
  assert.equal(urlRejection("/readings.html"), null, "a root-relative path is accepted");
  assert.equal(urlRejection("readings-evidence.html"), null, "a relative path is accepted");
});

test("urlRejection mirrors validateUrl's refusals", () => {
  assert.ok(urlRejection("ftp://example.com"), "a non-https scheme");
  assert.ok(urlRejection("https://exa mple.com"), "whitespace inside the address");
  assert.ok(urlRejection("https://example.com/<b>"), "markup inside the address");
  assert.ok(urlRejection("what even is this"), "an unparseable internal path");
  assert.ok(urlRejection("://nope"), "an empty scheme");
});

test("a linkedin key is URL-checked too, as validateLinks does", () => {
  assert.ok(textRejection("site:author.linkedin", "http://linkedin.com/in/x"));
  assert.equal(textRejection("site:author.linkedin", data.site.author.linkedin), null);
});

// --- image alt text --------------------------------------------------------

test("an image with no path yet needs no alt text", () => {
  assert.equal(altRejection({ alt: "", path: "", decorative: false }), null);
});

test("a picture about to be uploaded needs alt text first", () => {
  assert.match(String(altRejection({ alt: "", decorative: false })), /short description/);
  assert.match(String(altRejection({ alt: "   ", decorative: false })), /short description/);
});

test("a decorative picture never needs alt text", () => {
  assert.equal(altRejection({ alt: "", decorative: true }), null);
  assert.equal(altRejection({ alt: "", path: "assets/uploads/a.png", decorative: true }), null);
});

test("clearing alt text on an image that already has a path is refused", () => {
  assert.match(
    String(altRejection({ alt: "", path: "assets/uploads/a.png", decorative: false })),
    /short description/
  );
});

test("alt text present is enough", () => {
  assert.equal(altRejection({ alt: "A rooster", path: "assets/uploads/a.png", decorative: false }), null);
});

test("every image in the real data satisfies the alt rule as it stands", () => {
  const check = (value, where) => {
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => check(item, `${where}[${index}]`));
      return;
    }
    if ("path" in value && "alt" in value && "fit" in value && "focus" in value) {
      assert.equal(
        altRejection({ alt: value.alt, path: value.path, decorative: value.decorative === true }),
        null,
        where
      );
    }
    for (const [key, child] of Object.entries(value)) check(child, `${where}.${key}`);
  };
  for (const [name, file] of Object.entries(data)) check(file, name);
});
