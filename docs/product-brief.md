# HN Split MVP Product Brief

- **Status:** Implemented; retained as the historical MVP brief and decision record
- **Public name:** Split for Hacker News (approved 2026-08-03)
- **Working name:** HN Split (remains the internal slug for the repository, package, and identifiers)
- **Primary browser:** Chrome
- **Discussion source:** Hacker News only
- **Business model:** Free
- **Telemetry:** None

## 1. Problem

People often encounter an article first and only later discover that it has a useful Hacker News discussion. Finding that discussion currently requires leaving the reading flow, copying or editing the URL, searching Hacker News or another search service, evaluating duplicate submissions, and opening the right comments page.

HN Split should make that transition deliberate and immediate without monitoring browsing history, rearranging tabs automatically, or adding a second social feed to the article.

## 2. Product goal

When a user is reading an article that has been submitted to Hacker News, show that a discussion exists and let the user open the relevant Hacker News comments after one explicit action.

The MVP validates one question:

> Can a small, privacy-preserving browser extension reliably connect the article currently open to its Hacker News discussion with less effort than a manual search?

## 3. Target user

The primary user:

- reads technical, startup, science, or general-interest articles in a desktop browser;
- values Hacker News comments as a second layer of context;
- wants to reach the discussion without manually searching;
- expects the extension to stay quiet until it is useful;
- does not want browsing telemetry or automatic tab manipulation.

## 4. Core user journey

1. The user opens and reads an article.
2. HN Split determines the article URL and its safe canonical candidates.
3. HN Split checks whether Hacker News has a matching submission.
4. The browser action indicates whether comments are available.
5. The user explicitly clicks the comments action.
6. HN Split opens the selected Hacker News discussion using the best supported browser flow:
   - native Chrome Split View, only if a supported extension API is proven; or
   - the approved adjacent-tab/native-action fallback.
7. The article is never moved, replaced, or paired automatically before the click.

The product deals with one current article at a time. Comments and links inside the Hacker News thread do not become additional article-matching targets.

## 5. MVP scope

### Included

- Chrome desktop as the first runtime target.
- Manifest V3 WebExtension built with React and TypeScript.
- Detection of the current article URL.
- Canonical URL extraction and conservative normalization.
- Lookup of matching Hacker News submissions through public, credential-free endpoints.
- Deterministic ranking and deduplication when Hacker News contains multiple submissions.
- A quiet extension-action state for loading, found, not found, restricted page, and error.
- Explicit user-triggered opening of Hacker News comments.
- Native Chrome Split View only if a documented and reproducible extension path exists.
- A clear fallback when Split View cannot be created programmatically.
- Minimal permissions, no telemetry, and no account requirement.
- Unit, integration, and packaged-extension end-to-end tests.
- MVP validation followed by a public Chrome Web Store release.

### Completed Chrome release work

- Public Chrome Web Store release of version 0.1.0.
- Extension UI and store listings for 40 priority locales.

### Post-MVP active-panel enhancement

- **Follow active tabs in the side panel** is a separate opt-in, off by default and independent from the toolbar badge. It runs only while the user already has the panel open and never opens or rearranges tabs.
- With following off, **Check this tab** performs one check; **Follow tabs automatically** opts in and checks the currently active tab in the same action.
- Checked terminal outcomes and sanitized article identity are session-only. Found URL lookups may be reused for one hour and not-found lookups for ten minutes; restricted pages and failures are not added to the URL cache.
- The panel may retain up to three recent real Hacker News documents for faster return and best-effort browser-managed position. Extension code never reads or restores their comments, DOM, focus, cookies, or scroll values.

### Follow-up browser releases

- Firefox Add-ons adaptation and submission.
- Microsoft Edge Add-ons adaptation and submission.
- Safari Web Extension wrapper and App Store submission.

These browser ports remain part of the project roadmap but did not delay the Chrome release.

## 6. Explicit non-goals for the MVP

- Reddit, Lobsters, or any discussion source other than Hacker News.
- Automatically opening a side panel or comments tab when an article loads. An already-open panel may update only after the separate follow opt-in.
- Automatically moving, resizing, grouping, or rearranging the user's tabs.
- Creating a fake split view with an iframe.
- Embedding or rewriting the article body.
- Showing every link mentioned inside an HN discussion as another matched article.
- Collecting browsing history, analytics, advertising identifiers, or usage telemetry.
- Requiring a Hacker News login or performing authenticated Hacker News actions.
- Voting, commenting, saving, or moderating Hacker News from the extension.
- A mobile-browser experience.
- A paid tier, subscription, or account system.

## 7. Product principles

### User action is the boundary

HN Split may detect availability under a user-enabled automatic preference, but it must never open the side panel or open, move, replace, or rearrange tabs automatically. Enabling follow authorizes later content changes only inside an already-open panel; one-shot checking remains available without enabling it.

