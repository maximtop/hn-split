# Public copy audit and publication handoff

Checked September 20, 2026 for [MT-997](https://www.notion.so/3b803d5910528124899dd3cfba0d80be).
This is a review and publication handoff, not a record of external publication.

## Publication progress

The English repository copy was merged in [PR #35](https://github.com/maximtop/hn-split/pull/35)
and the landing copy in [website PR #8](https://github.com/maximtop/maximtop.dev/pull/8).
The website deployed automatically; the overview, privacy, FAQ, support, and
side-by-side guide were checked over HTTP after deployment.

All 39 non-English listing sources now include the corresponding trust,
network, storage, and framing disclosures. All 40 listings pass the structural
and store-length validation. The localized additions received an author
semantic review, not an independent or native-speaker review; see
[the locale review record](locales.md#store-listing-network-and-framing-review).

On September 21, the 29 production-supported AMO descriptions and the product
homepage were published through the authenticated metadata API. Public readback
confirmed all translated text, seven Firefox feature bullets and four trust
links per locale; version 0.1.2 and its artifact were unchanged. The other 11
source locales use the English listing because AMO production does not accept
them. See [the locale inventory](locales.md#store-locale-mappings-and-fallbacks).

Chrome and Edge publication, the Chrome Store homepage field, the GitHub
social-preview upload, and a real article/discussion first visual remain
unverified. Chrome and Edge require their publisher dashboards for description
updates. Browser access returned `Not allowed` on September 21; no Chrome or
Edge changes were submitted. No binary release was performed.

## Evidence and discrepancies

| Surface | Observed state | Prepared correction / remaining action |
| --- | --- | --- |
| README | Install CTA and support link work; MIT and unofficial wording was separated from the promise; framing summary omitted profile-wide scope | Lead with free/open source/unofficial; add trust links, external network destinations, manual Split View pairing, browser scope, full framing scope |
| Chrome Store | Public listing is 0.1.1, updated August 11; omits open source, own-backend clarification, and follow/retention bullet | Use the English description below after approval; the v0.1.1 tag already includes following and retained discussions, so this is a listing omission, not a promised new feature |
| Store homepage | No developer homepage link to maximtop.dev appears in the fetched public listing | Set/verify the exact homepage below in the publisher dashboard; public HTML cannot verify domain ownership or dashboard state |
| Store privacy | Public policy points to GitHub PRIVACY.md; Web history, User activity, Website content are displayed | Keep those disclosures aligned with the permission table and policy; no live fields changed |
| Landing overview | Chrome/Edge/Firefox CTAs, free/open source/no telemetry, source/privacy/support links exist | Add missing follow setting and complete network/framing disclosures; replace blanket claims that Chrome has no Split View API with actual extension behavior |
| Landing FAQ | Claimed only Chrome is a supported public release despite Edge/Firefox install CTAs | Describe Firefox Sidebar and omitted story-click/Split View features; keep the walkthrough explicitly Chrome-specific |
| Landing privacy | Only two settings documented; embedded cookies equated with normal tabs; CSP consequence omitted | Document all three settings, one-shot check, session TTLs, retained documents, cookie-policy dependence, and full header-rule scope |
| Options | Current English privacy_note, side_panel_notice, and three settings match the code and v0.1.1 tag | Existing text retained; it describes profile-wide subframes and last-panel removal. Full policy supplies exact header names, CSP consequence, network/storage details |
| Policy | “Sends nothing off the device” in story-click explanation and absolute “no personally identifiable data” statement were too broad | Distinguish local click handling from page requests; explain that eligible public URLs need not be anonymous |
| First visual | README and landing show a popup result list, not an article and real HN discussion side by side | Recheck the previously completed acceptance item; capture a real article → selected thread pair before declaring the visual criterion complete |
| Social preview | Local marquee exists (1400×560), and depicts an illustrative split browser | Upload to GitHub social preview separately; repository setting was not changed or verified here |

The current source base is `4cc6163` (version 0.1.2). Release tag `v0.1.1`
(`67dde27`) contains `side-panel-follow-controller.ts`, retained frames, and
all three options. Public Chrome HTML still reports 0.1.1; the
[Mozilla API](https://addons.mozilla.org/api/v5/addons/addon/split-for-hacker-news/)
reports Firefox 0.1.2. The Edge URL resolves and identifies the product, but
its HTTP page does not expose enough listing content to verify a version or
full description. Do not infer binary parity from these version numbers.

## Behavior and permission evidence

| Claim | Code / artifact evidence |
| --- | --- |
| Free, open source, unofficial | MIT LICENSE and public repository; no payment or extension-account flow; independent branding in shared/brand.ts |
| No developer-operated backend or telemetry | Production lookup in src/domain/hn.ts calls hn.algolia.com/api/v1/search directly; framed discussions load news.ycombinator.com; no telemetry client or developer endpoint in production source |
| URL lookup, no article body | src/page/context.ts reads location.href and canonical link; src/domain/url.ts sanitizes and rejects restricted candidates; src/domain/hn.ts verifies normalized identity of returned URLs |
| Explicit opening, manual Split View | src/browser/open-discussion.ts opens/reuses a concrete HN item tab; src/shared/browser-target.ts opens the panel/sidebar; no native Split View creation |
| Local preferences and session state | src/background/chrome-adapters.ts stores three booleans locally, lookup/tab/panel state in session storage; src/browser/lookup-cache.ts uses one-hour found and ten-minute not-found TTLs |
| Temporary framing exception | src/background/side-panel-framing.ts removes X-Frame-Options and both CSP headers for HN subframes; src/background/side-panel-port-controller.ts owns live connection lifetime |
| Real HN documents | src/side-panel/retained-discussion-frames.ts and side-panel-app.tsx retain at most three frames, without reading cross-origin DOM/cookies/scroll |
| Chrome permission inventory | public/manifest.json: activeTab, contextMenus, declarativeNetRequestWithHostAccess, scripting, sidePanel, storage, tabs; host access only Algolia and HN |
| Browser differences | scripts/lib/browser-manifest.ts: Chrome/Edge MV3 panel, Firefox 140+ Sidebar; src/shared/browser-target.ts and options view omit Firefox story-click support; no Safari target |

The [current Chrome tabs reference](https://developer.chrome.com/docs/extensions/reference/api/tabs)
includes `createSplit` and `splitWithTabId` marked **Pending**. Public copy
therefore describes what this extension does, rather than claiming such APIs
cannot exist. Chrome's [Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
requires a user interaction for the open operation.

## Final text and destinations

### Shared promise

> Find the Hacker News discussion for the article you are reading, then choose a thread to read beside it. Free, open source (MIT), and unofficial. No telemetry, extension account, or developer-operated backend. Lookups send eligible sanitized public URLs to Algolia; opened discussions connect to Hacker News.

### Chrome Web Store

Name and short summary stay unchanged in the manifest catalog. The complete
paste-ready detailed description is the **Full description** in
[store-listing.md](store-listing.md), mirrored in
[assets/store-listings/en.json](../assets/store-listings/en.json). Generate it
with `pnpm store:render chrome en`. This wording applies to Chrome 0.1.1 as
well as current source; Chrome 140 or newer is required by both manifests.
The permission answers remain in the store master and full policy.

| Field / link label | Exact destination |
| --- | --- |
| Add to Chrome / Install | https://chromewebstore.google.com/detail/split-for-hacker-news/jmocibcalpebojmljmhlkeackggnkhfm |
| Homepage | https://maximtop.dev/extensions/split-for-hacker-news/ |
| Source | https://github.com/maximtop/hn-split |
| Privacy policy | https://github.com/maximtop/hn-split/blob/master/PRIVACY.md |
| Support | https://github.com/maximtop/hn-split/issues |
| Privacy contact | me@maximtop.dev |

### Landing overview, FAQ, privacy, and support

Final replacement copy is prepared in [maximtop.dev PR #8](https://github.com/maximtop/maximtop.dev/pull/8), under
`src/pages/extensions/split-for-hacker-news/`. Keep the existing install CTA,
source, policy, and support destinations. The overview and FAQ use the shared
promise; the privacy page explains Algolia versus HN requests, all three
settings, session retention, and profile-wide framing. Support explains the
Chrome workflow and Firefox limitations. The side-by-side guide describes
manual native Split View pairing without the obsolete blanket API claim.

### Options disclosures

Keep the existing localized options text. The English copy already says:

> Automatic toolbar checks and side-panel following are off by default. When either is enabled, eligible, sanitized public tab URLs may be sent to Algolia for lookup. These automatic checks do not read article text or other page content. Side-panel following only updates a Split for Hacker News panel that is already open.

> Hacker News blocks embedding with response headers. While at least one Split for Hacker News side panel is open, the extension temporarily removes those headers from Hacker News sub-frame responses and removes the exception after the last panel closes. Because Chrome cannot limit this rule to one extension frame, it applies to any Hacker News sub-frame in this browser profile during that time. Each panel may keep up to three recent discussions alive in memory for faster return; only one is shown at a time. The extension cannot read their content or scroll position.

These are copied from `public/_locales/en/messages.json`; this change does not
alter extension UI strings or permissions.

## Link and document validation

- Plain HTTP GET confirmed Chrome install, GitHub source, policy, and Issues URLs return 200.
- curl GET confirmed the landing overview, privacy, and support pages return 200; Python urllib received 403 for the latter two, so a failed single client is not treated as a broken page.
- The live landing HTML contains the Chrome install, source, policy, and support destinations.
- GitHub API confirms repository About homepage still points to the Chrome Store and the project topics are present. No GitHub settings were changed.
- HN Split `pnpm check` passed: lint, type checking, 40 runtime catalogs / store listing validation, 815 tests, and production build.
- After local browser permission was granted, `pnpm verify` ran with a temporary Chromium profile: the non-browser checks passed and 17/18 E2E tests passed, including accessibility. The story-click test timed out at `tests/e2e/article-click.e2e.ts:142` with an undefined panel selection instead of item 424242. A focused retry and the same test against unchanged master (`4cc6163`) reproduced the timeout; this is a baseline failure, not a passing verification. An initial sandboxed attempt could not launch Chromium.
- Local Playwright checks of all six generated landing pages passed at 390px and 1440px viewport widths with no horizontal overflow; all requests were restricted to localhost.
- Landing `npm run build` passed (30 pages). All six generated HN-cluster pages passed local-link/anchor and image checks, JSON-LD parsing, one main heading, and shared source/privacy/support-link checks; no structural source-text tests added.

## Publication gates

1. Resolve or assess the baseline story-click E2E failure, then review and merge the two PRs separately; no automatic merge or site publication is part of this handoff.
2. Translate and review the new English listing claims in the other 39 locales before publishing those updates. Existing `reviewed` flags certify the earlier revision, not this new copy. Runtime options translations were not changed.
3. Publish the approved landing copy and update the approved Store description, homepage, support and policy fields; check the resulting live pages and actual installed package.
4. Upload the GitHub social preview separately and verify it. Capture a real article/discussion first visual; the current popup-only screenshot does not prove that criterion.
5. Keep MT-997 In Progress until the external actions and all acceptance criteria are verified.
