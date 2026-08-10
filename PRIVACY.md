# Privacy

Split for Hacker News has no analytics, telemetry, account, or application backend.

Last updated: August 10, 2026. Privacy contact: [me@maximtop.dev](mailto:me@maximtop.dev).

By default, Split for Hacker News reads the active page URL and the optional URL from its canonical `<link>` element only when the user opens the extension popup. It does not read article text or other page content. It sends eligible public URL candidates over HTTPS to the public Hacker News Algolia search endpoint to find exact matching Hacker News submissions. Algolia is the only third party that receives lookup candidates from the extension; as the network provider, it may also receive standard connection metadata under the [Algolia Privacy Policy](https://www.algolia.com/policies/privacy/). Lookup results are cached only in Chrome's session storage and are removed when the browser session ends.

Split for Hacker News includes the `tabs` permission at installation. Automatic availability badges remain off by default. When enabled in the options page, the extension checks public tab URLs as tabs navigate; it does not inspect article text or other page content. Disabling the option stops automatic checks, clears badges, and removes HN lookup cache entries while preserving unrelated session data.

Split for Hacker News adds one right-click item, **Open in Split**, to `http:` and `https:` links. The item is only drawn; nothing runs until the user selects it. Selecting it loads that link in the tab it was clicked in and looks up its discussion, which sends the same sanitized public URL to the Algolia endpoint under the boundary described below. Links the boundary rejects are still opened in the tab, and the panel says no eligible discussion could be looked up.

A second opt-in setting, also off by default, opens a story's discussion beside the article the user clicks on Hacker News. While it is enabled, one content script is registered for `news.ycombinator.com` only. It observes the user's click on a story link, reads only that link and the story's item id already present in the page, and asks the background worker to show that discussion in the side panel. This user activity and website content are handled locally: the flow performs no lookup request and sends nothing off the device. Disabling the setting removes the registration.

## Permissions

Every installed permission exists for one documented purpose:

- **`tabs`** — lets the background worker read tab URLs. It is used to place and reuse the discussion tab next to the article after an explicit result selection, to observe navigations and enumerate open tabs for the opt-in automatic badge, and to clear badges when that setting is turned off. Tab URLs never leave the extension except as sanitized, eligible lookup candidates sent to the endpoint below, and only when a lookup is requested.
- **`activeTab`** — scopes popup-triggered page inspection to the tab the user is looking at when they open the extension action. No page is touched without that explicit action, and article text or other page content is not read.
- **`scripting`** — serves two documented uses. First, it runs one short-lived function in the active page after the popup opens; the function reads only `location.href` and the URL from the `<link rel="canonical">` element, never article text or other content. Second, while the opt-in article-click setting is enabled, it registers one content script for `news.ycombinator.com` only, which observes story-link clicks and reads only the clicked link and story item id. While that setting is off — the default — no content script is registered anywhere; turning the setting off removes the registration.
- **`storage`** — persists the automatic-availability and article-click on/off settings in `chrome.storage.local`, and keeps time-bounded lookup results plus article-to-discussion tab associations and the side panel selection in `chrome.storage.session`, which Chrome discards when the browser session ends. No browsing history is written to persistent storage.
- **Host access to `https://hn.algolia.com/*`** — the lookup endpoint. It receives sanitized public article URL candidates as search queries and returns matching Hacker News submissions. No account, API key, or identifying header is used.
- **`contextMenus`** — adds the single **Open in Split** item to the right-click menu for `http:` and `https:` links. Chrome decides where the item is shown from that declared pattern alone; the extension is told nothing about a right-click, and receives the link URL only when the user selects the item.
- **`sidePanel`** — opens the browser side panel, and only after an explicit user action: the side panel button in the popup, the **Open in Split** context-menu item, or — when the opt-in article-click setting is enabled — a click on a story link on Hacker News.
- **`declarativeNetRequestWithHostAccess`** — declares one dynamic rule that removes the `X-Frame-Options`, `Content-Security-Policy`, and `Content-Security-Policy-Report-Only` response headers from Hacker News **sub-frame** requests, which is what allows the discussion to render inside the side panel. The rule is installed when a side panel opens and removed when it closes, so it does not exist while no panel is open; top-level Hacker News navigation keeps its headers, and no other site is affected. The extension does not read, block, or redirect any request. Two limits are worth stating plainly: while a panel is open the exception applies to any Hacker News sub-frame in that browser profile, not only to this extension's panel, because rule conditions cannot target a single extension frame; and removing the content-security-policy headers wholesale also drops Hacker News's own script restrictions and report-only policy inside the frame, because a header cannot be edited in part.
- **Host access to `https://news.ycombinator.com/*`** — required for the header rule above, for the side panel to embed the discussion page, and for the opt-in article-click content script described under `scripting`. The embedded page is the real Hacker News site: the user's own Hacker News session applies inside the panel exactly as it does in a tab, and the extension neither reads nor stores anything from it.

## Outbound URL boundary

Only public `http:`/`https:` article URLs may reach the lookup endpoint. Before any request, Split for Hacker News removes fragments and recognized tracking parameters, and rejects entirely:

- private, local, and carrier-grade IP ranges, and other IANA special-purpose addresses;
- single-label names and special-use namespaces such as `.local`, `.internal`, `.onion`, `.arpa`, `.test`, and `.example`;
- hostnames without an ICANN-recognized public suffix;
- URLs with embedded credentials, and URLs whose query string carries recognizable secrets (for example `token`, `access_token`, `code`, `sig`, or `X-Amz-*` signature parameters), which fail closed and are never sent or cached.

Split for Hacker News does not persist browsing history, store article text or content, use analytics, or access Hacker News credentials. A discussion tab is opened only after the user selects a result.

## Chrome Web Store data disclosures

Chrome's disclosures cover data handled locally as well as data transmitted off the device. Split for Hacker News declares exactly these three categories:

- **Web history** — current page, tab, or selected link URLs are handled to find a discussion. Eligible sanitized public URLs are sent to the Hacker News Algolia endpoint only for a requested lookup or the opt-in automatic badge.
- **Website content** — the canonical link URL is read when the user opens the popup and can be sent to Algolia as a lookup candidate. The clicked story link and item id used by the opt-in Hacker News story-click flow stay on the device. Article text and other content are not read.
- **User activity** — the opt-in Hacker News story-click flow observes a click on a story link and handles it locally to open the side panel. The click event is not transmitted off the device.

No personally identifiable, health, financial, authentication, communications, or location data is handled.

## Limited Use

The use of information received from Chrome APIs by Split for Hacker News adheres to the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/limited-use), including the Limited Use requirements.

Split for Hacker News uses and transfers that information only as necessary to provide its single purpose. The only off-device transfer initiated by the extension is an eligible public page or selected-link URL candidate, including an optional canonical URL where available, sent over HTTPS to Algolia's public Hacker News Search API solely to locate matching Hacker News discussions. The extension does not sell user data; use or transfer it for advertising or unrelated purposes; use it to determine creditworthiness or for lending; or permit human access except where the Chrome Web Store User Data Policy allows it for security or legal compliance.

## Side panel

The side panel embeds `news.ycombinator.com` directly instead of re-rendering it. Opening a selected discussion therefore connects the browser directly to Hacker News, which receives the ordinary request metadata and Hacker News cookies that it would receive for the same page in a normal tab. The extension does not read the framed page, its cookies, or the user's Hacker News session. The only state the extension keeps is the selected discussion identifier, or the status of a lookup in progress, in session storage. The framing exception described above is the entire mechanism and its lifetime is the panel's lifetime. The exception is disclosed on the extension's options page and in this privacy policy; the side panel itself shows the embedded Hacker News page, not a framing notice.