### Privacy by architecture

The extension should request the narrowest viable permissions, avoid broad browsing-history access, retain only short-lived lookup data needed for responsiveness, and send no telemetry.

### One simple answer first

For one article, show one primary discussion. If duplicate submissions exist, rank them deterministically and keep alternatives secondary rather than forcing a choice on every click.

### Browser truth over product wish

The Split View experience must follow documented, tested browser capabilities. Because Chrome does not expose a supported creation API, the adjacent-tab flow is the honest fallback; the separate browser side-panel flow never embeds anything in the article page.

### Public services are dependencies, not guarantees

HN lookup must have bounded timeouts, explicit errors, conservative caching, and no paid or secret API dependency.

## 8. Historical MVP success criteria

The MVP was evaluated against the following pre-release criteria:

1. **Matching quality:** the curated fixture set of known Hacker News articles resolves the expected primary discussion in at least 95% of cases, with no known false positive in the release fixture set.
2. **User control:** no test path opens or rearranges a tab before an explicit comments click.
3. **Interaction cost:** when a primary match is available, comments are reachable through one extension action; any browser-required native follow-up is explained clearly.
4. **Performance:** cached availability is rendered within 250 ms in local measurement, and the normal uncached lookup has a documented target budget of 1.5 seconds on a typical connection.
5. **Privacy:** no telemetry endpoint, browsing-history collection, advertising identifier, or account is present; every permission is documented and justified.
6. **Reliability:** loading, no-result, restricted-page, timeout, offline, and malformed-response states are covered by automated tests.
7. **Quality gates:** lint, type checking, unit/integration tests, build, and packaged-extension E2E pass in CI.
8. **Dogfood:** the private alpha is exercised on at least 50 article pages across at least 20 publishers, and blocking failures are resolved or documented before store work begins.

Success is measured through deterministic fixtures, CI, local performance runs, and structured private-alpha notes—not through production telemetry.

## 9. Constraints and assumptions

- Public Chrome documentation currently exposes `splitViewId` on tab data, but this does not by itself prove that extensions can create Split View. The capability check during implementation confirmed there is no supported creation API; section 10 records the shipped fallback.
- Publisher canonical metadata is inconsistent. Normalization must remain conservative and preserve multiple candidate URLs when necessary.
- Hacker News can contain multiple submissions for the same article. The top result must be deterministic, while alternatives remain available as a secondary path.
- Manifest V3 service workers can be suspended. The architecture must not assume a permanently running background process.
- Store APIs, action versions, policy questions, and manifest requirements must be checked against current documentation before deployment workflows are adapted.

## 10. Decision log for questions this brief had left open

The MVP implementation resolved most of the questions originally delegated to spikes:

- **Split View creation — resolved.** Chrome 140 documents Split View state (`Tab.splitViewId`, Split View queries and update events) but no extension API that creates Split View. The MVP uses only documented behavior.
- **Fallback — resolved.** The first explicit click opens a normal adjacent tab and the extension remembers it. If the user pairs that tab with the article through native Chrome Split View, later selections reuse the same tab, preserving the browser-managed pane. No iframe or undocumented API is involved in this adjacent-tab flow.
- **Side panel — added after the original brief and later made tab-aware.** Explicit user actions can open the real Hacker News discussion in Chrome's side panel. An independent off-by-default preference can then follow active tabs while that panel remains open, or the user can check one tab without opting in. Session associations prevent stale cross-tab content, and up to three opaque real Hacker News documents may be retained for best-effort return position. The implementation uses a disclosed framing exception lasting from the first live panel connection through the last; the adjacent-tab flow remains the fallback.
- **HN lookup endpoint — resolved.** The public Algolia Hacker News Search API (`https://hn.algolia.com/api/v1/search`) with `tags=story`, `restrictSearchableAttributes=url`, and local exact-identity verification of every hit, under one five-second lookup timeout. No API key, backend, or fallback endpoint is required; the full contract lives in [docs/url-matching.md](url-matching.md).
- **Permission set — resolved.** `tabs`, `activeTab`, `scripting`, `storage`, `contextMenus`, `sidePanel`, and `declarativeNetRequestWithHostAccess`, plus host access to `https://hn.algolia.com/*` and `https://news.ycombinator.com/*`. Each permission is justified per purpose in [PRIVACY.md](../PRIVACY.md).
- **The final public product name and branding — resolved.** The public name is "Split for Hacker News"; "HN Split" stays as the internal working slug. The store listing copy and visual identity are documented in [docs/store-listing.md](store-listing.md).

## 11. Acceptance of this brief

This brief defined the scope boundary for the MVP. Features entered the MVP only when they were required to complete the current-article → explicit-click → Hacker News comments journey reliably, privately, and with automated verification. Everything else belongs in a later roadmap task.
