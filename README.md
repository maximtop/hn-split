# HN Split

HN Split is a private, work-in-progress browser extension that helps a reader move from the article currently open to its Hacker News discussion after an explicit click.

## Current status

A working Chrome MV3 MVP is implemented with React and TypeScript. In the default manual mode, it reads the active page only after the extension action is opened, resolves the page and canonical URL, finds exact Hacker News discussions through Algolia, and opens one selected discussion after an explicit click.

Users may enable automatic availability badges in the options page. The extension includes the `tabs` permission at installation, but automatic checks remain off by default. When enabled, it checks public tab URLs without reading page contents and shows an orange comment-count badge when a discussion exists. Turning the option off stops checks, clears badges, and removes session-only lookup cache entries.

Chrome 140 documents Split View detection through `Tab.splitViewId`, but not Split View creation through `tabs.create`. The MVP therefore opens the first discussion in an adjacent tab and remembers it. If the user pairs that tab with the article using native Chrome Split View, later selections reuse the same browser-managed pane.

Hacker News is the only discussion source in the MVP. Chrome is the first implementation target; Firefox, Edge, and Safari follow after the Chrome behavior is validated.

## Product documentation

- [MVP product brief](docs/product_brief.md)
- [HNewhere reference analysis](docs/hnewhere_reference.md)
- [URL matching and Hacker News lookup contract](docs/url_matching.md)
- [Development and Chrome loading](docs/development.md)
- [Privacy](PRIVACY.md)
- [ADR-0001: HNewhere reference decisions](docs/adr/0001_hnewhere_reference_decisions.md)

## Development

```bash
corepack pnpm install
corepack pnpm check
```

Load the generated `dist` directory as an unpacked extension in Chrome 140 or newer.

## Product principles

- Free to use
- No telemetry
- Narrow, documented permissions
- No automatic tab opening or rearrangement
- User-triggered navigation only

## Repository

The repository is local and private during initial product work. The remote private GitHub repository will be attached when authenticated GitHub access is available to the agent runtime.
