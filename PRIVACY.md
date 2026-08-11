# Privacy

Split for Hacker News has no analytics, telemetry, account, or application backend.

Last updated: August 11, 2026. Privacy contact: [me@maximtop.dev](mailto:me@maximtop.dev).

By default, Split for Hacker News reads the active page URL and the optional URL from its canonical `<link>` element only when the user opens the extension popup. It does not read article text or other page content. It sends eligible public URL candidates over HTTPS to the public Hacker News Algolia search endpoint to find exact matching Hacker News submissions. Algolia is the only third party that receives lookup candidates from the extension; as the network provider, it may also receive standard connection metadata under the [Algolia Privacy Policy](https://www.algolia.com/policies/privacy/). Found URL lookups may remain in Chrome's session storage for one hour and not-found lookups for ten minutes; restricted pages and failures are not added to the URL cache, and all entries are removed when the browser session ends.

Split for Hacker News includes the `tabs` permission at installation. Automatic availability badges remain off by default. When enabled in the options page, the extension checks public tab URLs as tabs navigate; it does not inspect article text or other page content. Disabling the option stops automatic checks, clears badges, and removes HN lookup cache entries while preserving unrelated session data.

**Follow active tabs in the side panel** is a separate opt-in and is also off by default. It runs only while the side panel is already open and never opens, moves, replaces, or rearranges tabs. With following off, an unchecked tab is not inspected by the side-panel-follow path: **Check this tab** performs one check without changing either automatic preference, while **Follow tabs automatically** enables the preference and checks the tab that is active when the action reaches the background worker. Disabling following stops unfinished and future automatic panel checks but keeps valid content already opened for unchanged tabs.

Split for Hacker News adds one right-click item, **Open in Split**, to `http:` and `https:` links. The item is only drawn; nothing runs until the user selects it. Selecting it loads that link in the tab it was clicked in and looks up its discussion, which sends the same sanitized public URL to the Algolia endpoint under the boundary described below. Links the boundary rejects are still opened in the tab, and the panel says no eligible discussion could be looked up.

The article-click opt-in, also off by default, opens a story's discussion beside the article the user clicks on Hacker News. While it is enabled, one content script is registered for `news.ycombinator.com` only. It observes the user's click on a story link, reads only that link and the story's item id already present in the page, and asks the background worker to show that discussion in the side panel. This user activity and website content are handled locally: the flow performs no lookup request and sends nothing off the device. Disabling the setting removes the registration.

## Permissions

Every installed permission exists for one documented purpose:

- **`tabs`** — lets the background worker read tab URLs. It is used to place and reuse the discussion tab next to the article after an explicit result selection; observe navigations and enumerate open tabs for the opt-in automatic badge; and identify the active tab for a one-shot side-panel check or, while a panel is already open, the separate opt-in follow setting. Tab URLs never leave the extension except as sanitized, eligible lookup candidates sent to the endpoint below, and only when one of those lookup paths is authorized.
- **`activeTab`** — scopes popup-triggered page inspection to the tab the user is looking at when they open the extension action. No page is touched without that explicit action, and article text or other page content is not read.
- **`scripting`** — serves two documented uses. First, it runs one short-lived function in the active page after the popup opens; the function reads only `location.href` and the URL from the `<link rel="canonical">` element, never article text or other content. Second, while the opt-in article-click setting is enabled, it registers one content script for `news.ycombinator.com` only, which observes story-link clicks and reads only the clicked link and story item id. While that setting is off — the default — no content script is registered anywhere; turning the setting off removes the registration.
- **`storage`** — persists the automatic-availability, side-panel-follow, and article-click on/off settings in `chrome.storage.local`. Chrome's session storage keeps time-bounded lookup results, article-to-discussion tab associations, revisioned per-window panel state, and tab-scoped panel outcomes with sanitized public article identity when needed to recognize an unchanged page. Raw article URLs are not stored for side-panel following, and Chrome discards all session values when the browser session ends. No browsing history is written to persistent storage.
- **Host access to `https://hn.algolia.com/*`** — the lookup endpoint. It receives sanitized public article URL candidates as search queries and returns matching Hacker News submissions. No account, API key, or identifying header is used.
- **`contextMenus`** — adds the single **Open in Split** item to the right-click menu for `http:` and `https:` links. Chrome decides where the item is shown from that declared pattern alone; the extension is told nothing about a right-click, and receives the link URL only when the user selects the item.
- **`sidePanel`** — opens the browser side panel, and only after an explicit user action: the side panel button in the popup, the **Open in Split** context-menu item, or — when the opt-in article-click setting is enabled — a click on a story link on Hacker News. Following can change the contents of an already-open panel but never opens the panel itself.
- **`declarativeNetRequestWithHostAccess`** — declares one dynamic rule that removes the `X-Frame-Options`, `Content-Security-Policy`, and `Content-Security-Policy-Report-Only` response headers from Hacker News **sub-frame** requests, which is what allows the discussion to render inside the side panel. The rule is installed when the first panel connects and removed after the last panel disconnects, so it does not exist while no panel is open; top-level Hacker News navigation keeps its headers, and no other site is affected. The extension does not read, block, or redirect any request. Two limits are worth stating plainly: while a panel is open the exception applies to any Hacker News sub-frame in that browser profile, not only to this extension's panel, because rule conditions cannot target a single extension frame; and removing the content-security-policy headers wholesale also drops Hacker News's own script restrictions and report-only policy inside the frame, because a header cannot be edited in part.
- **Host access to `https://news.ycombinator.com/*`** — required for the header rule above, for the side panel to embed the discussion page, and for the opt-in article-click content script described under `scripting`. The embedded page is the real, cross-origin Hacker News site. Hacker News cookies may be sent according to browser policy, while the extension document remains unable to read the framed page, its cookies, or its browser-managed position.

## Outbound URL boundary

Only public `http:`/`https:` article URLs may reach the lookup endpoint. Before any request, Split for Hacker News removes fragments and recognized tracking parameters, and rejects entirely:

- private, local, and carrier-grade IP ranges, and other IANA special-purpose addresses;
- single-label names and special-use namespaces such as `.local`, `.internal`, `.onion`, `.arpa`, `.test`, and `.example`;
- hostnames without an ICANN-recognized public suffix;
- URLs with embedded credentials, and URLs whose query string carries recognizable secrets (for example `token`, `access_token`, `code`, `sig`, or `X-Amz-*` signature parameters), which fail closed and are never sent or cached.

Split for Hacker News does not persist browsing history, store article text or content, use analytics, or access Hacker News credentials. A discussion tab or side panel is opened only after a user action; opting in may update an already-open panel as the active tab changes, but it never opens or rearranges browser tabs.

## Chrome Web Store data disclosures

Chrome's disclosures cover data handled locally as well as data transmitted off the device. Split for Hacker News declares exactly these three categories:

- **Web history** — current page, tab, or selected link URLs are handled to find a discussion. Eligible sanitized public URLs are sent to the Hacker News Algolia endpoint only for a popup or link lookup, **Check this tab**, the opt-in automatic badge, or the separate opt-in side-panel follow setting while a panel is already open.
- **Website content** — the canonical link URL is read when the user opens the popup and can be sent to Algolia as a lookup candidate. The clicked story link and item id used by the opt-in Hacker News story-click flow stay on the device. Article text and other content are not read.
- **User activity** — the opt-in Hacker News story-click flow observes a click on a story link and handles it locally to open the side panel. The click event is not transmitted off the device.

No personally identifiable, health, financial, authentication, communications, or location data is handled.

## Limited Use

The use of information received from Chrome APIs by Split for Hacker News adheres to the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/limited-use), including the Limited Use requirements.

