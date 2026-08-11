/**
 * Limits the number of live Hacker News documents retained by one panel.
 */
export const MAX_RETAINED_DISCUSSION_FRAMES = 3;

/**
 * Describes one live discussion context retained by the side panel.
 */
export interface RetainedDiscussionFrame {
    /**
     * Identifies the browser tab that owns the context.
     */
    tabId: number;
    /**
     * Identifies the concrete Hacker News discussion loaded by the context.
     */
    itemId: string;
    /**
     * Provides the stable React and DOM identity for the tab/item tuple.
     */
    key: string;
    /**
     * Records the monotonic access order used for least-recently-used eviction.
     */
    lastUsed: number;
}

/**
 * Identifies the discussion context that should become active.
 */
export interface DiscussionFrameSelection {
    /**
     * Identifies the browser tab that owns the selected discussion.
     */
    tabId: number;
    /**
     * Identifies the concrete Hacker News discussion for the selected tab.
     */
    itemId: string;
}

/**
 * Holds the ordered retained contexts and their independent access recency.
 */
export interface RetainedDiscussionFrameState {
    /**
     * Keeps contexts in stable insertion and render order.
     */
    frames: RetainedDiscussionFrame[];
    /**
     * Identifies the sole context that should be visible, or none.
     */
    activeKey: string | null;
    /**
     * Supplies the next monotonic access sequence value.
     */
    nextUse: number;
}

/**
 * Provides the initial state for a panel with no live discussion contexts.
 */
export const EMPTY_RETAINED_DISCUSSION_FRAMES: RetainedDiscussionFrameState = {
    frames: [],
    activeKey: null,
    nextUse: 0,
};

/**
 * Builds the stable identity for one tab-scoped discussion context.
 * @param selection - The browser tab and concrete Hacker News item tuple.
 */
export function discussionFrameKey(selection: DiscussionFrameSelection): string {
    return `${selection.tabId}:${selection.itemId}`;
}

/**
 * Activates an exact retained context or appends a new context after enforcing
 * the per-tab replacement rule and least-recently-used capacity bound.
 * @param state - The current retained-context state.
 * @param selection - The browser tab and discussion that should become active.
 */
export function activateDiscussionFrame(
    state: RetainedDiscussionFrameState,
    selection: DiscussionFrameSelection,
): RetainedDiscussionFrameState {
    const key = discussionFrameKey(selection);
    const nextUse = state.nextUse + 1;
    const existing = state.frames.find((frame) => frame.key === key);

    if (existing !== undefined) {
        return {
            frames: state.frames.map((frame) => (
                frame.key === key ? { ...frame, lastUsed: nextUse } : frame
            )),
            activeKey: key,
            nextUse,
        };
    }

    let frames = state.frames.filter((frame) => frame.tabId !== selection.tabId);
    if (frames.length >= MAX_RETAINED_DISCUSSION_FRAMES) {
        const oldest = frames.reduce((candidate, frame) => (
            frame.lastUsed < candidate.lastUsed ? frame : candidate
        ));
        frames = frames.filter((frame) => frame.key !== oldest.key);
    }

    return {
        frames: [...frames, { ...selection, key, lastUsed: nextUse }],
        activeKey: key,
        nextUse,
    };
}

/**
 * Removes every retained discussion context owned by one browser tab.
 * @param state - The current retained-context state.
 * @param tabId - The browser tab whose contexts must be discarded.
 */
export function discardDiscussionFramesForTab(
    state: RetainedDiscussionFrameState,
    tabId: number,
): RetainedDiscussionFrameState {
    const frames = state.frames.filter((frame) => frame.tabId !== tabId);

    return {
        ...state,
        frames,
        activeKey: frames.some((frame) => frame.key === state.activeKey)
            ? state.activeKey
            : null,
    };
}
