# Priority locales

## Single source of truth

The canonical list of the 40 priority locales lives in [`src/shared/locales.ts`](../src/shared/locales.ts) (`LOCALE_REGISTRY`). The same module exposes `SHIPPED_LOCALES` as the release-reviewed source/listing inventory and `CHROME_PACKAGED_LOCALES` as the physical Chrome package inventory. The Chrome 0.1.0 release ships the full registry plus one generated Chrome Web Store compatibility alias:

- `scripts/validate-locales.mjs` asserts the registry holds exactly 40 unique codes, that `public/_locales/` directories equal the registry, validates every catalog, and checks that the shipped inventory is valid and contains English;
- `rspack.config.ts` copies all `SHIPPED_LOCALES` into every target and adds a byte-identical `no` directory generated from the `nb` source only to the Chrome build;
- `src/shared/i18n.ts` resolves the browser UI language against shipped registry entries;
- `tests/locales.test.ts` pins the registry, the release inventory, the RTL set, and the library mappings.

This document records the decisions around that registry; it deliberately does not duplicate the list.

All 40 reviewed catalogs ship from `public/_locales/`; the additional physical `no` directory is generated from the `nb` source for Chrome builds only. English is the authored source and Russian is hand-translated. The other 38 began as machine translations and were re-synchronized with the final English privacy and feature claims, then independently reviewed by a separate multilingual model pass before release. That review catches semantic drift, stale claims, placeholders, proper nouns, and length budgets, but it is **not a substitute for native-speaker or professional localization review**. The `reviewed` flag means the release gate passed; it does not claim a native reviewer. Native feedback remains welcome and should be applied as a normal copy correction.

## Active-tab follow semantic review

On 2026-08-11, the ten active-tab-follow messages and the revised settings, privacy, badge, and framing messages were translated in four explicit catalog batches and then reviewed in a separate multilingual semantic pass. The pass checked that every locale preserves the two alternative one-click actions, never redirects follow consent through a settings-only second step, keeps toolbar badges independent from side-panel following, says that following runs only while the panel is already open, and describes the last-panel framing lifetime plus the three-discussion retention limit. `pnpm locales:validate` then confirmed exact 40-catalog key and placeholder parity; an additional comparison found no new non-English message copied verbatim from English. As with the original release review, this is a model-assisted semantic gate rather than a claim of native-speaker certification.

## Options disclosure copy review

On 2026-08-11, the Options-page introduction, automatic-badge description, automatic-check privacy note, article-click description, side-panel follow description, and framing disclosure were refined in all 40 catalogs, with a separate localized framing-disclosure heading added to each one. A multilingual semantic review checked that every locale distinguishes displaying a discussion from opening it, identifies eligible sanitized public URLs and Algolia, limits the no-page-content-reading claim to automatic checks, and says that following updates only an already-open Split for Hacker News panel. It also checked the full framing boundary: response headers are removed temporarily from Hacker News sub-frame responses while at least one extension panel is open; Chrome applies that rule to any Hacker News sub-frame in the browser profile during that interval; each panel retains at most three live discussions with one visible; and the extension cannot read their content or scroll position. `pnpm locales:validate` confirmed 40-catalog parity, and a separate comparison found no non-English target message copied verbatim from English. This remains a model-assisted semantic review rather than native-speaker certification.

## Store-listing active-tab follow semantic review

On 2026-08-11, the follow/retention bullet and revised second screenshot caption were translated across the 39 non-English listings in four explicit batches: `ar bg bn ca cs da de el es`; `es_419 fa fi fil fr he hi hr hu id`; `it ja ko ms nb nl pl pt_BR pt_PT ro`; and `ru sk sr sv th tr uk vi zh_CN zh_TW`. A separate multilingual semantic pass then confirmed that each bullet says the panel is already open, following is off by default with the localized **Check this tab** action as the one-shot alternative, tabs are never opened or rearranged, and up to three recent discussions may stay alive for faster return with best-effort scroll preservation. It also confirmed that every caption keeps toolbar checks, side-panel following, and story-click handling off by default; grants one panel lookup through the exact runtime button label; and says article text and other page content are never read. Automated scope and structure checks confirmed nine bullets, three caption pairs, `reviewed: true`, the 200-character caption budget, no non-English copy pasted from English, and no change to release notes, versions, search terms, the other captions, or the original eight bullets. This remains a model-assisted semantic gate, not native-speaker certification.

