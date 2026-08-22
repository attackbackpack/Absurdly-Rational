export const PAGES = ["home", "readings", "podcasts", "memes"];

const SEO_LABELS = [
  ["seo.title", "Search result title"],
  ["seo.description", "Search result description"],
  ["seo.og_title", "Social share title"],
  ["seo.og_description", "Social share description"],
  ["seo.twitter_description", "Twitter description"]
];

const CONFIG = {
  home: {
    seoPrefix: "site:home.",
    links: [["site:home.hero.cta_url", "Hero button link"]]
  },
  readings: {
    seoPrefix: "readings:page.",
    links: [["readings:page.archive_url", "Substack archive link"]]
  },
  podcasts: {
    seoPrefix: "podcasts:page.",
    links: [
      ["podcasts:page.show.url", "Listen button link"],
      ["podcasts:page.invite.url", "Invite button link"]
    ]
  },
  memes: { seoPrefix: "memes:page.", links: [] }
};

export function fieldsForPage(page) {
  const config = CONFIG[page];
  if (!config) return { links: [], seo: [] };
  return {
    links: config.links,
    seo: SEO_LABELS.map(([suffix, label]) => [`${config.seoPrefix}${suffix}`, label])
  };
}

// A guest key is interpolated straight into a spec, and parseSpec reads a
// match value as everything up to the first "]". A key carrying a bracket or a
// dot would build a spec that parses into the wrong path — or does not parse at
// all, which in a panel means a blank grey modal. validate-content.js
// constrains site.home.formats[].key this way but not guest keys, so screen
// them here rather than trusting them.
const SAFE_KEY = /^[A-Za-z0-9_-]+$/;

/**
 * Where each guest link points, one field per link.
 *
 * These are per-guest and variable in number, so they cannot live in CONFIG
 * with the fixed page links. They still belong in the page settings panel
 * rather than a new per-guest panel: the design doc lists them there, beside
 * show.url and invite.url, and every click target on a guest card is already
 * spoken for — the art opens the image panel, and every text node including
 * the link's own label is inline click-to-edit. A per-guest panel would need
 * a new affordance on the card for a field the father changes once a year.
 *
 * The label wording is edited on the page; this is only its destination.
 */
export function guestLinkFields(guests) {
  const fields = [];
  for (const guest of Array.isArray(guests) ? guests : []) {
    if (!guest || !SAFE_KEY.test(String(guest.key ?? ""))) continue;
    const links = Array.isArray(guest.links) ? guest.links : [];
    links.forEach((link, index) => {
      const name = (link && link.label) || `Link ${index + 1}`;
      fields.push([`podcasts:guests[key=${guest.key}].links[index=${index}].url`, `“${name}” goes to`]);
    });
  }
  return fields;
}

/**
 * The fields the meme panel offers, as [key suffix, label, control type].
 *
 * art.kicker and art.stamp are here because memes.html wraps each of them in
 * {% if %}: clearing one from the page removes the node on the next rebuild,
 * leaving nothing to click and no way back short of Pages CMS. The panel is
 * the way back.
 */
export const MEME_ITEM_SPEC = "memes:items[key={{ item.key }}]";

export const MEME_FIELDS = [
  ["title", "Title", "text"],
  ["caption", "Caption", "textarea"],
  ["art.headline", "Artwork headline", "textarea"],
  ["art.accent", "Artwork accent", "textarea"],
  ["art.kicker", "Artwork small top line", "text"],
  ["art.stamp", "Artwork stamp", "text"]
];

// art.kicker, art.accent and art.stamp are optional in .pages.yml, so the
// build-time scan must tolerate a meme that simply has not got one — while
// still proving the parent resolves and the value is a string when present.
const OPTIONAL_MEME_SUFFIXES = new Set(["art.kicker", "art.accent", "art.stamp"]);

/**
 * Every edit path the editor's panels address that no template annotates.
 *
 * scripts/validate-edit-paths.mjs scans templates for data-edit attributes,
 * which makes a whole class of specs invisible to the build: the page settings
 * fields below, the guest link URLs, and the meme panel's fields. A key
 * renamed in _data used to surface at runtime as a blank modal
 * (openSettingsPanel calls draft.read with no catch) or as a panel quietly
 * missing a field. Declaring them here puts them in the same scan.
 *
 * Kinds match the scan's assertions: "text" — every match is a string;
 * "optional-text" — string or absent; "image" — an object the image panel can
 * complete.
 */
export function declaredSpecs() {
  const specs = [];
  for (const page of PAGES) {
    const { links, seo } = fieldsForPage(page);
    for (const [spec] of [...links, ...seo]) specs.push({ kind: "text", spec });
  }
  specs.push({
    kind: "text",
    spec: "podcasts:guests[key={{ guest.key }}].links[index={{ forloop.index0 }}].url"
  });
  for (const [suffix] of MEME_FIELDS) {
    specs.push({
      kind: OPTIONAL_MEME_SUFFIXES.has(suffix) ? "optional-text" : "text",
      spec: `${MEME_ITEM_SPEC}.${suffix}`
    });
  }
  specs.push({ kind: "image", spec: `${MEME_ITEM_SPEC}.image` });
  return specs;
}
