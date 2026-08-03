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

`pnpm dev` produces a one-shot development build; pass `--watch` (`pnpm dev --watch`) to rebuild on file changes. `pnpm build` creates the unpacked extension with Rspack. `test:e2e` builds the extension, launches Playwright's Chromium with `dist` loaded as an unpacked MV3 extension, serves deterministic article and Hacker News fixtures, and verifies required `tabs` access, a delayed automatic lookup followed by a serialized disable with badge and session-cache cleanup, the real background lookup, and adjacent/reused discussion-tab behavior. It does not claim to create or validate native Chrome Split View, because Chrome does not expose a documented API for that action.

`pnpm locales:validate` verifies that every locale has the English message keys and that placeholders and tags are structurally valid according to `@adguard/translate`.

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

Neither mode reads page contents automatically or opens a discussion without an explicit user selection.

## Side panel

The popup's **Open in side panel** button opens Chrome's side panel with the real
Hacker News discussion embedded. Hacker News blocks framing, so the background
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

## Split View behavior

Chrome 140 documents `Tab.splitViewId`, Split View queries, and Split View update events, but does not document a `tabs.create` option that creates a Split View. HN Split therefore uses only documented behavior:

1. The first explicit discussion click opens a normal adjacent tab.
2. The user can place the article and discussion tabs into native Chrome Split View.
3. HN Split remembers and reuses that discussion tab, so subsequent explicit selections preserve the browser-managed Split View.

The extension does not use an iframe or an undocumented browser API.
