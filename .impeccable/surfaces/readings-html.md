---
version: 1
slug: "readings-html"
primary_target: "readings.html"
related_targets: ["readings-evidence.html","readings-policy.html","readings-thinking.html","readings-hospital.html","readings-library.js","styles.css"]
---

# Readings library

- Scope and mode: `readings.html` plus the four `readings-*.html` topic routes; Read mode.
- Audience and job: Readers should recognize Casey Husser's recurring subjects, preview relevant essays without leaving the site, and choose an original Substack post to read.
- Action: Select a topic, scan posts newest-first, then open the chosen essay on Substack.
- Content and proof: Use the current public Absurdly Rational Substack archive for real titles, subtitles or descriptions, publication dates, cover artwork, and destination URLs.
- Constraints: Static HTML/CSS/JavaScript; preserve the existing dark signal-board identity, accessibility, mobile navigation, and truthful external links. Topic cards intentionally use no post imagery.
- Direction: Dedicated topic pages rather than dropdowns. The index is an asymmetric, image-free editorial table of contents; the topic pages reserve real imagery for individual post cards.
- Memorable moment: The quiet abstract topic doors give way to Casey's vivid Substack artwork as soon as a reader enters a topic.
- Unresolved maintenance: New Substack posts require one entry in `readings-library.js`, a category assignment, and placement in the shared date-descending list because the renderer preserves library order; topic counts then update on the topic pages, while the four counts on `readings.html` remain manual.
