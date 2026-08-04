# Lifecycle after tab close or navigation

- **Status:** Approved decision record
- **Scope:** what happens to the article-to-discussion pairing and to the side panel selection when either tab closes or navigates, when the panel changes, and when the browser session ends or restores.

## Principles

These rules bound every row of the matrices below:

1. **Act only inside a click, only on extension-created state.** Between explicit user actions the extension observes; it never closes, moves, or navigates a user tab on its own, and it never clears content someone may still be reading.
2. **Never recreate a closed tab.** A tab the user closed stays closed; only the next explicit comments click may open a new one.
3. **Staleness is resolved lazily at the click.** Stored state is validated against the browser's live answer (`tabs.get`) at the moment it is consulted, not tracked with navigation listeners. No listener watches tab URLs.
4. **A repurposed tab is the user's tab again.** Reuse must never navigate a tab that stopped serving as the discussion pane. A tab still on Hacker News keeps the role; a native Chrome Split View pairing with the article is the user's standing request to keep the pane regardless of where they navigated it.
5. **Session-only state is a feature.** Associations and the panel selection live in `chrome.storage.session` and die with the browser session. Persisting them would require re-matching restored tabs by URL, which is retained browsing history and contradicts privacy by architecture.
6. **Eager cleanup applies only to extension-owned resources** — the association keyed by a closed article tab, the side panel framing exception, and impossible states such as a lookup left `pending` by a stopped worker.

## Flow A — discussion tab (popup click, adjacent tab or native Split View)

The pairing is **tab-scoped, not article-scoped**: the discussion tab is "this reading tab's companion pane". The association `articleTabId → discussionTabId` lives in session storage and changes the world only when the user clicks the comments action.

| Event | Stored association | Tabs | What the user sees |
| --- | --- | --- | --- |
| Article tab closed | Discarded (`tabs.onRemoved`) | Discussion tab untouched | Nothing moves; the comments tab lives on as an ordinary tab |
| Discussion tab closed | Entry goes stale; discarded on the next click when `tabs.get` fails | Never recreated automatically | Nothing until the next click, which opens a fresh adjacent tab |
| Article tab navigates (any URL, Back/Forward) | Preserved | None now | The next click swaps the same companion pane to the new discussion; a hand-built Split View pair survives, since Chrome has no API to recreate one |
| Discussion tab navigates within Hacker News | Preserved | None now | The next click reuses the pane |
| Discussion tab navigates off Hacker News | Discarded at the next click, unless the tab is in a native Split View with the article | The repurposed tab is left alone; the click opens a fresh adjacent tab | A tab taken over for something else is never yanked back to Hacker News |
| Discussion tab moved to another window | Discarded at the next click | The click opens a fresh adjacent tab in the article's window | Focus never jumps to another window |
| Window or session close and restore | Gone with session storage (tab IDs change anyway) | Restored tabs are ordinary tabs | The first click after a restore behaves like a first click |
| Comments click | Reuse when the remembered tab is alive, in the same window, and still the pane (rules above); otherwise discard and create one adjacent tab | Opens per click are serialized per article tab | One companion pane per reading tab; no duplicate discussions |

## Flow B — side panel

The panel is an **independent reading surface the user summoned**; it is not bound to the tab that filled it. "Open the discussion, close the article, finish the comments" is a supported pattern, so tab lifecycle never clears the panel.

| Event | Stored selection | What the user sees |
| --- | --- | --- |
| Originating tab closed or navigated | Preserved | The panel keeps the discussion until the user replaces or closes it |
| Panel switched to another extension or closed (indistinguishable: both are a port disconnect) | Preserved; only the framing exception is released | Reopening the panel shows the same discussion |
| Worker stopped mid-lookup | `pending` normalized to `unavailable` on worker start | Never an infinite spinner |
| Session close and restore | Gone with session storage | The panel opens in its default empty state |
| New selection (story click, Open in Split, popup) | Replaced — the newest explicit action wins, even over an in-flight lookup | The panel always shows the most recent request |

## Rejected alternatives

- **Unconditional tab reuse (place-only predicate).** Simplest, but a click could navigate a tab the user repurposed (for example moved to their mail) back to Hacker News — the least understandable automatic transition in the design. Rejected for click-time URL validation with the Split View exception. Accepted cost: after the user follows the article link inside the comments pane, the next click opens a new adjacent tab instead of reusing that pane.
- **Eager detach via `tabs.onUpdated` URL watching.** Same observable behavior as click-time validation, but adds suspension-fragile listeners and surveillance of every navigation. Rejected.
- **Eager reverse cleanup when the discussion tab closes.** Tab IDs are unique within a browser session, so a stale entry can never resolve to the wrong tab; lazy validation at the click is equivalent and simpler. Rejected.
- **Clearing or annotating the panel when its originating tab closes.** Destroys or clutters a surface the user may still be reading, and requires binding panel content to a tab ID that session restore invalidates. Rejected; revisit only if alpha feedback shows confusion.
- **Persisting associations or the panel selection across restarts.** Requires re-matching by URL, that is retained history. Rejected.

## Known follow-up

The panel selection is global across windows, so a selection made in one window replaces what another window's panel is showing. The agreed target model keys the selection by `windowId`; this is tracked as its own task and does not change the rules above.

## Verification

- Reuse, replacement, repurposed-tab detach, the Split View exception, and per-click serialization: [tests/open-discussion.test.ts](../tests/open-discussion.test.ts).
- The Hacker News origin predicate: [tests/hn.test.ts](../tests/hn.test.ts).
- Newest-selection-wins and the `pending` normalization: [tests/side-panel-content-manager.test.ts](../tests/side-panel-content-manager.test.ts).
- Association cleanup on article-tab close and the framing exception's lifetime are wired in [src/background.ts](../src/background.ts); the framing lifetime is covered by [tests/side-panel-framing.test.ts](../tests/side-panel-framing.test.ts).
