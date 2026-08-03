# Chrome Web Store listing

Source of truth for store-facing identity text and imagery.

## Identity

- **Name:** Split for Hacker News
- **Category:** Tools (News & Weather is the alternative)
- **Summary (short description):** Find and open the Hacker News discussion
  for the article you are reading.

## Description

> Reading an article and wondering what Hacker News thinks? Split for Hacker
> News finds the exact discussion for the page you are on and opens it after
> one explicit click.
>
> - One click from the article to its Hacker News comments.
> - Exact URL matching — no fuzzy guesses, duplicates are listed as
>   alternatives.
> - The first click opens an adjacent tab; pair it with the article using
>   Chrome Split View and later selections reuse that pane.
> - Optional toolbar badge with the comment count, off by default.
> - Free. No telemetry, no accounts, no page reading. Narrow, documented
>   permissions.
>
> Unofficial. This extension is an independent project and is not affiliated
> with or endorsed by Y Combinator or Hacker News.

Keep the unofficial disclaimer in every published description revision.

## Source assets

Vector sources live in [`assets/identity/`](../assets/identity/):

- `logo-mark.svg` — the mark: a rounded tile split into a light article pane
  and an orange discussion pane. An original mark with no third-party brand
  elements.
- `promo-small.svg`, `promo-marquee.svg` — promotional tile compositions.

`pnpm assets:generate` renders every store dimension from those sources with
the project's Chromium (no extra dependencies): it writes the extension icons,
builds `dist`, and captures the store screenshots from the real built popup and
options pages against deterministic lookup fixtures. Regenerate and commit the
PNGs whenever the sources or the captured UI change.

## Generated store images

Chrome Web Store dimensions current as of 2026-08-03
([image guidelines](https://developer.chrome.com/docs/webstore/images)).

| File | Size | Store slot |
| --- | --- | --- |
| `public/icons/icon-128.png` | 128×128 (96×96 art + 16px padding) | Store icon / manifest 128 |
| `public/icons/icon-{16,32,48}.png` | 16/32/48 | Manifest and toolbar icons |
| `assets/store/small-promo-440x280.png` | 440×280 | Small promo tile |
| `assets/store/marquee-1400x560.png` | 1400×560 | Marquee promo tile |
| `assets/store/screenshot-1-discussion-1280x800.png` | 1280×800 | Screenshot 1 |
| `assets/store/screenshot-2-private-defaults-1280x800.png` | 1280×800 | Screenshot 2 |
| `assets/store/screenshot-3-dark-1280x800.png` | 1280×800 | Screenshot 3 |

## Accessible alt text

The store dashboard has no alt-text field, so this is the canonical alt text
for every surface that supports it (README, website, release posts).

- **Icon / logo mark:** "Split for Hacker News logo: a rounded tile split into
  a light article pane and an orange discussion pane."
- **Small promo tile:** "Split for Hacker News. Open the discussion behind the
  article you are reading. Free, no telemetry, unofficial."
- **Marquee tile:** "Split for Hacker News beside a browser window split
  between an article and its orange Hacker News discussion pane. Find and open
  the Hacker News discussion for the article you are reading."
- **Screenshot 1:** "Extension popup titled Hacker News discussion showing an
  Open discussion button with 128 comments and 342 points, plus an
  alternative thread, next to the caption 'From article to discussion in one
  click'."
- **Screenshot 2:** "Options page with the automatic toolbar badge switch off
  by default, under the caption 'Private by default: no telemetry, no
  accounts, no page reading'."
- **Screenshot 3:** "The same popup in dark mode under the caption 'At home in
  light and dark'."
