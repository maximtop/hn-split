# Lifecycle after tab close or navigation

- **Status:** Approved decision record
- **Scope:** what happens to the article-to-discussion pairing and to the side panel selection when either tab closes or navigates, when the panel changes, and when the browser session ends or restores.

## Principles

These rules bound every row of the matrices below:

1. **A user action grants the capability; it does not surrender tab control.** The extension never opens the side panel, closes, moves, replaces, or rearranges tabs automatically. An explicitly enabled follow preference may update only the contents of an already-open panel as the active tab changes.
2. **Never recreate a closed tab.** A tab the user closed stays closed; only the next explicit comments click may open a new one.
3. **Observe only at the boundary that needs it.** Adjacent discussion-tab reuse is still validated lazily at the next click. Side-panel activation and navigation listeners do work only for a window with a live panel, and URL acquisition for a fresh tab requires either the follow opt-in or a one-shot manual or explicit action.
4. **A repurposed tab is the user's tab again.** Reuse must never navigate a tab that stopped serving as the discussion pane. A tab still on Hacker News keeps the role; a native Chrome Split View pairing with the article is the user's standing request to keep the pane regardless of where they navigated it.
5. **Session-only state is a feature.** Discussion-tab pairings, side-panel projections, tab-owned terminal outcomes, sanitized article identity, and lookup results live in `chrome.storage.session` and die with the browser session. The follow preference alone is persistent and remains separate from the toolbar-badge preference.
6. **Eager cleanup applies only to extension-owned resources.** Closed, replaced, moved, or differently navigated tabs lose invalid associations and retained frames; a framing disconnect discards all live frames; orphaned transient state fails closed. Disabling follow cancels automatic work but preserves already displayed valid terminal content.

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

The global side panel remains a surface the user must summon, but its content is **owned by the authoritative tab in that window**. A validated tab association records only a terminal discussion, not-found, or restricted outcome plus its window, origin, and optional sanitized article identity. Pending, manual-required, and recoverable-error states are projections, never reusable associations.

The projection is scoped per window and revisioned in session storage, matching Chrome's one-panel-per-window model. Activating a new target hides the old frame immediately, before lookup or storage work can finish. Newer activation, navigation, manual, or explicit intent supersedes older work; a concrete explicit selection remains authoritative through its expected navigation.

| Event | Session state | What the user sees |
| --- | --- | --- |
| Fresh active tab, follow off | No URL is acquired and no association is created | The prior tab is hidden; **Check this tab** and **Follow tabs automatically** are offered as alternative one-click actions |
| **Check this tab** | The tab active at trusted action time gets one reusable terminal association if the check succeeds | Pending, then discussion, not found, restricted, or a recoverable error; both automatic preferences remain unchanged |
| **Follow tabs automatically** | The independent local preference is enabled and the tab active at trusted action time is synchronized | The current tab resolves in the same action; no settings visit or second confirmation is required |
| Activate an unchanged associated tab | Its valid terminal association is reused without URL acquisition or network lookup | The saved discussion, not-found, or restricted outcome returns immediately |
| Activate an unchecked tab with follow on | The newest target may reuse the URL cache or run one lookup | The old frame is hidden immediately, then pending and the current tab's terminal result |
| Same-identity reload or navigation | The association and retained frame stay valid; an ordinary reload without a new URL needs no URL read when follow is off | The same discussion context remains visible when the browser kept it alive |
| Different article identity, tab close/replacement/move, or ownership mismatch | The old association and that tab's retained frame are discarded | Stale content cannot return; the current consent mode decides the next state |
| Disable follow | Unfinished automatic intent is superseded; valid associations, frames, and the shared lookup cache remain | Current terminal content stays; a later fresh tab shows the manual choices |
| Popup, Hacker News story click, or **Open in Split** | The explicit result is tab- and window-owned and may resolve regardless of follow | The newest valid explicit result wins without changing the preference |
| One of overlapping panel ports disconnects | All live frames are discarded, but the window remains live while another port exists | A fresh readiness handshake follows; stored valid associations may be projected again |
| Last panel port disconnects | Automatic work stops and the framing exception is removed; terminal session associations remain | No panel work runs while the surface is closed; reopening starts with no preserved live position |
| Worker stops with transient state | Orphaned transient state fails closed and may be re-evaluated | Never an infinite spinner or stale discussion |
| Window closes | Its projection and invalid window-owned associations are removed | Nothing — the surface itself is gone |
| Browser session ends or the extension reloads/updates | Session associations, projections, lookup cache, and frames are not promised | The next applicable lifecycle initializes fresh |

