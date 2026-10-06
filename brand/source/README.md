# Handoff: Cirrus Cc rebrand (formerly Horizon COMPASS)

## Overview
The product **Horizon COMPASS** is renamed **Cirrus Cc**. Apply the new name, logo, favicon, colours and copy across the applications (desktop web app, mobile field app, client portal) and any marketing pages. Palette and fonts are unchanged from Horizon COMPASS; the name, symbol and some token names are new.

**What "Cc" means:** a carbon copy of the work, consultant to client. It also stands for **C**onsultant to **C**lient, and it is the meteorological abbreviation for cirrocumulus. The product idea is that the client is "cc'd" on every interaction the PI team logs, live.
- **Tagline:** "Consultant to client, in real time"

## About the design files
Everything in `reference/` is a **design reference built in HTML**, not production code. Rebuild the look in the target codebase's existing framework and patterns.
- **Production-ready:** the files in `assets/` (SVG) and `tokens/` can be used directly.
- **Opening the references:** open the `.dc.html` files in a browser. `support.js` must stay alongside them.

## Fidelity
**High fidelity.** Colours, type, logo geometry and copy are final.

## Rename rules
- **The name:** "Horizon COMPASS" / "HORIZON COMPASS" / "COMPASS" (as the product name) becomes **Cirrus Cc** in body copy, or **CIRRUS Cc** in caps contexts.
  - "Cc" always has an uppercase C and a lowercase c. Never write "CC" or "cc".
- **Page title:** `Cirrus Cc — Stakeholder Management`
- **Subtitle / descriptor:** `STAKEHOLDER MANAGEMENT`
- **Domains:** web `cirruscc.com` (shown as `www.cirruscc.com` on print), app `app.cirruscc.com`.
  - Remove `putzke.github.io/horizoncompass`, `horizoncompass.com`, `jputzke@sunrise-eng.com`.
- **Contact email:** `putzke@hotmail.com`
- **Founder:** Jeffrey Putzke, Founder / CEO

## Logo
### Symbol: evolved compass (direction 1a)
Drawn on a 100×100 viewBox. Light-background version:

| Element | Geometry | Light | Dark |
|---|---|---|---|
| Ring | circle c(50,50) r37, stroke 3 | #141A24 | #FFFFFF |
| Horizon line | line 14,50 → 86,50, stroke 2.4 | #141A24 @ 32% | #FFFFFF @ 40% |
| Arc (top-right quarter) | `M50 13 A37 37 0 0 1 84.5 36.5`, stroke 7.5, round cap | Cirrus #1F7A9C | #1F7A9C |
| Cirrus wisp | `M42 4.8 A46 46 0 0 1 89.5 27 Q93 33 98.5 31`, stroke 3.4, round cap | Sky #35A6C9 | #35A6C9 |
| Needle pointer (NE) | polygon 65.6,34.4 52.97,52.97 47.03,47.03 | Pointer #A4302A | #C24A42 |
| Needle tail (SW) | polygon 38,62 52.97,52.97 47.03,47.03 | #3A4250 | #FFFFFF |
| Hub | circle r4 | #141A24 | #FFFFFF |

- **Monochrome:** all elements in one colour (Ink or white). The needle tail becomes an outline (stroke 2, no fill) so it stays distinct from the pointer.
- **App icon (≥48 px):** the horizon line is dropped and strokes are heavier: ring 4.4, arc 10, wisp 5, hub r5.2.
  - Tile: Ink #141A24, corner radius ≈ 22.5% of the tile size (iOS-style). The symbol is ~60% of the tile.
