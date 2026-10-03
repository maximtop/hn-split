# Native Chrome Split View experiment

This draft implements [MT-1298](https://app.notion.com/p/3e203d5910528109b65dc97fe6eab0bc).
It does not replace the existing discussion-tab or side-panel flows.

## API contract checked on 2026-10-03

The official [Chrome Tabs API reference](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-createSplit)
documents `chrome.tabs.createSplit([articleTabId, discussionTabId])` from Chrome 155.
It returns the Split View ID. Both tabs must be adjacent, unsplit, and have matching
window, pinned, and group states. The same reference documents `tabs.create`'s
`splitWithTabId` option from Chrome 155, but this experiment uses `createSplit` so
an unsuccessful pairing leaves the already-created discussion available.

The existing `splitViewId` tab field dates to Chrome 140; that field alone does
not establish that an extension can create a native split. The implementation
checks for the actual `createSplit` function and enables the experiment only in
the Chrome package. No new permissions or minimum Chrome version are added;
Chrome's Tabs API permissions guidance does not list an additional permission
for pairing tabs. The pinned `@types/chrome` package lacks `createSplit`, so a
narrow local interface declares the documented signature instead of upgrading
unrelated dependencies.

The published API has no documented split-ratio/width setter. This experiment
leaves proportions to Chrome's UI. Initial proportions and manual resizing
remain unverified.

## Behavior

- In the Chrome popup, **Try native Split View (experimental)** is unchecked on
  every popup open. Enable it, then select the primary or an alternative discussion.
- The extension opens or reuses exactly that discussion and attempts to pair it
  with the article. It rechecks both tabs' current placement before calling Chrome.
- Incompatible tabs stay in their existing layout. The extension does not move,
  pin, regroup, or dissolve existing splits. Pinned or grouped articles normally
  fall back because newly created discussion tabs have different states.
- Missing APIs and rejected pairing leave one adjacent or reused discussion tab.
  A native API failure records a privacy-safe diagnostic without error or page data.
- Existing article-to-discussion associations and native pair reuse remain intact.
  Side-panel opening, HN story-click handling, and the link context menu keep their
  existing behavior. Edge and Firefox do not invoke the experimental API.
- The two experiment strings use temporary English copy in every locale; existing
  translations are preserved. Localization review is required before release.

## Evidence and remaining validation

The installed Google Chrome app bundle reports **154.0.8037.93**, read from
`CFBundleShortVersionString` without starting or controlling the browser. This is
below the documented API floor. API availability in a running Chrome 155+ worker
has not been measured locally.

Local `pnpm check` passed: lint, TypeScript, locale/store validation, 960 tests,
and the Chrome development build. Edge/Firefox development builds and local
release packaging for all three targets also passed. E2E test collection succeeded
without launching a browser. Independent review found no actionable correctness
issues; its suggested cross-browser and rejected-API coverage was added.

Unit/integration coverage exercises popup opt-in, the requested item identity,
new and reused native pairs, missing API, rejected API, closed tabs, incompatible
placement, and preserving unrelated splits. The popup E2E scenario additionally
covers the opt-in fallback with a rejecting browser API fixture. These fixtures
verify extension behavior; they do not prove native UI rendering.

The full local `pnpm verify` includes launching Chromium. Local browser use was
not authorized, so only its CLI checks are run locally; the repository's existing
GitHub CI runs the browser suite in its own runner.

Before deciding whether to replace any fallback, obtain permission for local
browser QA and use an unpacked experimental build on Chrome 155+:

1. Open an ordinary unpinned, ungrouped article with multiple known HN submissions.
   Enable the experiment and select an alternative. Confirm article and exactly
   that HN item appear together, including correct left/right placement.
2. Reopen the popup on the article and select another item. Confirm the discussion
   pane is reused and no additional discussion tab appears.
3. Verify the initial panel proportions, resize with Chrome's divider, and check
   whether Chrome retains proportions when the discussion is reused.
4. Repeat on a pinned/grouped article and an article already paired with another
   tab. Confirm existing layouts remain intact and a discussion tab is available.
5. Test unsupported Chrome and the side-panel action; confirm their existing flows.

The experiment is a candidate for explicit popup selections only. The side panel
supports other workflows (tab following and HN story-click gestures) that are not
replaced here. A wholesale fallback replacement is premature until native UI and
these workflow differences have been evaluated.