### Retained Hacker News documents

While framing is ready, the panel may keep up to three recent real Hacker News documents alive, keyed by browser tab and item. Exactly one can be visible, focusable, or exposed to accessibility APIs. Returning to an unevicted context reuses the same browser-managed document and usually its scroll position; adding a fourth removes the least recently used inactive context. Same-tab item replacement, invalidation, panel teardown or reload, framing reconnect, extension reload/update, and browser memory pressure can reset it. Extension code never reads, serializes, or restores cross-origin Hacker News content, focus, cookies, or scroll offsets.

## Rejected alternatives

- **Unconditional tab reuse (place-only predicate).** Simplest, but a click could navigate a tab the user repurposed (for example moved to their mail) back to Hacker News — the least understandable automatic transition in the design. Rejected for click-time URL validation with the Split View exception. Accepted cost: after the user follows the article link inside the comments pane, the next click opens a new adjacent tab instead of reusing that pane.
- **Watching every tab regardless of panel and consent.** Rejected. Side-panel listeners are inert without a live panel, and a fresh tab's URL is not acquired for following until the user checks once or enables the separate follow preference.
- **Eager reverse cleanup when the discussion tab closes.** Tab IDs are unique within a browser session, so a stale entry can never resolve to the wrong tab; lazy validation at the click is equivalent and simpler. Rejected.
- **Keeping a closed or differently navigated tab's discussion visible.** Rejected because it misrepresents the active page. The invalid association and retained frame are removed, while valid associations for other unchanged tabs remain reusable for the session.
- **Persisting associations or live frame state across restarts.** Requires retained browsing identity or cross-origin state. Rejected; only the boolean follow preference persists.
- **A single global panel selection.** The original MVP shape: simple, but a click in one window silently replaced what another window's panel was showing — the one real least-surprise violation in the design. Retired in favor of per-window keys.

## Verification

- Reuse, replacement, repurposed-tab detach, the Split View exception, and per-click serialization: [tests/open-discussion.test.ts](../tests/open-discussion.test.ts).
- The Hacker News origin predicate: [tests/hn.test.ts](../tests/hn.test.ts).
- Consent, newest-intent-wins behavior, identity preservation/invalidation, explicit precedence, and opt-out: [tests/side-panel-content-manager.test.ts](../tests/side-panel-content-manager.test.ts).
- Per-window routing and lifecycle isolation: [tests/side-panel-content-router.test.ts](../tests/side-panel-content-router.test.ts) and [tests/side-panel-lifecycle-controller.test.ts](../tests/side-panel-lifecycle-controller.test.ts).
- One-shot and persistent follow commands: [tests/side-panel-follow-controller.test.ts](../tests/side-panel-follow-controller.test.ts).
- Session association validation and cleanup: [tests/side-panel-association-store.test.ts](../tests/side-panel-association-store.test.ts).
- Overlapping port lifetime and readiness ordering: [tests/side-panel-window-registry.test.ts](../tests/side-panel-window-registry.test.ts) and [tests/side-panel-port-controller.test.ts](../tests/side-panel-port-controller.test.ts).
- Three-entry stable frame retention: [tests/retained-discussion-frames.test.ts](../tests/retained-discussion-frames.test.ts) and [tests/side-panel.test.tsx](../tests/side-panel.test.tsx).
- Framing lifetime and reconnect reset: [tests/side-panel-framing.test.ts](../tests/side-panel-framing.test.ts).
