# Store listing master copy

The single reviewed English source for every store-facing claim: listing
copy, support and privacy answers, data-use questionnaire answers, reviewer
notes, release notes, and imagery for the four target stores — Chrome Web
Store, Microsoft Edge Add-ons, Firefox Add-ons (AMO), and the App Store
(Safari) — and the input for 40 listing localizations
([`docs/locales.md`](locales.md)). The initial Chrome release publishes all 40
release-reviewed listings; the review method and its limitations are recorded
explicitly in the locale document.

Rules of this document:

- **Owner.** maximtop owns every requirement row below unless a row names
  another owner.
- **No local edits.** Store submissions copy from this file; a claim change
  lands here first, in one reviewed pull request, and then fans out.
- **Sequencing.** Chrome ships first; Firefox, Edge, and Safari follow after
  the Chrome behavior is validated. Browser-specific wording (side panel,
  Split View) is re-cut for each port, but the re-cut text is reviewed here
  before any submission uses it.

## Identity

- **Name (all stores):** Split for Hacker News — 21 characters, within every
  name limit recorded in the matrices below. The name is a brand string and
  is never translated.
- **Category:** Chrome Web Store: Tools (News & Weather is the alternative).
  Edge and AMO pick the closest Tools/Productivity category at submission;
  the App Store category (News or Utilities) is decided in the Safari
  submission task.
- **Unofficial disclaimer:** every published description revision, in every
  store and locale, keeps the disclaimer paragraph from the description
  below. Never claim affiliation or endorsement.

## Canonical copy

### Short summary

Source of truth: `public/_locales/en/messages.json`, key
`extension_description` (62 characters; the manifest limit is 132 in every
locale):

> Find and open Hacker News discussions for the current article.

Chrome and Edge read the store summary / short description from the uploaded
package's manifest `description`, so editing the message catalog is editing
those store fields. AMO's separate summary field (250 max) uses the same
string unchanged.

### App Store subtitle

> From article to discussion

26 characters; the App Store subtitle limit is 30.

### App Store promotional text

> Choose the exact Hacker News discussion for the article you are reading —
> free, telemetry-free, and unofficial.

111 characters; the limit is 170.

### Full description

The master description. Chrome uses it verbatim; Edge requires 250–10,000
characters (it fits); AMO and the App Store use it with browser-specific
bullets re-cut to the shipped feature set of that port.

> Reading an article and wondering what Hacker News thinks? In the popup,
> Split for Hacker News finds exact discussions for the page you are on;
> nothing opens until you choose a result.
>
> - Select a result in the popup to open its Hacker News comments.
> - Exact URL matching — no fuzzy guesses, duplicates are listed as
>   alternatives.
> - The first result selection opens an adjacent tab; pair it with the article
>   using Chrome Split View and later selections reuse that pane.
> - Or open the discussion in the browser side panel. To embed the real Hacker
>   News page, Split temporarily removes framing headers from Hacker News
>   sub-frame responses only while a panel is open.
> - Open in Split in the link right-click menu: the link opens in the
>   current tab and its Hacker News discussion opens in the side panel.
> - Optional: clicking a story on Hacker News opens the article as usual and
>   its discussion in the side panel beside it. Off by default.
> - Optional toolbar badge with the comment count, off by default.
> - Free. No telemetry or accounts. Lookups send only eligible public page or
>   selected-link URLs and an optional canonical URL to Algolia's public Hacker
>   News Search API — never article text or other content. Narrow, documented
>   permissions.
>
> Unofficial. This extension is an independent project and is not affiliated
> with or endorsed by Y Combinator or Hacker News.

### Feature list

The bullets of the description are the canonical feature list for any store
surface with a separate feature field. Do not invent new phrasing per store.

### Release notes

Newest first. Every release adds its entry here before any store submission
uses it.

**v0.1.0 — initial release**

> First public release. Find exact Hacker News discussions for the article
> you are reading, then select a result in the popup to open it in an adjacent
> tab you can pair with Chrome Split View or in the browser side panel. Includes
> the Open in Split link context menu, an opt-in flow that opens discussions
> beside story clicks on Hacker News, and an opt-in comment-count toolbar
> badge. Free, no telemetry, no accounts.

### Screenshot captions

The captions are embedded in the captured screenshots by
`pnpm assets:generate`, which reads them from
`assets/store-listings/<code>.json` (English below, mirrored in `en.json`),
so screenshots and listing captions share one source; a caption change
regenerates imagery, and `pnpm assets:generate --locale <code>` renders the
translated captions.

