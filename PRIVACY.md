# Privacy

Split for Hacker News has no analytics, telemetry, account, or application backend.

By default, Split for Hacker News reads the active page URL and optional canonical URL only when the user opens the extension popup. It sends eligible public URL candidates to the public Hacker News Algolia search endpoint to find exact matching Hacker News submissions. Lookup results are cached only in Chrome's session storage and are removed when the browser session ends.

Split for Hacker News includes the `tabs` permission at installation. Automatic availability badges remain off by default. When enabled in the options page, the extension checks public URLs as tabs navigate without reading page contents. Disabling the option stops automatic checks, clears badges, and removes HN lookup cache entries while preserving unrelated session data.

A second opt-in setting, also off by default, opens a story's discussion beside the article the user clicks on Hacker News. While it is enabled, one content script is registered for `news.ycombinator.com` only. It observes clicks on story links, reads nothing but the clicked link and the story's item id already present in the page, and asks the background worker to show that discussion in the side panel. This flow performs no lookup request and sends nothing off the device; disabling the setting removes the registration.

## Permissions

Every installed permission exists for one documented purpose:

- **`tabs`** — lets the background worker read tab URLs. It is used to place and reuse the discussion tab next to the article after an explicit click, to observe navigations and enumerate open tabs for the opt-in automatic badge, and to clear badges when that setting is turned off. Tab URLs never leave the extension except as sanitized, eligible lookup candidates sent to the endpoint below, and only when a lookup is requested.
- **`activeTab`** — scopes popup-triggered page inspection to the tab the user is looking at when they open the extension action. No page is touched without that explicit action.
- **`scripting`** — serves two documented uses. First, it runs one short-lived function in the active page after the popup opens; the function reads only `location.href` and the `<link rel="canonical">` element, and no page content beyond that link element is read. Second, while the opt-in article-click setting is enabled, it registers one content script for `news.ycombinator.com` only, which observes story-link clicks and reads nothing else from the page. While that setting is off — the default — no content script is registered anywhere; turning the setting off removes the registration.
- **`storage`** — persists the automatic-availability and article-click on/off settings in `chrome.storage.local`, and keeps time-bounded lookup results plus article-to-discussion tab associations and the side panel selection in `chrome.storage.session`, which Chrome discards when the browser session ends. No browsing history is written to persistent storage.
- **Host access to `https://hn.algolia.com/*`** — the lookup endpoint. It receives sanitized public article URL candidates as search queries and returns matching Hacker News submissions. No account, API key, or identifying header is used.
- **`sidePanel`** — opens the browser side panel, and only after an explicit user action: the side panel button in the popup, or — when the opt-in article-click setting is enabled — a click on a story link on Hacker News.
- **`declarativeNetRequestWithHostAccess`** — declares one dynamic rule that removes the `X-Frame-Options` and `Content-Security-Policy` response headers from Hacker News **sub-frame** requests, which is what allows the discussion to render inside the side panel. The rule is installed when a side panel opens and removed when it closes, so it does not exist while no panel is open; top-level Hacker News navigation keeps its headers, and no other site is affected. The extension does not read, block, or redirect any request. Two limits are worth stating plainly: while a panel is open the exception applies to any Hacker News sub-frame in that browser profile, not only to this extension's panel, because rule conditions cannot target a single extension frame; and removing `Content-Security-Policy` wholesale also drops Hacker News's own script restrictions inside the frame, because a header cannot be edited in part.
- **Host access to `https://news.ycombinator.com/*`** — required for the header rule above, for the side panel to embed the discussion page, and for the opt-in article-click content script described under `scripting`. The embedded page is the real Hacker News site: the user's own Hacker News session applies inside the panel exactly as it does in a tab, and the extension neither reads nor stores anything from it.

## Outbound URL boundary

Only public `http:`/`https:` article URLs may reach the lookup endpoint. Before any request, Split for Hacker News removes fragments and recognized tracking parameters, and rejects entirely:

- private, local, and carrier-grade IP ranges, and other IANA special-purpose addresses;
- single-label names and special-use namespaces such as `.local`, `.internal`, `.onion`, `.arpa`, `.test`, and `.example`;
- hostnames without an ICANN-recognized public suffix;
- URLs with embedded credentials, and URLs whose query string carries recognizable secrets (for example `token`, `access_token`, `code`, `sig`, or `X-Amz-*` signature parameters), which fail closed and are never sent or cached.

Split for Hacker News does not persist browsing history, store article content, use analytics, or access Hacker News credentials. A discussion tab is opened only after the user selects it.

## Side panel

The side panel embeds `news.ycombinator.com` directly instead of re-rendering it. The extension does not read the framed page, and the only state it keeps is the selected discussion identifier in session storage. The framing exception described above is the entire mechanism, its lifetime is the panel's lifetime, and the panel itself states what is being modified while it is open.
