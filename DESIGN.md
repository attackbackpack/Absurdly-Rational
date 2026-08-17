---
name: Absurdly Rational
description: Editorial signal board for evidence, policy, podcasts, and absurdist commentary.
colors:
  background: "#07080a"
  surface: "#101218"
  surface-strong: "#151821"
  text: "#f4f6f8"
  muted: "#aab3bf"
  faint: "#7c8694"
  violet: "#c7aeff"
  blue: "#7f9cff"
  teal: "#6ee0cd"
  line: "rgba(244, 246, 248, 0.13)"
  line-strong: "rgba(199, 174, 255, 0.42)"
typography:
  display:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "clamp(3.2rem, 8vw, 6rem)"
    fontWeight: 650
    lineHeight: 0.94
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "clamp(2rem, 4vw, 3.5rem)"
    fontWeight: 620
    lineHeight: 1.02
    letterSpacing: "-0.035em"
  title:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "clamp(1.7rem, 3.2vw, 2.8rem)"
    fontWeight: 620
    lineHeight: 1.05
    letterSpacing: "-0.035em"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.65
  metadata:
    fontFamily: "DM Mono, monospace"
    fontSize: "0.78rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0.02em"
  navigation:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.84rem"
    fontWeight: 600
    lineHeight: "normal"
  action:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 650
    lineHeight: "normal"
rounded:
  surface: "14px"
  pill: "999px"
  media-inset: "10px"
spacing:
  page-gutter: "24px"
  page-gutter-mobile: "16px"
  surface-gap: "18px"
  nav-gap: "28px"
components:
  nav-link-active:
    backgroundColor: "{colors.text}"
    textColor: "{colors.background}"
    typography: "{typography.navigation}"
    rounded: "{rounded.pill}"
    padding: "9px 13px"
    height: "40px"
  button-light:
    backgroundColor: "{colors.text}"
    textColor: "{colors.background}"
    typography: "{typography.action}"
    rounded: "{rounded.pill}"
    padding: "13px 21px"
    height: "48px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.action}"
    rounded: "{rounded.pill}"
    padding: "13px 21px"
    height: "48px"
  editorial-surface:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.surface}"
    padding: "0"
  format-door:
    textColor: "{colors.text}"
    rounded: "{rounded.surface}"
    padding: "0"
  meme-tile:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.surface}"
    padding: "0"
  dialog-control:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.navigation}"
    rounded: "{rounded.pill}"
    padding: "10px 15px"
    height: "44px"
---

# Design System: Absurdly Rational

## Overview

**Creative North Star: "Editorial Signal Board"**

The shipped system treats Absurdly Rational as a concise signal board: a near-black field, a rooster mark, and restrained signal accents make the editorial voice feel authored without becoming institutional. Depth comes from tonal layering, thin lines, and geometric marks rather than decorative glass or invented imagery.

Inter carries display and reading text; DM Mono marks compact metadata and source-like labels. Surfaces are gently curved, controls are pills, and each format can keep its own rhythm while sharing one visual grammar. Motion is limited to a breathing signal pulse and responsive state transitions, with a reduced-motion fallback.

**Key Characteristics:**
- Near-black ground with sparse violet, blue, and teal signals.
- Crisp geometric authored treatments paired with the rooster mark.
- Asymmetric editorial composition instead of a same-size card grid.
- Tonal and line-based depth with one signal-pulse motion idea.

## Colors

The palette is an ink field with cool paper text and three luminous signal colors. Accents identify emphasis, state, and format without turning the page into a saturated canvas.

### Primary
- **Signal Violet** (`{colors.violet}`): the main authored accent for thesis lines, metadata, active hover, and editorial emphasis.

### Secondary
- **Signal Blue** (`{colors.blue}`): a cooler structural signal for axes, brackets, and secondary geometry.

### Tertiary
- **Signal Teal** (`{colors.teal}`): a live confirmation signal for focus, stamps, selected geometry, and cross-lines.

### Neutral
- **Deep Night** (`{colors.background}`): the persistent page ground.
- **Ink Surface** (`{colors.surface}`) and **Raised Ink** (`{colors.surface-strong}`): quiet tonal layers behind authored art and dialogs.
- **Paper White** (`{colors.text}`): headings, primary actions, and high-priority links.
- **Blue Gray** (`{colors.muted}`) and **Faint Slate** (`{colors.faint}`): supporting copy and low-priority footer text.
- **Hairlines** (`{colors.line}` / `{colors.line-strong}`): thin separation and interactive emphasis.

**The Signal Rarity Rule.** Keep violet, blue, and teal sparse; their rarity is what makes a signal legible.