Split for Hacker News uses and transfers that information only as necessary to provide its single purpose. The only lookup-candidate transfer is an eligible public page or selected-link URL, including an optional canonical URL where available, sent over HTTPS to Algolia's public Hacker News Search API solely to locate matching Hacker News discussions. Separately, a real Hacker News document shown in the panel connects directly to Hacker News and makes ordinary browser requests as described below. The extension does not sell user data; use or transfer it for advertising or unrelated purposes; use it to determine creditworthiness or for lending; or permit human access except where the Chrome Web Store User Data Policy allows it for security or legal compliance.

## Side panel

The side panel embeds `news.ycombinator.com` directly instead of re-rendering it. Each real Hacker News document connects the browser directly to Hacker News, which receives ordinary request metadata and any Hacker News cookies the browser sends under its policy. The extension document remains cross-origin: extension code does not inspect, inject into, message, serialize, cache, or restore Hacker News comments, HTML, DOM state, focus, cookies, credentials, or scroll offsets.

For faster return and best-effort browser-managed scroll position, one panel may keep up to three recent real Hacker News documents alive in memory. Only one is visible or keyboard-reachable. Closing or reloading the panel, a framing disconnect or reconnect, extension reload or update, least-recently-used eviction, or browser memory pressure discards a live document and can reset its position. No scroll value is ever read or stored by the extension.

Checked terminal outcomes and any sanitized article identity needed to recognize an unchanged tab are associated with their tab and window in session storage only. They are discarded when tab ownership or article identity changes and are not promised after a browser restart, extension reload, or update. The framing exception lasts while at least one valid panel connection exists; it is disclosed on the options page and in this privacy policy, while the panel itself stays focused on the real Hacker News page.
