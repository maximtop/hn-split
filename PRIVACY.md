# Privacy

HN Split has no analytics, telemetry, account, or application backend.

By default, HN Split reads the active page URL and optional canonical URL only when the user opens the extension popup. It sends eligible public URL candidates to the public Hacker News Algolia search endpoint to find exact matching Hacker News submissions. Lookup results are cached only in Chrome's session storage and are removed when the browser session ends.

HN Split includes the `tabs` permission at installation. Automatic availability badges remain off by default. When enabled in the options page, the extension checks public URLs as tabs navigate without reading page contents. Disabling the option stops automatic checks, clears badges, and removes HN lookup cache entries while preserving unrelated session data.

Private IP ranges, local and single-label names, special-use suffixes, and hostnames without an ICANN-recognized public suffix are rejected before lookup. HN Split does not persist browsing history, store article content, use analytics, or access Hacker News credentials. A discussion tab is opened only after the user selects it.