- **Favicon (≤32 px):** a simplified mark with only the ring (stroke 7, white), arc (stroke 13, **Sky**), a larger pointer (#C24A42, `70,30 54,54 46,46`) and hub r7.
  - The wisp, horizon line and tail are dropped.
  - The arc is Sky, not Cirrus, so it keeps contrast on Ink.

### Wordmark
- **CIRRUS:** Michroma 400, letter-spacing 0.02em, line-height 1. Ink on light, white on dark.
- **Cc badge:** Michroma at **50% of the CIRRUS font size**, coloured Sky #35A6C9. It has a 1.5px Sky border (1px below ~22px wordmark size) and radius 3px. Padding is 0.1em / 0.17em / 0.07em of the CIRRUS size (top / sides / bottom).
  - Align the badge to the **top** of the cap height, with a gap of 0.3 × the CIRRUS size.
- **Subtitle:** "STAKEHOLDER MANAGEMENT" in Saira 300, uppercase, letter-spacing 0.4em, size ≈ 0.37 × the CIRRUS size (min 8px), with margin-top 0.4 × the CIRRUS size. Colour #5A6573 on light, #FFFFFF on dark.

### Lockups
- **Horizontal:** symbol on the left, with the symbol size about 3× the CIRRUS size (e.g. 104px symbol with 34px CIRRUS). Gap is 0.3 × the symbol size. Wordmark and subtitle are stacked on the right, vertically centred.
- **Stacked:** symbol centred on top, gap 0.26 × the symbol size, with the wordmark and subtitle centred below.
- **Short-name badge:** app tile plus CIRRUS Cc, with no subtitle. Use for app store listings and avatars.
- **Wordmark only:** for email headers and narrow nav bars.
- **Minimum sizes:** full lockup 160px wide; below that, use the symbol or the favicon.

## Assets (`assets/`)
- `cirrus-cc-symbol-{light,dark,ink,white}.svg`: symbol only, no text, safe everywhere.
- `cirrus-cc-lockup-horizontal-{light,dark,ink,white}.svg`
- `cirrus-cc-lockup-stacked-{light,dark,ink,white}.svg`
- `cirrus-cc-wordmark-{light,dark,ink,white}.svg`
- `cirrus-cc-app-icon.svg`: 1024×1024 Ink tile, for iOS/Android/PWA icon generation.
- `cirrus-cc-favicon.svg`: 32×32. Use as `<link rel="icon" type="image/svg+xml">` and generate .ico/PNG fallbacks (16, 32, 180 apple-touch, 192, 512).

The lockup and wordmark SVGs use live `<text>` in Michroma and Saira, loaded from Google Fonts.
- **Before production:** open them in a vector tool and **convert the text to outlines**, or render them in-app as HTML text plus the symbol SVG. Character positions are approximate when the fonts aren't loaded.
- **Precise reference:** the HTML in `reference/Cirrus Cc Logo Suite.dc.html` is the source of truth for spacing.

## Design tokens (`tokens/`)
| Token | Hex | Use |
|---|---|---|
| Ink | #141A24 | Primary dark; type on light |
| Cirrus | #1F7A9C | Primary brand blue; headers, icons, compass arc (was "Horizon") |
| Sky | #35A6C9 | Interactive elements, links, Cc badge, **live indicator in the client portal** |
| Paper | #F4F2ED | Page and card backgrounds |
| Haze | #8A93A0 | Secondary text, dividers, muted labels |
| Amber | #C4862F | Overdue flags, deadline indicators, alert states |
| Pointer | #A4302A | Compass needle, error states, critical alerts only (use #C24A42 on dark) |
| Slate | #5A6573 | Secondary body text on light |

- **Fonts:** Michroma (wordmark, display headlines, section labels in caps with 0.13–0.18em tracking) and Saira (300/400/500/600/700, plus italic 300/400 for the tagline).
- **Ready-made files:** `cirrus-cc-tokens.css` (CSS custom properties) and `cirrus-cc-tokens.json`.

## Where to apply in the apps
1. **Browser tab title and favicon** on all apps (web, mobile, client portal).
2. **Top nav / app header:** horizontal reversed lockup on an Ink bar, or the wordmark only when there's less than ~200px of height or width.
3. **Login / sign-in screens:** stacked lockup plus the tagline "Consultant to client, in real time" in Saira italic, Sky.
4. **Client portal:** use the Cc idea in the UI.
   - Live/real-time indicators use Sky.
   - A small Cc badge plus "You're cc'd on this project" (or similar) in the portal header is on-brand.
5. **PWA manifest:** `name: "Cirrus Cc"`, `short_name: "Cirrus Cc"`, `theme_color: #141A24`, `background_color: #F4F2ED`.
6. **Report and Word exports:** replace the Horizon COMPASS branding in any generated document footers.
7. **Email notifications:** wordmark only in the header. From name "Cirrus Cc".
8. **Code:** search for `Horizon`, `COMPASS`, `horizoncompass` and `putzke.github.io`, and replace them per the rename rules.
   - Don't rename internal database identifiers unless intended.

## Files in this bundle
- `reference/Cirrus Cc Logo Suite.dc.html`: the full logo suite.
  - Logo variants A–I, the CIRRUS acronym card (Consultant · Involvement · Registry · Reporting · Updates · System), conference badge, business cards, founder card, fact sheet header band, browser-tab mockup, palette and founder bio sheet.
- `reference/Cirrus Cc Fact Sheet - PI Platform.dc.html`: Letter portrait, with current product copy and feature list.
- `reference/Cirrus Cc Fact Sheet - Mobile App.dc.html`: Letter landscape.
- `reference/support.js`: runtime needed to open the reference files.
- `assets/`, `tokens/`: as above.