1. Select a result, open the discussion
2. Private by default: popup reads URLs, never article text or content
3. At home in light and dark

## Support and contact

| Field | Value |
| --- | --- |
| Support URL | `https://github.com/maximtop/hn-split/issues` |
| Homepage URL | `https://github.com/maximtop/hn-split` |
| Support email | `maximtop@gmail.com` |
| Privacy policy URL | `https://github.com/maximtop/hn-split/blob/master/PRIVACY.md` |

Preconditions, owner maximtop:

- The repository and `PRIVACY.md` are public; verify that the support,
  homepage, and privacy URLs above still resolve before submission. If a
  store rejects a repository URL as a privacy policy, publish `PRIVACY.md`
  through GitHub Pages from the same repository with the content unchanged.
- Store dashboards publish contact details (Chrome shows the publisher
  email; Edge shows the registered support contact). The values above are
  the ones to publish.

## Privacy and data-use answers

The canonical privacy text is [`PRIVACY.md`](../PRIVACY.md). The condensed
answers below are derived from it and must never contradict it.

### Single purpose

> Find and open exact Hacker News discussions for pages or links the user
> explicitly chooses.

### Permission justifications

One justification per manifest entry, for the Chrome and Edge privacy forms.
The long-form rationale lives in `PRIVACY.md`.

| Permission | Justification |
| --- | --- |
| `tabs` | Places and reuses the discussion tab next to the article after an explicit result selection; observes navigations and enumerates tabs only for the opt-in availability badge, and clears badges when that setting is turned off. |
| `activeTab` | Scopes popup-triggered page inspection to the tab the user is viewing when they open the extension action. |
| `scripting` | Runs one short-lived function in the active page after the popup opens, reading only `location.href` and the canonical `<link>` element; also registers the `news.ycombinator.com` content script while the opt-in article-click setting is on. |
| `storage` | Persists the two on/off settings in `chrome.storage.local`; keeps time-bounded lookup results and tab associations in `chrome.storage.session`, which the browser discards when the session ends. |
| `contextMenus` | Adds the single Open in Split item to link context menus; the extension learns nothing until the user selects the item. |
| `sidePanel` | Opens the discussion side panel only after an explicit user action: the popup button, the Open in Split menu item, or an opt-in article click. |
| `declarativeNetRequestWithHostAccess` | Installs one dynamic rule that removes `X-Frame-Options`, `Content-Security-Policy`, and report-only CSP from Hacker News sub-frame responses so the real discussion can render in the side panel. The rule exists only while a panel is open, never affects top-level navigation or another host, and cannot be scoped more narrowly than all Hacker News sub-frames in the browser profile. The extension does not read, redirect, or block those requests. |
| Host `https://hn.algolia.com/*` | The discussion lookup endpoint; receives sanitized public article URLs as search queries, with no account, API key, or identifying header. |
| Host `https://news.ycombinator.com/*` | Lets the side panel embed the real discussion page, supports the header rule above, and hosts the opt-in article-click content script. |

### Remote code

**No.** All executable code ships in the package (Manifest V3). The side
panel embeds the Hacker News website as content; no remote script runs as
extension code.

### Data usage — Chrome Web Store and Edge questionnaire

Checked 2026-08-09 against the Chrome privacy tab and Edge Privacy page
documentation.

- Declare exactly three handled data types. Chrome's disclosure covers local
  handling as well as transmission:
  - **Web history.** The extension handles the current page or selected link
    URL. When a lookup is requested, or while the opt-in automatic badge is
    enabled, eligible sanitized public URLs are sent to the public Hacker News
    Algolia search API. Lookup results are cached in session storage only.
  - **Website content.** When the popup is opened, the extension reads only the
    page URL and the URL from its canonical `<link>` element, never article
    text or other content. The canonical URL can be sent to Algolia as a lookup
    candidate. The opt-in Hacker News story-click flow also handles the clicked
    story link and item id locally; that flow makes no lookup request.
  - **User activity.** Only the opt-in Hacker News story-click flow observes a
    click on a story link. The click event is handled locally to open the side
    panel and is not transmitted off the device.
- No other listed category applies: no personally identifiable, health,
  financial, authentication, communications, or location data is handled.
