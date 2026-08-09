# Split for Hacker News

Split for Hacker News (repository slug: `hn-split`) is a browser extension that helps a reader move from the article currently open to its Hacker News discussion after an explicit result selection. It is an unofficial, independent project and is not affiliated with or endorsed by Y Combinator or Hacker News.

## Current status

A working Chrome MV3 MVP is implemented with React and TypeScript. In the default manual mode, it reads the active page only after the extension action is opened, resolves the page and canonical URL, finds exact Hacker News discussions through Algolia, and opens one selected discussion after an explicit click.

Users may enable automatic availability badges in the options page. The extension includes the `tabs` permission at installation, but automatic checks remain off by default. When enabled, it checks public tab URLs without reading page contents and shows an orange comment-count badge when a discussion exists. Turning the option off stops checks, clears badges, and removes session-only lookup cache entries.

Chrome 140 documents Split View detection through `Tab.splitViewId`, but not Split View creation through `tabs.create`. The MVP therefore opens the first discussion in an adjacent tab and remembers it. If the user pairs that tab with the article using native Chrome Split View, later selections reuse the same browser-managed pane.

Any `http:` or `https:` link offers an **Open in Split** item in the right-click menu. Selecting it opens that link in the current tab and shows its Hacker News discussion in the side panel beside it; nothing runs before that selection, and the panel says so plainly when no discussion exists or the lookup fails.

A separate opt-in setting (off by default) turns story clicks on Hacker News into a split reading flow: the article opens in the current tab as usual, while its discussion opens in Chrome's side panel beside it. A content script is registered for `news.ycombinator.com` only while this setting is on. It acts only on unmodified primary clicks on external story links and resolves the discussion from the item id already present in the page, so the flow makes no network requests.

Hacker News is the only discussion source in the MVP. Chrome is the first implementation target; Firefox, Edge, and Safari follow after the Chrome behavior is validated.

## Product documentation

- [MVP product brief](docs/product-brief.md)
- [HNewhere reference analysis](docs/hnewhere-reference.md)
- [URL matching and Hacker News lookup contract](docs/url-matching.md)
- [Lifecycle after tab close or navigation](docs/lifecycle.md)
- [Priority locales](docs/locales.md)
- [Development and Chrome loading](docs/development.md)
- [Store listing master copy and visual assets](docs/store-listing.md)
- [Releasing and reproducible packaging](docs/release.md)
- [Privacy](PRIVACY.md)

## Development

```bash
npm install --global pnpm@11.18.0
pnpm install
pnpm check
```

Rspack writes the unpacked extension to `dist`. Load that directory in Chrome 140 or newer.

`pnpm package` produces the reproducible Chrome, Edge, and Firefox store packages plus checksums and provenance in `build/artifacts`; releases are published from signed tags ([docs/release.md](docs/release.md)).

## Product principles

- Free to use
- No telemetry
- Narrow, documented permissions
- No automatic tab opening or rearrangement
- User-triggered navigation only

## Repository

The source is maintained on GitHub. Feature work is reviewed through pull requests targeting `master`.
