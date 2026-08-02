# HN Split MVP Product Brief

- **Status:** Approved working brief
- **Working name:** HN Split
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
- A private alpha before public store submission.

### Release work after the Chrome MVP stabilizes

- Firefox Add-ons adaptation and submission.
- Microsoft Edge Add-ons adaptation and submission.
- Safari Web Extension wrapper and App Store submission.
- Extension UI and store listings for 40 priority locales.

These are part of the project roadmap but are not allowed to delay proving the Chrome MVP interaction.

## 6. Explicit non-goals for the MVP

- Reddit, Lobsters, or any discussion source other than Hacker News.
- Automatically opening comments when an article loads.
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

HN Split may detect availability in the background necessary for the current page, but it must not open or rearrange content until the user explicitly clicks.

### Privacy by architecture

The extension should request the narrowest viable permissions, avoid broad browsing-history access, retain only short-lived lookup data needed for responsiveness, and send no telemetry.

### One simple answer first

For one article, show one primary discussion. If duplicate submissions exist, rank them deterministically and keep alternatives secondary rather than forcing a choice on every click.

### Browser truth over product wish

The Split View experience must follow documented, tested browser capabilities. If Chrome does not expose a supported creation API, ship the honest fallback instead of relying on an undocumented call or an iframe workaround.

### Public services are dependencies, not guarantees

HN lookup must have bounded timeouts, explicit errors, conservative caching, and no paid or secret API dependency.

## 8. Success criteria

The MVP is ready for private alpha when all of the following are true:

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

- Public Chrome documentation currently exposes `splitViewId` on tab data, but this does not by itself prove that extensions can create Split View. A technical spike must decide the behavior.
- Publisher canonical metadata is inconsistent. Normalization must remain conservative and preserve multiple candidate URLs when necessary.
- Hacker News can contain multiple submissions for the same article. The top result must be deterministic, while alternatives remain available as a secondary path.
- Manifest V3 service workers can be suspended. The architecture must not assume a permanently running background process.
- Store APIs, action versions, policy questions, and manifest requirements must be checked against current documentation before deployment workflows are adapted.

## 10. Open decisions delegated to planned spikes

- Whether Chrome exposes a supported extension API for creating or changing Split View.
- The exact adjacent-tab or native-action fallback if it does not.
- The final public product name and branding.
- The final HN lookup endpoint combination after reliability tests.
- The exact permission set after architecture validation.

## 11. Acceptance of this brief

This brief is the scope boundary for the MVP. A feature enters the MVP only if it is required to complete the current-article → explicit-click → Hacker News comments journey reliably, privately, and with automated verification. Everything else belongs in a later roadmap task.
