# Privacy

HN Split has no analytics, telemetry, account, or application backend.

By default, HN Split reads the active page URL and optional canonical URL only when the user opens the extension popup. It sends eligible public URL candidates to the public Hacker News Algolia search endpoint to find exact matching Hacker News submissions. Lookup results are cached only in Chrome's session storage and are removed when the browser session ends.

HN Split includes the `tabs` permission at installation. Automatic availability badges remain off by default. When enabled in the options page, the extension checks public URLs as tabs navigate without reading page contents. Disabling the option stops automatic checks, clears badges, and removes HN lookup cache entries while preserving unrelated session data.

## Permissions

Every installed permission exists for one documented purpose:

- **`tabs`** — lets the background worker read tab URLs. It is used to place and reuse the discussion tab next to the article after an explicit click, to observe navigations and enumerate open tabs for the opt-in automatic badge, and to clear badges when that setting is turned off. Tab URLs never leave the extension except as sanitized, eligible lookup candidates sent to the endpoint below, and only when a lookup is requested.
- **`activeTab`** — scopes popup-triggered page inspection to the tab the user is looking at when they open the extension action. No page is touched without that explicit action.
- **`scripting`** — runs one short-lived function in the active page after the popup opens. The function reads only `location.href` and the `<link rel="canonical">` element; no persistent content script is registered and no page content beyond that link element is read.
- **`storage`** — persists the automatic-availability on/off setting in `chrome.storage.local`, and keeps time-bounded lookup results plus article-to-discussion tab associations in `chrome.storage.session`, which Chrome discards when the browser session ends. No browsing history is written to persistent storage.
- **Host access to `https://hn.algolia.com/*`** — the only remote endpoint the extension may contact. It receives sanitized public article URL candidates as search queries and returns matching Hacker News submissions. No account, API key, or identifying header is used.

## Outbound URL boundary

Only public `http:`/`https:` article URLs may reach the lookup endpoint. Before any request, HN Split removes fragments and recognized tracking parameters, and rejects entirely:

- private, local, and carrier-grade IP ranges, and other IANA special-purpose addresses;
- single-label names and special-use namespaces such as `.local`, `.internal`, `.onion`, `.arpa`, `.test`, and `.example`;
- hostnames without an ICANN-recognized public suffix;
- URLs with embedded credentials, and URLs whose query string carries recognizable secrets (for example `token`, `access_token`, `code`, `sig`, or `X-Amz-*` signature parameters), which fail closed and are never sent or cached.

HN Split does not persist browsing history, store article content, use analytics, or access Hacker News credentials. A discussion tab is opened only after the user selects it.
