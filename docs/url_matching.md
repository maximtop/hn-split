# URL Matching and Hacker News Lookup Contract

## Goal

Given the page currently open, find Hacker News submissions for that article without aggressive URL rewriting or false matches. Return one deterministic primary discussion and any exact alternatives. Opening comments remains a separate, explicit user action.

## Inputs

- `pageUrl`: the current tab URL.
- `canonicalHref`: optional `<link rel="canonical">` value read from the page.

Only public `http:` and `https:` URLs are eligible. URLs with credentials, private/local hosts, or invalid syntax are ignored.

## Candidate construction

Build an ordered list:

1. resolved canonical URL, when valid;
2. current page URL;
3. deduplicate entries whose normalized identities are equal.

A relative canonical URL is resolved against `pageUrl`. A cross-origin canonical is allowed as a candidate because syndicated articles often point to the original publisher, but it never replaces or suppresses the current URL candidate.

Do not fetch redirects during candidate construction. The browser's final current URL is already available, and extra redirect requests add latency and privacy cost.

## Normalized identity

Normalization is deliberately conservative:

1. Parse with the platform `URL` implementation.
2. Require `http:` or `https:`.
3. Reject credentials and private/local hosts.
4. Lowercase the hostname.
5. Remove a default port (`80` for HTTP, `443` for HTTPS).
6. Ignore the scheme so HTTP and HTTPS versions can match.
7. Drop the fragment.
8. Remove one trailing slash from a non-root path.
9. Remove only known tracking parameters, case-insensitively:
   - every key beginning with `utm_`;
   - `fbclid`;
   - `gclid`;
   - `dclid`;
   - `msclkid`;
   - `mc_cid`;
   - `mc_eid`;
   - `igshid`.
10. Preserve every other query parameter, including its order and duplicate values.
11. Preserve path case, `www`, subdomains, AMP paths, and mobile hosts.

The identity is `hostname + normalizedPort + pathname + search`.

No publisher-specific rewrites are allowed until a failing real-world fixture proves they are necessary.

## Testable examples

| Input | Expected identity or result |
|---|---|
| `https://example.com/story` | `example.com/story` |
| `http://EXAMPLE.com:80/story/` | `example.com/story` |
| `https://example.com:443/story#comments` | `example.com/story` |
| `https://example.com/story?utm_source=hn&id=7` | `example.com/story?id=7` |
| `https://example.com/story?ID=7&utm_campaign=x` | `example.com/story?ID=7` |
| `https://example.com/story?id=1&id=2` | `example.com/story?id=1&id=2` |
| `https://www.example.com/story` | `www.example.com/story` |
| `https://m.example.com/story` | `m.example.com/story` |
| `https://example.com/Story` | `example.com/Story` |
| `https://example.com/amp/story` | `example.com/amp/story` |
| `mailto:editor@example.com` | ineligible |
| `https://user:pass@example.com/story` | ineligible |
| `http://localhost/story` | ineligible |
| malformed canonical + valid page URL | ignore canonical; use page URL |
| cross-origin canonical + valid page URL | keep canonical first and page URL second |

These examples become executable tests when the URL module is implemented; no separate fixture file is needed at the specification stage.

## Hacker News lookup

For each distinct candidate URL:

1. Search Algolia's public HN index with `tags=story`, `restrictSearchableAttributes=url`, and `hitsPerPage=20`.
2. Query using the original candidate URL; candidate searches may run in parallel.
3. Never trust search relevance alone.
4. Normalize every returned hit URL using the same function.
5. Keep a hit only when its identity exactly equals a candidate identity.
6. Deduplicate retained hits by HN `objectID`.

Initial endpoint:

```text
https://hn.algolia.com/api/v1/search?tags=story&restrictSearchableAttributes=url&hitsPerPage=20&query=<candidate>
```

No API key, backend, or telemetry is required.

## Ranking

Sort exact matches by:

1. `num_comments` descending;
2. `points` descending;
3. `created_at_i` descending;
4. numeric `objectID` descending as the final stable tie-break.

The first result is the primary discussion. Alternatives remain structured results but are not blended together. A comments action always targets one concrete URL:

```text
https://news.ycombinator.com/item?id=<objectID>
```

## Result states

The provider returns one of four typed outcomes:

- `found`: primary discussion plus zero or more alternatives;
- `not_found`: every valid candidate completed successfully with no exact match;
- `restricted`: no eligible public HTTP(S) candidate exists;
- `error`: lookup could not be completed because of timeout, offline state, service failure, or malformed response.

A network failure must never be reported as `not_found`.

## Timeouts and cache

Keep the first implementation simple:

- one five-second timeout for the full lookup operation;
- positive results cached for one hour;
- `not_found` cached for ten minutes;
- errors are not cached;
- cache key is the ordered set of normalized candidate identities;
- cache version is included in the key so rule changes invalidate old data.

## Explicit exclusions

This contract does not include:

- redirect crawling;
- HEAD requests to publishers;
- AMP/mobile/`www` rewriting;
- fuzzy title matching;
- publisher-specific aliases;
- searching Reddit or Lobsters;
- submitting a missing article to Hacker News;
- opening, moving, or resizing a tab before a user click.

## Implementation acceptance

The later implementation is correct when automated tests cover:

- every example above;
- canonical resolution and candidate order;
- tracking removal without deleting meaningful parameters;
- exact post-search verification;
- duplicate HN items and stable ranking;
- found, not-found, restricted, timeout, malformed-response, and offline states;
- a guarantee that one selected item ID produces one HN discussion URL.
