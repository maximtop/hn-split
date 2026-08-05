# Development

## Requirements

- Node.js 24.15 or newer within the 24 line, or Node.js 26 or newer (Node.js 25 and earlier 24 releases are outside the range supported by the `jsdom` dev dependency); `.node-version` pins the exact toolchain version for fnm, nvm, and similar managers
- pnpm 11.18.0 or newer (`npm install --global pnpm@11.18.0`)
- Chrome 140 or newer for documented `Tab.splitViewId` detection

## Commands

```bash
pnpm install
pnpm exec playwright install chromium
pnpm dev
pnpm check
pnpm test:e2e
pnpm verify
```

`pnpm dev` produces a one-shot development build; pass `--watch` (`pnpm dev --watch`) to rebuild on file changes. `pnpm build` creates the unpacked extension with Rspack. `test:e2e` builds the extension, launches Playwright's Chromium with `dist` loaded as an unpacked MV3 extension, serves deterministic article and Hacker News fixtures, and verifies required `tabs` access, a delayed automatic lookup followed by a serialized disable with badge and session-cache cleanup, the real background lookup, adjacent/reused discussion-tab behavior, and the opt-in article-click flow (content-script registration lifecycle, side-panel selection updates, and the inert disabled default). It does not claim to create or validate native Chrome Split View, because Chrome does not expose a documented API for that action.

`pnpm locales:validate` verifies that every locale has the English message keys and that placeholders and tags are structurally valid according to `@adguard/translate`.

## Packaging

`pnpm package` builds the store packages for every target into `build/artifacts`: Chrome, Edge, and Firefox zips, a source archive, `SHA256SUMS`, and `provenance.json`. Packages are byte-reproducible for a given commit; see [release.md](release.md) for the guarantees and the release process.

The manifest in every build is generated: `package.json` supplies the version (the base `public/manifest.json` has no `version` key on purpose), and the Firefox target gets structural rewrites (event-page background, `options_ui`, gecko id, no `sidePanel`). Two environment variables drive single-target builds when needed:

```bash
TARGET_BROWSER=firefox OUTPUT_PATH=build/firefox pnpm build
```

`TARGET_BROWSER` defaults to `chrome` and `OUTPUT_PATH` to `dist`, so plain `pnpm build` remains the Chrome development build that `chrome://extensions` and the e2e suite load.

## Load in Chrome

1. Run `pnpm build`.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Choose **Load unpacked** and select the repository's `dist` directory.
5. Open the extension's details and choose **Extension options** to test the automatic badge mode.

## Availability modes

The installed extension includes `tabs` access. Automatic URL checks remain off until the user enables them.

- **Manual mode (default):** the popup inspects the active page only after the user opens the extension action.
- **Automatic badge:** enabling the setting checks public tab URLs and displays an orange comment-count badge when an exact HN discussion exists. Disabling it stops checks, clears badges, and clears HN lookup cache records from session storage.
- **Article-click discussion (opt-in, off by default):** enabling the setting registers a content script for `news.ycombinator.com` only. On an unmodified primary click on an external story link, the browser opens the article in the same tab as usual, and the extension opens that story's discussion in the side panel beside it, using the item id already present in the page — no lookup request is made. Modified, middle, and right clicks, downloads, and Hacker News-internal links (self posts, site chips, comment links) stay untouched. Disabling the setting removes the registration; the background worker also re-checks the setting before acting, so pages loaded earlier cannot act after it is turned off.

No mode reads page contents beyond the documented inputs, and no discussion opens without an explicit user action.

## Side panel

The popup's **Open in side panel** button opens Chrome's side panel with the real
Hacker News discussion embedded. With the opt-in article-click setting enabled,
clicking a story link on Hacker News opens the same panel for that story's
discussion; `chrome.sidePanel.open` accepts that click's user gesture only while
the background message listener runs synchronously, which is why the click
message is handled outside the async request/response protocol. The same rule
governs the link context menu below, whose click listener is synchronous for
exactly this reason. Hacker News
blocks framing, so the background
worker installs one dynamic `declarativeNetRequest` rule that removes
`X-Frame-Options` and `Content-Security-Policy` from Hacker News **sub-frame**
responses. The rule's lifetime is tied to a runtime port the panel holds open:
it is installed when the panel connects, removed when the panel closes, and
cleared on worker startup. The panel frames the discussion only after the worker
confirms the rule is in place, and it states what is being modified.

Because the panel embeds the real site inside an extension page for which the
extension holds host permissions, Chrome treats the frame as same-site: the
user's own Hacker News session applies, so voting and replies work as they do in
a tab.

Known costs of this approach: the exception is not surgical (while a panel is
open it applies to any Hacker News sub-frame in the profile, since rule
conditions cannot target one extension frame); removing `Content-Security-Policy`
also drops Hacker News's own script restrictions inside the frame; and Hacker
News can add frame-busting or change cookie attributes at any time, which would
break framing without warning. The adjacent-tab flow keeps working in that case,
and the panel always links out to the full site.

## Open in Split link context menu

Right-clicking an `http:` or `https:` link offers **Open in Split**. Chrome draws
the item from the declared target pattern alone; the extension learns nothing
about a right-click and is handed the link URL only when the item is selected.
Selecting it opens the side panel, loads the link in the tab it was clicked in
(the selection is the explicit user action that permits replacing that page),
and looks the link up through the same cached Algolia path the popup uses.
Because that lookup is a network round-trip rather than an item id already
present in the page, the panel goes through visible states: a pending line while
the lookup runs, then the discussion frame, or the same not-found, ineligible,
or lookup-failed message the popup shows for that outcome.

The panel displays one thing at a time, so a single owner
(`src/browser/side-panel-content-manager.ts`) holds that selection for every
entry point — popup, article click, and this menu. Each request takes the next
generation, cancels the lookup it supersedes, and its writes are queued and
re-check that generation as they run, so a slow lookup can never overwrite
whatever the user picked while it was in flight. A worker that stops mid-lookup
would strand a pending state, so worker startup resolves any leftover pending
state into the failure message, alongside the framing-rule reset.

Menu items, like dynamically registered content scripts, are dropped on
extension updates and browser restarts, so the item is republished on every
worker start by clearing first and creating again.

## Split View behavior

Chrome 140 documents `Tab.splitViewId`, Split View queries, and Split View update events, but does not document a `tabs.create` option that creates a Split View (an explicit creation API is still an open upstream proposal, [w3c/webextensions#967](https://github.com/w3c/webextensions/issues/967)). HN Split therefore offers two side-by-side flows built only on documented behavior:

- **Adjacent tab (popup):**
  1. The first explicit discussion click opens a normal adjacent tab.
  2. The user can place the article and discussion tabs into native Chrome Split View.
  3. HN Split remembers and reuses that discussion tab, so subsequent explicit selections preserve the browser-managed Split View.
- **Side panel (popup button, or the opt-in article-click setting):** the discussion renders in Chrome's side panel beside the page, using the disclosed framing exception described above.

The adjacent-tab flow modifies no page and remains the fallback if Hacker News ever breaks framing. The side panel embeds the real Hacker News page inside the extension's own panel — never inside a page the user is reading — and no undocumented browser API is used anywhere.
