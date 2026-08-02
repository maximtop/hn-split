# ADR-0001: Use HNewhere as a Behavioral Reference, Not an Implementation Base

- **Status:** Accepted
- **Date:** 2026-08-02
- **Decision owners:** HN Split project
- **Related task:** 02 — Analyze HNewhere as a product and implementation reference
- **Reference analysis:** [`../hnewhere_reference.md`](../hnewhere_reference.md)

## Context

HNewhere is a mature single-file userscript that discovers Hacker News submissions for the current page and renders comments in an in-page sidebar. It demonstrates useful product behavior and contains tested solutions for URL matching, duplicate submissions, asynchronous loading, soft navigation, and privacy disclosures.

HN Split has a narrower MVP and a different platform boundary:

- Chrome WebExtension first, not a userscript;
- React and TypeScript, not one injected JavaScript file;
- one current article and one selected HN discussion;
- comments open only after an explicit user action;
- native Chrome Split View if a supported API is proven, otherwise an adjacent-tab/native-action fallback;
- no embedded comment client, authenticated HN actions, or article annotations;
- minimal permissions and no telemetry.

Copying HNewhere would inherit a large DOM, storage, authentication, and security surface that is unrelated to the MVP.

## Decision

HN Split will treat HNewhere as a **behavioral and algorithmic reference only**. No HNewhere source code will be copied into the product scaffold.

### Adopt

1. **Pre-click availability check**
   - Determine whether the current article has an HN discussion before the user opens the extension surface.
   - Represent checking, found, no-result, restricted, and error states explicitly.

2. **Search followed by exact verification**
   - Search a public HN index for URL candidates.
   - Normalize every returned result locally.
   - Accept only an exact match against one of the current article's conservative candidates.

3. **Deterministic duplicate handling**
   - Deduplicate by HN item ID.
   - Initial primary ranking: comments descending, points descending, submission time descending.

4. **Bounded caching**
   - Cache stable positive matches.
   - Re-sort cached results with the current ranking rule.
   - Keep cache format versioned so matching changes can invalidate old entries.

5. **Soft-navigation awareness**
   - Detect meaningful URL changes in single-page applications.
   - Cancel or ignore stale lookup results from a previous page identity.

6. **Privacy posture**
   - No backend, analytics, telemetry, or account.
   - Disclose remote hosts and justify every requested permission.

### Adapt

1. **URL identity**
   - HNewhere uses one normalized `location.href` identity.
   - HN Split will produce an ordered candidate set including the browser URL and a safe document canonical URL when available.
   - Normalization will be conservative and fixture-driven.

2. **Caching policy**
   - HNewhere caches positive and empty results for one hour.
   - HN Split will use separate positive and negative TTLs; initial values must be validated through tests and dogfood.

3. **Failure states**
   - HNewhere often resolves request failure to the same empty outcome as no match.
   - HN Split will distinguish no discussion, offline, timeout, service error, unsupported page, and malformed response.

4. **Runtime architecture**
   - Cross-origin lookup belongs in the MV3 service-worker/provider boundary.
   - Page inspection should be narrow and short-lived.
   - UI state is derived from typed provider results rather than direct DOM/network coupling.

5. **Discussion opening**
   - A result selection must resolve to one concrete `https://news.ycombinator.com/item?id=<id>` URL.
   - The click opens only that selected discussion.
   - Native Split View is used only if the Chrome capability spike proves a supported extension API.

### Reject for the MVP

1. In-page rendering of Hacker News comments.
2. Blending comments from multiple HN submissions.
3. Automatic opening, moving, grouping, or resizing of tabs.
4. Iframe-based imitation of Split View.
5. Voting, replying, submitting, or using the user's HN session.
6. Comment-to-article quote annotations.
7. Broad always-on content-script access equivalent to userscript `http://*` and `https://*` coverage.
8. Per-site sidebar widths, visual customization, seen-comment state, and vote memory.
9. A manually maintained sensitive-site denylist as the primary privacy control.

### Defer

1. A chooser for alternative HN submissions after the primary flow is proven.
2. Article annotations or discussion heat maps.
3. Submit-to-HN actions.
4. Reddit and Lobsters providers.
5. Per-site preferences.
6. Publisher-specific URL alias rules without fixture evidence.

## Consequences

### Positive

- The MVP remains small enough to validate the article-to-discussion interaction.
- Permissions and security review stay tractable.
- HN account credentials and authenticated actions are out of scope.
- Matching behavior is deterministic and testable independently of UI.
- Split View research is not confused with an injected-sidebar workaround.

### Negative

- Users cannot read comments without opening HN.
- Some HNewhere conveniences, including annotations and blended threads, are intentionally unavailable.
- Proactive availability may still require carefully justified page access; the architecture spike must make that trade-off explicit.
- Algolia remains an external dependency and needs a documented failure path.

### Risks

- Canonical metadata can point to a wrong or overly broad URL.
- Conservative matching can miss legitimate aliases.
- The highest-comment submission may not always be the discussion the user expects.
- Chrome may expose Split View state without exposing a supported creation API.

These risks are handled by URL fixtures, deterministic alternatives, a real-browser Split View spike, and explicit fallback behavior rather than undocumented APIs.

## Validation

This decision is implemented when:

- `docs/hnewhere_reference.md` records the verified code path with source permalinks;
- URL-normalization tests include raw URL, canonical URL, tracking parameters, fragments, trailing slashes, duplicate query keys, and malformed canonical metadata;
- HN-provider tests verify exact matching, deduplication, ordering, timeout, malformed response, and no-result behavior;
- opening tests assert that no tab action occurs before a user gesture and that one selected item ID maps to one HN discussion URL;
- no HNewhere source code, embedded comments UI, HN-auth bridge, or iframe split-view implementation enters the MVP.

## Revisit conditions

Revisit this ADR only if one of the following is true:

- private-alpha evidence shows that opening HN instead of rendering comments fails the core product goal;
- Chrome publishes a stable extension API that materially changes the Split View design;
- Algolia becomes unsuitable and the provider architecture needs a different public index;
- users consistently need alternative submissions in the primary flow rather than as a secondary action.
