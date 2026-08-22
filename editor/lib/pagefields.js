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