## Typography

**Display Font:** Inter (with `system-ui, sans-serif` fallback)  
**Body Font:** Inter (with `system-ui, sans-serif` fallback)  
**Label/Mono Font:** DM Mono (with `monospace` fallback)

**Character:** Inter is direct, compact, and editorial at heavy weights; DM Mono adds a diagnostic, source-note register to small labels without turning the whole site into a terminal.

### Hierarchy
- **Display** (650, fluid display scale, compressed leading): major page and hero titles.
- **Headline** (620, fluid section scale): section introductions and contextual statements.
- **Title** (620, fluid card scale): format, reading, guest, and dialog titles.
- **Body** (400, 1rem with generous leading): descriptions and explanatory copy, usually kept to readable measure.
- **Label** (DM Mono, compact, slightly tracked): metadata, stamps, and source cues.

**The Tight Headline Rule.** Heavy headlines may use tight leading and negative tracking; supporting copy stays muted and open.

## Layout

The shared content frame caps at 1120px with 24px desktop gutters and 16px mobile gutters. The fixed navigation begins as an open bar, then becomes a centered 760px pill after scrolling; the current route is an inverse paper-white pill. The homepage uses a wide signal-and-copy hero, then an asymmetric switchboard with one full-width surface and two smaller surfaces. Secondary surfaces preserve the same frame but shift into feature-plus-list, show-plus-guest, or dense authored-art rhythms.

At 900px, wide feature compositions stack. At 720px, content gutters tighten, navigation labels remain touchable at 44px minimum height, rows become single-column, and the meme wall moves to two columns. At 480px, the wall becomes a vertical sequence, media becomes taller, and dialog footer controls stack.

## Elevation & Depth

This is a flat-by-default system. A vertical near-black tonal field, fixed blurred color blooms, quiet surface fills, and 1px borders create depth. The rooster mark has one real drop shadow for separation; blur is reserved for the scrolled navigation pill and the dialog scrim, not used as a decorative surface treatment.

**The Flat by Default Rule.** Do not add card shadows or glass panels; use tone, line, and authored geometry to establish hierarchy.

## Shapes

Surfaces use a consistent 14px radius; controls, navigation, and compact labels use pill geometry. Inner dialog media uses a smaller 10px inset radius. Borders stay thin and crisp, while thumbnail art favors circles, rectangles, crosshairs, brackets, bars, and stamps. Every link and button exposes a 3px teal focus ring with a 4px offset.

## Components

### Buttons
- **Shape:** pill silhouette (`999px`) with a 48px minimum height.
- **Light:** paper-white fill with near-black text; the hover state shifts to signal violet.
- **Outline:** transparent fill with a quiet light border; hover introduces a violet border and a restrained violet tint.
- **Interaction:** both variants lift slightly on hover and use the shared teal focus ring; arrow marks are CSS geometry, not icon assets.

### Cards / Containers
- **Corner Style:** gently curved surfaces (`14px`).
- **Background:** ink surface or transparent copy field beside a tonal art panel.
- **Shadow Strategy:** no surface shadows; see Elevation & Depth.
- **Border:** 1px quiet hairline, strengthened on hover.
- **Internal Padding:** fluid editorial padding, tightened to 28px horizontal padding on small screens.

### Navigation

The fixed navigation pairs the rooster mark with a compact wordmark on wide screens and keeps only the mark on small screens. Links are muted at rest, brighten on hover, and use the inverse paper-white pill for the current page. Once the page is scrolled, the bar becomes a bordered, translucent pill with a purposeful blur.

### Signal Art

Signal art is authored geometry: orbit rings, cross-lines, bars, rectangles, axes, nodes, brackets, and stamped mono labels. It supplies identity to format surfaces and thumbnails without requiring stock photography or invented imagery. The hero orbit is the single recurring animated element.

## Do's and Don'ts

### Do:
- **Do** keep the near-black ground and rooster mark as the persistent identity layer.
- **Do** use violet, blue, and teal as sparse signals against cool neutrals.
- **Do** preserve 14px surfaces, pill controls, thin borders, and the teal focus ring.
- **Do** use crisp geometric treatments when a surface needs authored visual interest.
- **Do** honor the signal pulse and reduced-motion fallback.

### Don't:
- **Don't** introduce decorative glass or ambient card shadows.
- **Don't** flatten every surface into a generic same-size card grid.
- **Don't** add above-heading kickers as a new global pattern.
- **Don't** invent imagery or replace the rooster mark with a generic icon.
- **Don't** use saturated accent fills so heavily that the signals stop signaling.