- Certify all three Limited Use disclosures: data is not sold to third parties
  outside the approved use cases; is not used or transferred for purposes
  unrelated to the single purpose; and is not used or transferred to determine
  creditworthiness or for lending.

### Firefox data collection declaration

Required for all new AMO submissions since 2025-11-03 (checked 2026-08-05
against the Extension Workshop data-consent documentation). The Firefox port
adds to its manifest:

```json
"browser_specific_settings": {
    "gecko": {
        "data_collection_permissions": {
            "required": ["browsingActivity", "websiteContent"]
        }
    }
}
```

`browsingActivity` covers current or navigated tab URLs sent to the lookup API;
`websiteContent` covers canonical and user-selected link URLs read from page
content and sent as lookup candidates. Nothing goes in `optional`, and
`technicalAndInteraction` is not declared — there is no telemetry. The Firefox
package requires Firefox 140 or newer so its required-data declaration is
enforced by Firefox's built-in consent experience.

### App Store privacy label

Decided in the Safari submission task against Apple's current definitions;
both candidate answers and the honest tension are recorded here so the
decision is not improvised:

- **Conservative:** declare **Browsing History**, marked *Data Not Linked to
  You*, purpose *App Functionality* — the extension does transmit page URLs
  off the device to a third-party API.
- **Argument for Data Not Collected:** the URL only services the user's own
  real-time request, is retained by no backend of ours, and is never linked
  to an identity.

## Reviewer notes (master)

Paste-ready text for every store's reviewer field. Where it goes: Edge —
**Notes for certification** at submit; AMO — **Notes to Reviewer** on the
version upload; App Store — **App Review Information**; Chrome has no
reviewer-notes field, so the single-purpose and permission-justification
answers above carry the explanation.

> Split for Hacker News needs no account and no test credentials, and has no
> backend of its own. All extension network traffic is GET requests to the
> public Hacker News Algolia search API (hn.algolia.com); the only other
> remote content is the real news.ycombinator.com page shown in a tab or
> embedded in the side panel.
>
> Suggested test:
>
> 1. Open news.ycombinator.com and click any front-page story headline —
>    front-page articles have a discussion by construction. (A stable
>    example article: paulgraham.com/greatwork.html.)
> 2. Click the extension toolbar icon. The popup finds the exact discussion
>    and shows an "Open discussion" button with comment and point counts;
>    duplicate submissions appear as alternatives.
> 3. Click "Open discussion": the discussion opens in an adjacent tab, and a
>    later selection reuses that tab.
> 4. Click "Open in side panel" in the popup: the discussion renders in the
>    browser side panel. The framing-header exception is disclosed on the
>    options page and in PRIVACY.md; it applies to Hacker News sub-frames only
>    while the panel is open.
> 5. Right-click any http(s) link and choose "Open in Split": the link opens
>    in the tab where it was clicked. If an exact Hacker News discussion
>    exists, it loads in the side panel; otherwise the panel reports that no
>    discussion was found.
> 6. Options → "Automatic toolbar badge" (off by default): enable it and an
>    orange comment-count badge appears as tabs navigate to articles with
>    discussions; disabling it clears badges and the session lookup cache.
> 7. Options → "Discussion beside clicked articles" (off by default): enable
>    it, then click a story link on news.ycombinator.com — the article opens
>    in the same tab and its discussion opens in the side panel. This flow
>    reads the story id already present in the page and makes no lookup
>    request.
>
> About `declarativeNetRequestWithHostAccess`: one dynamic rule removes
> `X-Frame-Options`, `Content-Security-Policy`, and
> `Content-Security-Policy-Report-Only` from news.ycombinator.com sub-frame
> responses so the panel can embed the real site. The rule is
> installed when the panel connects and removed when the panel closes; no
> other site is affected, and top-level Hacker News navigation keeps its
> headers. Details: PRIVACY.md and docs/development.md in the repository.

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

The same set serves Edge (440×280 and 1400×560 tiles, 1280×800 screenshots,
maximum 6). Edge recommends a 300×300 logo and accepts a 128×128 minimum;
add a 300×300 export to `scripts/generate-assets.mjs` when the Edge
submission starts. App Store screenshot specifications are per device and
are produced in the Safari submission task.

## Accessible alt text

The store dashboards have no alt-text field, so this is the canonical alt
text for every surface that supports it (README, website, release posts).

- **Icon / logo mark:** "Split for Hacker News logo: a rounded tile split into
  a light article pane and an orange discussion pane."
