# Priority locales

## Single source of truth

The canonical list of the 40 priority locales lives in [`src/shared/locales.ts`](../src/shared/locales.ts) (`LOCALE_REGISTRY`). The same module keeps `SHIPPED_LOCALES` as the smaller, reviewed release allowlist. Tooling uses the appropriate set instead of assuming every prepared catalog is ready to publish:

- `scripts/validate-locales.mjs` asserts the registry holds exactly 40 unique codes, that `public/_locales/` directories equal the registry, validates every prepared catalog, and checks that the shipped allowlist is a valid subset containing English;
- `rspack.config.ts` copies only `SHIPPED_LOCALES` into unpacked builds and store packages;
- `src/shared/i18n.ts` resolves the browser UI language against shipped registry entries;
- `tests/locales.test.ts` pins the prepared list, the reviewed release allowlist, the RTL set, and the library mappings.

This document records the decisions around that registry; it deliberately does not duplicate the list.

All 40 source catalogs stay prepared in `public/_locales/`, but the initial release packages contain only English and Russian. English is the authored source, Russian is hand-translated, and the other 38 catalogs are machine-translated: structurally validated (keys, placeholders, tags, the 132-character manifest description budget, and the never-translated `extension_name`) by `pnpm locales:validate`, but pending native-speaker review. A locale is promoted only after both its UI catalog and store listing receive native-speaker review: mark the listing `reviewed: true`, add the code to `SHIPPED_LOCALES`, regenerate its imagery, and run the full release validation.

## Scope decision: Chrome only