## Scope decision: Chrome only

The set is validated against Chrome only for now. Firefox Add-ons, Microsoft Edge Add-ons, and the Apple App Store use their own locale inventories; the runtime ports remain out of scope until they begin (see the product brief's release-work section), but the store *listing* localization below already maps every locale to all four store inventories explicitly.

## Chrome validation result

All 40 languages are supported by Chrome. Norwegian needs one packaging compatibility alias: current Chromium canonicalizes Norwegian Bokmål to `nb` and looks for `_locales/nb`, while the current Web Store locale table labels the same listing `no`. The Chrome package therefore contains byte-identical `_locales/nb` and `_locales/no` directories for one logical Norwegian language. Chromium 151 runtime selection of `nb` is pinned by the browser-level locale test; the packaging gate separately pins the presence and byte equality of the generated `no` alias. Chromium's own locale tooling maps Translation Console `no` to runtime `nb`; published Chrome Web Store extensions confirm that both [`nb` alone](https://chromewebstore.google.com/detail/newtab%2B/jelhkdplckbigkmghpcmfdcfgnocooja) and the [dual-directory package](https://chromewebstore.google.com/detail/new-tab-new-window-reload/ojafpelnbdmpodjfpkppabecagnlmkkj) are accepted and produce one Norwegian listing rather than a duplicate. Other notable confirmations are `es_419`, `fil`, `pt_BR`/`pt_PT` (no bare `pt`), `sr`, `zh_CN`/`zh_TW`, `he`, and `id` under their modern codes.

Chrome's runtime message lookup falls back on its own: a regional locale first strips its region, then falls to `default_locale` (`en`). The 0.1.0 package includes 40 reviewed source catalogs plus the generated Norwegian alias. `resolveShippedLocale` maps either Norwegian code to the `nb` registry entry so the document language and direction describe the text actually shown; unsupported browser UI languages still fall back to English.

Chrome Web Store derives its listing-language selector from the `_locales/<code>` directories in the uploaded package. It does not document a separate switch that hides a packaged locale, so the release package itself is the publication boundary: the published 0.1.0 listing exposes all 40 priority locales.

## Library mappings (@adguard/translate 2.0.8)

The translation library uses a closed lowercase locale union, so five regional registry entries map instead of matching verbatim — the mapping lives in the registry's `adguardCode` field and the compiler enforces its validity. Norwegian uses the library's native `nb` code:

- `pt_BR → pt_br`, `pt_PT → pt_pt`, `zh_CN → zh_cn`, `zh_TW → zh_tw` (case);
- `es_419 → es` — the library has no Latin-American Spanish plural rule; standard Spanish pluralization is correct for the strings this product uses. Upstreaming a dedicated `es_419` rule is optional future work.

The validation script passes `adguardCode` (never the directory name) to `validator.isTranslationValid`, so plural strings will validate correctly for these five locales when they appear.

## Plural requirements

- The library uses pipe-delimited plural forms in one message string, with a fixed convention: **index 0 is always the zero form**, so a message needs the CLDR form count plus one.
- Required form counts across the set (per the library's rules): 2 forms — `fil`, `hi`, `id`, `ja`, `ko`, `ms`, `th`, `tr`, `vi`, `zh_CN`, `zh_TW`; 3 forms — most European locales including `en`, `es`, `de`, `fr`; 4 forms — `cs`, `hr`, `pl`, `ro`, `ru`, `sk`, `sr`, `uk`; 6 forms — `ar`.
- No current message uses plurals. The first candidates are `discussion_metrics` and `badge_comments_available` (both interpolate `%comments%`); when they are pluralized, every catalog must supply its locale's exact form count or validation fails.

## RTL requirements

`ar`, `fa`, and `he` are right-to-left (flagged in the registry). Page bootstraps stamp `document.documentElement.dir` (and a BCP-47 `lang`) from the resolved shipped registry entry through `applyDocumentLocale` in `src/shared/i18n.ts`. Registry tests pin all three RTL mappings, while browser-level accessibility and overflow checks render Arabic as the representative RTL layout alongside Russian and Simplified Chinese coverage; native-speaker typography review remains a follow-up quality improvement.

## Store listing localization

The listing copy for every store surface lives in `assets/store-listings/<code>.json` (all 40 codes; [`docs/store-listing.md`](store-listing.md) holds the English master and the handoff rules). Each file carries the structured description (intro, the nine reviewed bullets, the unofficial disclaimer), release notes per version, the three screenshot caption pairs, Edge search terms, and App Store keywords. Every shipped file must have `reviewed: true`, meaning it passed the release review method described above. The validator rejects any shipped locale that has not passed that gate.

Tooling:

- `pnpm store:validate` (part of `pnpm check`) enforces listing-file/registry parity, structure parity with English (bullet count, release-note versions, caption count), the untranslated brand and proper nouns, every per-store length budget, and reviewed status for every shipped locale; `tests/store-listings.test.ts` covers the same library.
- `pnpm store:render <store> <locale>` prints the dashboard-relevant copy for one shipped locale, resolving the store's own locale code or reporting the explicit fallback. Chrome output intentionally omits release notes and screenshot captions because its Store Listing page has no such text fields.
- `pnpm assets:generate --locale <code>` renders a shipped locale's captioned screenshots to `build/store-assets/<code>/` (only English imagery is committed). Platforms that ignore Chromium's `--lang` switch (macOS) keep the UI capture English under localized captions — the script warns when that happens; run the generation on Linux for fully localized captures. RTL locales render right-to-left caption stages.

### Store locale mappings and fallbacks

`scripts/lib/store-listings.ts` (`STORE_CATALOG`) keeps all 40 registry codes mapped to each store's inventory, and `tests/store-listings.test.ts` pins the mapping. The catalog records the check date and primary source for each store:

- **Chrome Web Store** (chrome.i18n locale reference, 55 listing codes; listing docs): all 40 languages have dashboard listings; the logical `nb` source maps to the Norwegian `no` listing slot, and the package carries both codes. The dashboard documents no description character limit (keyword-spam policy only).
- **Microsoft Edge Add-ons** (publish-extension guide): all 40 languages can be added to Partner Center explicitly; Edge itself uses the registry's native `nb` runtime code. A description (250–10,000 characters) plus a logo are required per listing language.
- **Firefox Add-ons (AMO)** (addons-server `AMO_LANGUAGES`): all 40 map, ten through renames — en→en-US, es→es-ES, es_419→es-MX, fil→tl (AMO's Tagalog slot; Filipino is the standardized register of the same language), nb→nb-NO, pt_BR→pt-BR, pt_PT→pt-PT, sv→sv-SE, zh_CN→zh-CN, zh_TW→zh-TW — no fallbacks.
- **App Store** (App Store Connect localizations reference, 50 localizations): 36 of 40 map (renames: en→en-US, es→es-ES, es_419→es-MX, nb→no, pt_BR→pt-BR, pt_PT→pt-PT, zh_CN→zh-Hans, zh_TW→zh-Hant); **bg, fa, fil, and sr have no App Store localization and are served by the primary en-US listing** — the explicit fallback recorded as `unsupportedFallback` in the catalog.

## Selection rationale

The 40 shipped locales balance Hacker News readership and Chrome Web Store audience coverage across Europe, the Americas, the Middle East, and Asia-Pacific, within an exactly-40 localization budget. Every language is supported by Chrome's `_locales` mechanism; Norwegian's documented `nb` runtime / `no` listing split is handled by the generated alias rather than a second authored catalog. Every registry entry is also expressible in the translation library through at most a documented mapping. English remains the base and development locale.