- **Small promo tile:** "Split for Hacker News. Open the discussion behind the
  article you are reading. Free, no telemetry, unofficial."
- **Marquee tile:** "Split for Hacker News beside a browser window split
  between an article and its orange Hacker News discussion pane. Find and open
  the Hacker News discussion for the article you are reading."
- **Screenshot 1:** "Extension popup titled Hacker News discussion showing an
  Open discussion button with 128 comments and 342 points, plus an
  alternative thread, next to the caption 'Select a result, open the
  discussion'."
- **Screenshot 2:** "Options page with the automatic toolbar badge switch off
  by default, under the caption 'Private by default: popup reads URLs, never
  article text or content'."
- **Screenshot 3:** "The same popup in dark mode under the caption 'At home in
  light and dark'."

## Store requirement matrices

Every row names its source; maximtop owns every row (see the rules at the
top). Limits were checked on the date noted per store.

### Chrome Web Store

Checked 2026-08-05 against the
[listing](https://developer.chrome.com/docs/webstore/cws-dashboard-listing),
[privacy](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy),
and [manifest](https://developer.chrome.com/docs/extensions/reference/manifest)
references. Chrome has no reviewer-notes field.

| Requirement | Limit / rule | Source |
| --- | --- | --- |
| Name | ≤75 chars, from manifest | `extension_name` message (21 ✓) |
| Summary | ≤132 chars, from manifest description | `extension_description` message (62 ✓) |
| Detailed description | complies with keyword-spam policy | This doc, Full description |
| Store icon | 128×128 | `public/icons/icon-128.png` |
| Screenshots | 1–5 at 1280×800; localized sets optional | Upload `assets/store/screenshot-*.png` (3) once as Global screenshots; leave localized screenshots and videos empty for the initial release |
| Small promo tile | 440×280 | `assets/store/small-promo-440x280.png` |
| Marquee tile (optional) | 1400×560 | `assets/store/marquee-1400x560.png` |
| Category | one primary | This doc, Identity (Tools) |
| Support and homepage URL | resolvable | This doc, Support and contact |
| Privacy policy URL | resolvable, covers collection/use/disclosure | `PRIVACY.md` (public URL precondition) |
| Single purpose | concise | This doc, Single purpose |
| Permission justifications | one per manifest entry | This doc, Permission justifications |
| Remote code | declare | No (This doc, Remote code) |
| Data usage + certifications | checkboxes | This doc, Data usage |
| Localized listings | one per logical registry language | 40 translated listings, matching the release gate in `docs/locales.md` |

The Chrome Web Store Store Listing page has no separate release-notes or
screenshot-caption text field. `pnpm store:render chrome <locale>` therefore
prints the manifest-derived name and summary for verification plus only the
localized detailed description that must be pasted. Screenshot captions are
already embedded in the three committed PNGs; upload those files once under
**Global screenshots** so all 40 locale listings inherit them.

### Microsoft Edge Add-ons

Checked 2026-08-05 against the
[publish guide](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension).
Certification takes up to seven business days.

| Requirement | Limit / rule | Source |
| --- | --- | --- |
| Name and short description | read-only in Partner Center, from the uploaded manifest | `extension_name` / `extension_description` messages |
| Description | 250–10,000 chars, per language | This doc, Full description (fits) |
| Logo | 1:1, 300×300 recommended, 128×128 minimum | `icon-128.png` now; 300×300 export when Edge submission starts |
| Screenshots | ≤6 at 640×480 or 1280×800 | `assets/store/screenshot-*.png` |
| Promo tiles (optional) | 440×280 small, 1400×560 large | `assets/store/*.png` |
| Search terms | ≤7 terms, ≤21 words total, ≤30 chars each | hacker news, hn, discussion, comments, side panel, split view, article |
| Privacy page | single purpose, per-permission justifications, remote code, data usage, policy URL | This doc, Privacy and data-use answers |
| Notes for certification | free text at submit | This doc, Reviewer notes (master) |

### Firefox Add-ons (AMO)

Checked 2026-08-05 against the
[listing guide](https://extensionworkshop.com/documentation/develop/create-an-appealing-listing/)
and
[data-consent documentation](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/).
The Firefox port precedes the listing; side panel and Split View wording is
re-cut for Firefox (sidebar) and re-reviewed here first.

| Requirement | Limit / rule | Source |
| --- | --- | --- |
| Summary | ≤250 chars | Short summary, unchanged |
| Description | no practical limit | This doc, Full description, Firefox re-cut |
| Categories | up to 2 | Closest Tools/Productivity fit at submission |
| Data collection declaration | manifest `data_collection_permissions`, required since 2025-11-03 | This doc, Firefox data collection declaration |
| Support email / site, homepage | listed fields | This doc, Support and contact |
| Privacy policy | required (personal data is transmitted) | `PRIVACY.md` (public URL precondition) |
| License | AMO asks at submission | Repository has no LICENSE file yet; decide before the repo goes public (All Rights Reserved is a valid AMO choice) |
| Source code submission | required for minified packages | Repository archive + `pnpm install && pnpm build` per [`docs/development.md`](development.md) |
| Notes to Reviewer | free text per version | This doc, Reviewer notes (master) |

### App Store (Safari)

Checked 2026-08-05 against the
[product page reference](https://developer.apple.com/app-store/product-page/).
Safari does not ship the Chrome side panel or the same header-rule behavior,
so the description and screenshots are re-cut to the feature set the Safari
wrapper actually ships, and re-reviewed here before submission.

| Requirement | Limit / rule | Source |
| --- | --- | --- |
| App name | ≤30 chars | Split for Hacker News (21 ✓) |
| Subtitle | ≤30 chars | This doc, App Store subtitle (26 ✓) |
| Promotional text | ≤170 chars | This doc, App Store promotional text (111 ✓) |
| Description | engaging, first sentence carries | This doc, Full description, Safari re-cut |
| Keywords | ≤100 chars total, comma-separated | `hacker news,hn,discussion,comments,split view,side panel,article,reader` (71 ✓) |
| Screenshots | ≤10 per device, per-device specs | Safari submission task, from the same identity sources |
| Privacy nutrition label | App Store Connect questionnaire | This doc, App Store privacy label |
| App Review Information | notes + contact | This doc, Reviewer notes (master) |
| Support URL | required | This doc, Support and contact |
| What's New | per version | This doc, Release notes |

## Localization handoff

The 40-locale listing source set is implemented; review status, the release
inventory, and per-store locale mappings live in
[`docs/locales.md`](locales.md).

- **Translations** live in `assets/store-listings/<code>.json`, one file per
  registry locale: the structured description (intro, the eight bullets,
  disclaimer), release notes per version, the screenshot caption pairs, Edge
  search terms, and App Store keywords. The short summary stays in the
  message catalogs (`extension_description`), which the stores read from the
  manifest.
- **Publication gate:** Chrome derives its listing languages from the
  `_locales/<code>` directories in the uploaded package; the dashboard has no
  separate documented control for suppressing a packaged locale. The build
  copies the 40 release-reviewed `SHIPPED_LOCALES` plus a byte-identical `no`
  alias for the `nb` Norwegian runtime catalog. Published dual-code packages
  produce one Norwegian listing, so the ZIP has 41 directories for 40 languages.
- **Never translated:** the name — `pnpm locales:validate` fails any catalog
  that changes `extension_name`, and the listing validator requires the
  brand string and the Y Combinator / Hacker News proper nouns verbatim in
  every translation.
- **Length budgets pass automatically:** `pnpm store:validate` (part of
  `pnpm check`) enforces the manifest summary limit (132) per catalog, the
  Edge 250–10,000 description bounds and search-term budgets, the App Store
  keyword/description/What's-New limits, and the caption layout budgets, for
  every locale. Store locale coverage is explicit in
  `scripts/lib/store-listings.ts`: all 40 codes resolve per store, with the
  four App-Store-unsupported locales (bg, fa, fil, sr) served by the en-US
  listing.
- **Paste-ready copy:** `pnpm store:render <store> <locale>` prints the fields
  relevant to that store for one shipped locale submission. For Chrome it
  omits release notes and screenshot captions because those are not dashboard
  text fields.
- **Captions regenerate imagery:** the generator reads captions from the
  listing files, and `pnpm assets:generate --locale <code>` renders that
  locale's screenshots to `build/store-assets/<code>/`; a caption change
  regenerates imagery.
- Translations must preserve the reviewed claims of this document exactly —
  especially the Algolia data flow, no-telemetry, off-by-default, and
  unofficial statements. The validator enforces the structural parts (bullet
  count, disclaimer, brand); `reviewed` records the independent release QA
  described in `docs/locales.md`, and an unreviewed listing cannot enter
  `SHIPPED_LOCALES` without failing validation.
