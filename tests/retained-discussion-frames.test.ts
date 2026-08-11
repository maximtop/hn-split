import { describe, expect, it } from 'vitest';

import {
    EMPTY_RETAINED_DISCUSSION_FRAMES,
    MAX_RETAINED_DISCUSSION_FRAMES,
    activateDiscussionFrame,
    discardDiscussionFramesForTab,
    discussionFrameKey,
} from '../src/side-panel/retained-discussion-frames';
import type {
    DiscussionFrameSelection,
    RetainedDiscussionFrameState,
} from '../src/side-panel/retained-discussion-frames';

const A: DiscussionFrameSelection = { tabId: 1, itemId: '101' };
const B: DiscussionFrameSelection = { tabId: 2, itemId: '202' };
const C: DiscussionFrameSelection = { tabId: 3, itemId: '303' };
const D: DiscussionFrameSelection = { tabId: 4, itemId: '404' };

describe('retained discussion frames', () => {
    it('uses the tab and item tuple as the frame identity', () => {
        expect(discussionFrameKey(A)).toBe('1:101');
        expect(discussionFrameKey({ tabId: 2, itemId: A.itemId })).toBe('2:101');
    });

    it('reactivates an exact frame without changing insertion order', () => {
        const withA = activateDiscussionFrame(EMPTY_RETAINED_DISCUSSION_FRAMES, A);
        const withAB = activateDiscussionFrame(withA, B);
        const backToA = activateDiscussionFrame(withAB, A);

        expect(backToA.frames.map(({ key }) => key)).toEqual(['1:101', '2:202']);
        expect(backToA.activeKey).toBe('1:101');
        expect(backToA.frames[0]?.lastUsed).toBeGreaterThan(
            backToA.frames[1]?.lastUsed ?? 0,
        );
        expect(withAB.frames.map(({ lastUsed }) => lastUsed)).toEqual([1, 2]);
    });

    it('replaces the prior item for the same tab', () => {
        const withA = activateDiscussionFrame(EMPTY_RETAINED_DISCUSSION_FRAMES, A);
        const replaced = activateDiscussionFrame(withA, { tabId: A.tabId, itemId: '999' });

        expect(replaced.frames.map(({ key }) => key)).toEqual(['1:999']);
        expect(replaced.activeKey).toBe('1:999');
    });

    it('keeps separate contexts when two tabs show the same item', () => {
        const sameItemInTwoTabs = [
            A,
            { tabId: B.tabId, itemId: A.itemId },
        ].reduce<RetainedDiscussionFrameState>(
            (state, selection) => activateDiscussionFrame(state, selection),
            EMPTY_RETAINED_DISCUSSION_FRAMES,
        );

        expect(sameItemInTwoTabs.frames.map(({ key }) => key)).toEqual(['1:101', '2:101']);
    });

    it('evicts the least recently used inactive context at the cap', () => {
        const withABC = [A, B, C].reduce<RetainedDiscussionFrameState>(
            (state, selection) => activateDiscussionFrame(state, selection),
            EMPTY_RETAINED_DISCUSSION_FRAMES,
        );
        const withABCA = activateDiscussionFrame(withABC, A);
        const withACD = activateDiscussionFrame(withABCA, D);

        expect(withACD.frames).toHaveLength(MAX_RETAINED_DISCUSSION_FRAMES);
        expect(withACD.frames.map(({ key }) => key)).toEqual(['1:101', '3:303', '4:404']);
        expect(withACD.activeKey).toBe('4:404');
        expect(withABCA.frames.map(({ key }) => key)).toEqual(['1:101', '2:202', '3:303']);
    });

    it('retains only the latest three contexts after four new activations', () => {
        const four = [A, B, C, D].reduce<RetainedDiscussionFrameState>(
            (state, selection) => activateDiscussionFrame(state, selection),
            EMPTY_RETAINED_DISCUSSION_FRAMES,
        );

        expect(four.frames.map(({ key }) => key)).toEqual(['2:202', '3:303', '4:404']);
    });

    it('discards only frames for the requested tab', () => {
        const four = [A, B, C, D].reduce<RetainedDiscussionFrameState>(
            (state, selection) => activateDiscussionFrame(state, selection),
            EMPTY_RETAINED_DISCUSSION_FRAMES,
        );
        const withoutC = discardDiscussionFramesForTab(four, C.tabId);

        expect(withoutC.frames.map(({ key }) => key)).toEqual(['2:202', '4:404']);
        expect(withoutC.activeKey).toBe('4:404');
        expect(withoutC.nextUse).toBe(four.nextUse);
        expect(four.frames.map(({ key }) => key)).toEqual(['2:202', '3:303', '4:404']);
    });

    it('clears the active key when its tab is discarded', () => {
        const withA = activateDiscussionFrame(EMPTY_RETAINED_DISCUSSION_FRAMES, A);

        expect(discardDiscussionFramesForTab(withA, A.tabId)).toEqual({
            frames: [],
            activeKey: null,
            nextUse: withA.nextUse,
        });
    });
});
