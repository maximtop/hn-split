# HNewhere Reference Analysis

## Analysis metadata

- **Reference:** [twalichiewicz/HNewhere](https://github.com/twalichiewicz/HNewhere)
- **Analyzed revision:** [`26de8641bf6c806e710143856653a75c17649a28`](https://github.com/twalichiewicz/HNewhere/tree/26de8641bf6c806e710143856653a75c17649a28)
- **Userscript version:** `1.5.7`
- **Files reviewed:** `README.md`, `HNewhere.user.js`
- **Purpose:** identify proven article-to-Hacker-News behavior without treating the userscript as an implementation base for HN Split

## Executive summary

HNewhere proves that article-to-Hacker-News discovery can feel immediate without a backend or telemetry. It checks the current page before the user asks, turns a persistent HN button active when a discussion exists, and opens an in-page comments sidebar after the user clicks.

Its lookup path is concrete and reproducible: normalize the current URL, search Algolia twice, keep only exact normalized URL matches, deduplicate by HN object ID, rank by discussion activity, cache for one hour, and use the Firebase HN API to load full stories and comments.

HN Split should adopt the lookup discipline and quiet availability signal, but not the sidebar, comment rendering, account bridges, broad page injection, or blended multi-thread experience. The browser extension should open one concrete HN discussion after an explicit user action, preferably through a proven Chrome Split View path and otherwise through the documented fallback.

## Actual code path

### 1. Page eligibility

The userscript declares `http://*` and `https://*` includes, then excludes a list of sensitive or low-value sites and file types in metadata. Runtime checks add private hosts, authentication paths, payment paths, dashboards, messaging applications, search pages, and per-site user blocks.

Relevant source:

- [Userscript metadata and allowed network hosts](https://github.com/twalichiewicz/HNewhere/blob/26de8641bf6c806e710143856653a75c17649a28/HNewhere.user.js#L1-L55)
- [`isPrivateHostname` and `isHiddenSite`](https://github.com/twalichiewicz/HNewhere/blob/26de8641bf6c806e710143856653a75c17649a28/HNewhere.user.js#L695-L806)
- [`runPagePass` eligibility checks](https://github.com/twalichiewicz/HNewhere/blob/26de8641bf6c806e710143856653a75c17649a28/HNewhere.user.js#L10277-L10308)

This is a defensive response to an always-on userscript. It is not evidence that HN Split should request equivalent access.

### 2. Immediate checking state

Unless the user chose to hide the control when no discussion exists, HNewhere creates an inert checking button before waiting for network lookup. It starts a spinner and later adopts that same button as the active or no-result surface.

Relevant source:

- [`createCheckingButton`](https://github.com/twalichiewicz/HNewhere/blob/26de8641bf6c806e710143856653a75c17649a28/HNewhere.user.js#L2640-L2667)
- [Checking button before lookup](https://github.com/twalichiewicz/HNewhere/blob/26de8641bf6c806e710143856653a75c17649a28/HNewhere.user.js#L10310-L10321)

### 3. URL normalization

`normalizeURL`:

1. parses the input with `URL`;
2. removes seven known tracking parameters: `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `fbclid`, and `gclid`;
3. lowercases the hostname;
4. removes one trailing slash from the path;
5. preserves all other query parameters;
6. returns `hostname + pathname + search`.

The returned identity deliberately excludes scheme and fragment. It does not read `<link rel="canonical">`, normalize `www`, remove default ports explicitly, reorder query parameters, or apply publisher-specific aliases.

Relevant source:

- [Tracking parameter list](https://github.com/twalichiewicz/HNewhere/blob/26de8641bf6c806e710143856653a75c17649a28/HNewhere.user.js#L244-L252)
- [`normalizeURL`](https://github.com/twalichiewicz/HNewhere/blob/26de8641bf6c806e710143856653a75c17649a28/HNewhere.user.js#L666-L689)
- [`sameURL`](https://github.com/twalichiewicz/HNewhere/blob/26de8641bf6c806e710143856653a75c17649a28/HNewhere.user.js#L7754-L7760)

### 4. Hacker News lookup

`findHN` normalizes the current URL and uses that value as the cache identity. A stored result younger than one hour is returned immediately and re-sorted with the current ranking rule.

For an uncached page, the function sends two Algolia searches:

- the original URL;
- the normalized identity.

Each query is limited to stories, restricts the searchable field to `url`, and asks for up to 20 hits. Algolia results are not trusted directly: every result URL is normalized again and must exactly equal the target. Matches are deduplicated by `objectID`.

Both positive and empty result arrays are cached for one hour.

Relevant source:

- [`findHN`](https://github.com/twalichiewicz/HNewhere/blob/26de8641bf6c806e710143856653a75c17649a28/HNewhere.user.js#L614-L660)
- [README network disclosure](https://github.com/twalichiewicz/HNewhere/blob/26de8641bf6c806e710143856653a75c17649a28/README.md#L25-L32)

### 5. Duplicate ranking

The sort order is:

1. comment count descending;
2. points descending;
3. submission time descending.

The code supports the field names used by both Firebase items and Algolia hits. The rationale in the source is product-relevant: a recent resubmission with no discussion should not hide an older thread with useful comments.

Relevant source:

- [`discussionRank` and `compareStoriesByDiscussion`](https://github.com/twalichiewicz/HNewhere/blob/26de8641bf6c806e710143856653a75c17649a28/HNewhere.user.js#L588-L612)

### 6. Availability and explicit interaction

When matches exist, the checking button becomes active and `presentDiscussion` decides whether to auto-open, preload while hidden, or expose a collapsed button. Auto-open is configurable but disabled by default.

The normal collapsed button opens the sidebar only from its click handler. Dragging the button does not count as a click. If no story reference exists, the button shows failure feedback instead of opening an arbitrary view.

Relevant source:

- [Default settings](https://github.com/twalichiewicz/HNewhere/blob/26de8641bf6c806e710143856653a75c17649a28/HNewhere.user.js#L185-L201)
- [`createCollapsedButton` click behavior](https://github.com/twalichiewicz/HNewhere/blob/26de8641bf6c806e710143856653a75c17649a28/HNewhere.user.js#L2669-L2693)
- [`presentDiscussion`](https://github.com/twalichiewicz/HNewhere/blob/26de8641bf6c806e710143856653a75c17649a28/HNewhere.user.js#L10381-L10404)

### 7. Story and comment loading

`getItem` loads each HN item from `https://hacker-news.firebaseio.com/v0/item/<id>.json` and keeps an in-memory item cache. `loadStories` deduplicates IDs again, loads the full Firebase items in parallel, drops invalid and non-story results, and reapplies the discussion ranking.

`runOpenSidebar` constructs the panel before loading, shows named loading stages, and then renders either one thread or a blended multi-submission view.

Relevant source:

- [`getItem`](https://github.com/twalichiewicz/HNewhere/blob/26de8641bf6c806e710143856653a75c17649a28/HNewhere.user.js#L569-L586)
- [`loadStories`](https://github.com/twalichiewicz/HNewhere/blob/26de8641bf6c806e710143856653a75c17649a28/HNewhere.user.js#L7003-L7020)
- [`openSidebar` and `runOpenSidebar`](https://github.com/twalichiewicz/HNewhere/blob/26de8641bf6c806e710143856653a75c17649a28/HNewhere.user.js#L7097-L7186)

### 8. Soft navigation

The script handles single-page applications by combining patched `pushState` and `replaceState`, a `popstate` listener, and a 400 ms poll. URL changes are debounced for 250 ms, normalized before comparison, and serialized so an old teardown cannot race a new page pass.

Relevant source:

- [`watchSoftNavigation`](https://github.com/twalichiewicz/HNewhere/blob/26de8641bf6c806e710143856653a75c17649a28/HNewhere.user.js#L10134-L10225)

## Failure-state behavior

| Condition | HNewhere behavior | HN Split implication |
|---|---|---|
| Invalid URL | Normalization returns an empty string; lookup returns no matches | Show a restricted/unsupported page state rather than a generic no-result |
| Request error, timeout, or invalid JSON | Request resolves to `null` after a 10-second timeout | Preserve the distinction between network failure and genuine no discussion |
| No Algolia match | Empty result is cached for one hour; submit action may be offered | Use a shorter negative cache initially; submission is outside MVP |
| Duplicate submissions | IDs are deduplicated, sorted, then potentially blended in one sidebar | Rank deterministically, but open one concrete HN item and never blend threads |
| Firebase item missing or not a story | Invalid item is filtered | If the chosen item cannot load, fall back to its HN item URL or show a recoverable error |
| Page changes during render | Generation counter and serialized teardown prevent stale rendering | Keep an operation identity or cancellation mechanism in the service worker/content boundary |
| Sensitive/private page | Script does nothing | Prefer permission architecture over a large manually maintained denylist |

## Privacy and security observations

Positive patterns:

- no application backend;
- no analytics or telemetry;
- network hosts are disclosed;
- sensitive destinations are excluded;
- remote HN HTML is sanitized before rendering;
- cross-window bridge payloads and URLs are validated.

Costs created by the userscript architecture:

- execution on almost every public HTTP(S) page;
- extensive DOM injection and Shadow DOM UI;
- local storage for settings, seen comments, votes, and bridge payloads;
- authenticated vote, reply, and submit bridges that substantially expand the security surface.

HN Split can avoid most of those costs because its MVP opens the native HN discussion instead of reproducing Hacker News inside the article.

## Adopt, adapt, reject, and defer summary

### Adopt

- check whether a discussion exists before the user clicks;
- provide clear checking, found, not found, restricted, and error states;
- normalize before trusting search results;
- perform exact post-search matching;
- deduplicate by HN item ID;
- rank by comments, points, and recency;
- use bounded caching;
- handle soft navigation;
- remain free, backend-free, and telemetry-free;
- require an explicit action before opening comments.

### Adapt

- add document canonical URL as a candidate rather than relying only on `location.href`;
- keep multiple conservative URL candidates instead of collapsing all identity into one string;
- separate negative-cache TTL from positive-cache TTL;
- expose network failure separately from no result;
- implement lookup in an MV3 service worker with narrowly justified host access;
- open a single HN item in proven native Split View or the approved adjacent-tab fallback.

### Reject for the MVP

- in-page comments sidebar;
- blended comments from multiple submissions;
- automatic opening or tab rearrangement;
- iframe-based split-view imitation;
- voting, replying, submission, or HN-session bridges;
- quote annotations and article text indexing;
- always-on broad userscript access;
- per-site appearance and sidebar-state complexity.

### Defer

- alternative-discussion chooser;
- annotation experiments;
- per-site preferences;
- submit-to-HN workflow;
- Reddit or Lobsters providers;
- localization-specific publisher URL aliases until fixtures show a real need.

## Conclusions for the next tasks

1. URL normalization should be fixture-driven and return ordered candidates, not one aggressively rewritten URL.
2. HN lookup can start with Algolia, but exact candidate matching must remain local and deterministic.
3. The primary discussion ranking can reuse the comments → points → time rule as the initial baseline.
4. Opening behavior must carry one specific HN item ID from result selection to the user-triggered browser action.
5. Chrome Split View capability must be proven independently; HNewhere's DOM sidebar does not answer that question.
6. The architecture should make network failure, no result, and unsupported page distinct states from the first implementation.
