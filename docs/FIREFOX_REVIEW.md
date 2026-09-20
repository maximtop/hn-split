# Firefox reviewer notes

## Package identity

- Name: Split for Hacker News
- Version: 0.1.2
- Gecko ID: `hn-split@maximtop.dev`
- Minimum Firefox version: 140
- Desktop only

## Build

The submitted source archive is the exact tagged repository state used for the
binary package.

```sh
pnpm install --frozen-lockfile
pnpm release firefox
```

Node.js 24.15 or newer within the Node 24 line, or Node.js 26 or newer, and
pnpm 11.18.0 or newer are required. The release command `pnpm release firefox`
produces the same Firefox archive under `build/release/firefox.zip`.

## How to test

1. Open any public article page and select the extension toolbar button.
2. Choose a Hacker News result to open its discussion in an adjacent tab, or
   choose **Open in side panel** to open Firefox Sidebar.
3. In the sidebar, use **Check this tab** for a one-time lookup or enable
   automatic following while the sidebar remains open.
4. Right-click an HTTP(S) link and choose **Open in Split** to navigate the
   current tab and open the matching discussion in the sidebar.
5. Optionally enable the toolbar comment-count badge in the options page.

The Chromium-only story-click setting is deliberately hidden in Firefox. A
content-script message does not retain the user action required by Firefox's
`sidebarAction.open` API.

## Network and data declarations

The extension sends only an eligible public page URL, a user-selected link
URL, and an optional canonical URL to Algolia's public Hacker News Search API
to find an exact discussion. This is declared as required `browsingActivity`
and `websiteContent` data in the Firefox manifest. It has no account system,
telemetry, advertising, sale of data, or remote code.

The sidebar embeds the real Hacker News discussion. While a live panel exists,
one narrowly scoped dynamic rule removes framing headers only from Hacker News
sub-frame responses. Extension code does not read or inject into that framed
document. The rule is removed after the last panel disconnects and on worker
startup.

See `PRIVACY.md` and `docs/development.md` for the complete data flow and
runtime lifecycle.