The set is validated against Chrome only for now. Firefox Add-ons, Microsoft Edge Add-ons, and the Apple App Store use their own locale inventories; the runtime ports remain out of scope until they begin (see the product brief's release-work section), but the store *listing* localization below already maps every locale to all four store inventories explicitly.

## Chrome validation result

All 40 prepared codes are directly supported Chrome `_locales` directory codes, verified against the chrome.i18n extension reference (`developer.chrome.com/docs/extensions/reference/api/i18n`, checked 2026-08-03; Chrome supports 55 codes in total). Notable confirmations: `es_419`, `fil`, `no` (Chrome uses `no`, not `nb`), `pt_BR`/`pt_PT` (no bare `pt`), `sr`, `zh_CN`/`zh_TW`, `he` and `id` under their modern codes. Because every code is store-supported, no store-level fallback mapping is required when a reviewed catalog is promoted; the mappings below are library-level.

Chrome's runtime message lookup falls back on its own: a regional locale first strips its region, then falls to `default_locale` (`en`). In the initial package, Russian UI languages resolve to `ru`; English variants resolve to `en`; every other UI language uses the English default because its prepared catalog is not packaged yet. `resolveShippedLocale` follows that same inventory so the document language and direction always describe the text actually shown.

Chrome Web Store derives its listing-language selector from the `_locales/<code>` directories in the uploaded package. It does not document a separate switch that hides a packaged locale, so the release package itself is the publication boundary: the initial dashboard exposes only English and Russian.

## Library mappings (@adguard/translate 2.0.8)

The translation library uses a closed lowercase locale union, so five registry entries map instead of matching verbatim — the mapping lives in the registry's `adguardCode` field and the compiler enforces its validity:

- `pt_BR → pt_br`, `pt_PT → pt_pt`, `zh_CN → zh_cn`, `zh_TW → zh_tw` (case);
- `es_419 → es` — the library has no Latin-American Spanish plural rule; standard Spanish pluralization is correct for the strings this product uses. Upstreaming a dedicated `es_419` rule is optional future work.

The validation script passes `adguardCode` (never the directory name) to `validator.isTranslationValid`, so plural strings will validate correctly for these five locales when they appear.

## Plural requirements

- The library uses pipe-delimited plural forms in one message string, with a fixed convention: **index 0 is always the zero form**, so a message needs the CLDR form count plus one.
- Required form counts across the set (per the library's rules): 2 forms — `fil`, `hi`, `id`, `ja`, `ko`, `ms`, `th`, `tr`, `vi`, `zh_CN`, `zh_TW`; 3 forms — most European locales including `en`, `es`, `de`, `fr`; 4 forms — `cs`, `hr`, `pl`, `ro`, `ru`, `sk`, `sr`, `uk`; 6 forms — `ar`.
- No current message uses plurals. The first candidates are `discussion_metrics` and `badge_comments_available` (both interpolate `%comments%`); when they are pluralized, every catalog must supply its locale's exact form count or validation fails.

## RTL requirements

`ar`, `fa`, and `he` are right-to-left (flagged in the registry). Page bootstraps stamp `document.documentElement.dir` (and a BCP-47 `lang`) from the resolved shipped registry entry through `applyDocumentLocale` in `src/shared/i18n.ts`. Remaining work before promoting an RTL locale: native-speaker review plus an RTL pass in the accessibility E2E matrix (`tests/e2e/a11y.e2e.ts`) covering layout mirroring and overflow.

## Store listing localization

The listing copy for every store surface is prepared per locale in `assets/store-listings/<code>.json` (all 40 codes; [`docs/store-listing.md`](store-listing.md) holds the English master and the handoff rules). Each file carries the structured description (intro, the eight reviewed bullets, the unofficial disclaimer), release notes per version, the three screenshot caption pairs, Edge search terms, and App Store keywords. English is authored and Russian is hand-translated (`reviewed: true`); the other 38 files are machine-translated and marked `reviewed: false` until a native speaker reviews them. The validator rejects any shipped locale whose listing is not reviewed.

Tooling:

- `pnpm store:validate` (part of `pnpm check`) enforces prepared-file/registry parity, structure parity with English (bullet count, release-note versions, caption count), the untranslated brand and proper nouns, every per-store length budget, and reviewed status for every shipped locale; `tests/store-listings.test.ts` covers the same library.
- `pnpm store:render <store> <locale>` prints paste-ready copy for one shipped locale, resolving the store's own locale code or reporting the explicit fallback.
- `pnpm assets:generate --locale <code>` renders a shipped locale's captioned screenshots to `build/store-assets/<code>/` (only English imagery is committed). Platforms that ignore Chromium's `--lang` switch (macOS) keep the UI capture English under localized captions — the script warns when that happens; run the generation on Linux for fully localized captures. RTL locales render right-to-left caption stages after promotion.

### Store locale mappings and fallbacks

`scripts/lib/store-listings.ts` (`STORE_CATALOG`) keeps all 40 prepared registry codes mapped to each store's inventory, and `tests/store-listings.test.ts` pins the mapping, so promoting a reviewed locale never requires rediscovering its store code. Inventories checked 2026-08-06:

- **Chrome Web Store** (chrome.i18n locale reference, 56 codes; listing docs): all 40 prepared codes are valid dashboard listing languages verbatim, but only the packaged `en` and `ru` directories appear for the initial release. The dashboard documents no description character limit (keyword-spam policy only).
- **Microsoft Edge Add-ons** (publish-extension guide): Partner Center detects listing languages from the package `_locales`, so only English and Russian appear initially. A description (250–10,000 characters) plus a logo are required per packaged language.
- **Firefox Add-ons (AMO)** (addons-server `AMO_LANGUAGES`): all 40 map, ten through renames — en→en-US, es→es-ES, es_419→es-MX, fil→tl (AMO's Tagalog slot; Filipino is the standardized register of the same language), no→nb-NO, pt_BR→pt-BR, pt_PT→pt-PT, sv→sv-SE, zh_CN→zh-CN, zh_TW→zh-TW — no fallbacks.
- **App Store** (App Store Connect localizations reference, 50 localizations): 36 of 40 map (renames: en→en-US, es→es-ES, es_419→es-MX, pt_BR→pt-BR, pt_PT→pt-PT, zh_CN→zh-Hans, zh_TW→zh-Hant); **bg, fa, fil, and sr have no App Store localization and are served by the primary en-US listing** — the explicit fallback recorded as `unsupportedFallback` in the catalog.

## Selection rationale

The 40 prepared locales balance Hacker News readership and Chrome Web Store audience coverage across Europe, the Americas, the Middle East, and Asia-Pacific, within an exactly-40 budget for translation cost control. Every code is natively supported by Chrome's `_locales` mechanism (no synthetic codes), and every one is expressible in the translation library through at most a documented mapping, so the set requires no bespoke tooling. English is the base and development locale; Russian ships as the first translated catalog and proves the review-and-promotion pipeline end to end.
