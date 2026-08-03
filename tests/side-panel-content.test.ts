import { describe, expect, it } from 'vitest';

import { HN_LOOKUP_ERROR_REASON, HN_LOOKUP_STATUS } from '../src/domain/hn';
import type { HnLookupResult } from '../src/domain/hn';
import {
    SIDE_PANEL_CONTENT_KIND,
    contentForLookupResult,
    isSidePanelContent,
} from '../src/shared/side-panel-content';

const ITEM_ID = '424242';

const discussion = {
    id: ITEM_ID,
    title: 'Primary discussion',
    articleUrl: 'https://example.com/story',
    comments: 10,
    points: 20,
    createdAt: 1,
};

describe('isSidePanelContent', () => {
    it.each([
        { name: 'a discussion', value: { kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION, itemId: ITEM_ID } },
        { name: 'a pending lookup', value: { kind: SIDE_PANEL_CONTENT_KIND.PENDING } },
        {
            name: 'an unavailable discussion',
            value: { kind: SIDE_PANEL_CONTENT_KIND.UNAVAILABLE, reason: HN_LOOKUP_STATUS.NOT_FOUND },
        },
    ])('accepts $name', ({ value }) => {
        expect(isSidePanelContent(value)).toBe(true);
    });

    it.each([
        // Session storage survives a reload of the extension itself only as
        // long as the browser session lasts, but a stale value must still read
        // as an empty panel rather than as content.
        { name: 'the bare item id used before this model existed', value: ITEM_ID },
        { name: 'an unknown kind', value: { kind: 'loading' } },
        {
            name: 'an unavailable reason that is not a lookup outcome',
            value: { kind: SIDE_PANEL_CONTENT_KIND.UNAVAILABLE, reason: HN_LOOKUP_STATUS.FOUND },
        },
        { name: 'an unavailable state with no reason', value: { kind: SIDE_PANEL_CONTENT_KIND.UNAVAILABLE } },
        { name: 'a non-positive item id', value: { kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION, itemId: '0' } },
        { name: 'a non-numeric item id', value: { kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION, itemId: '12x' } },
        { name: 'a numeric item id', value: { kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION, itemId: 42 } },
        { name: 'null', value: null },
        { name: 'an empty object', value: {} },
    ])('rejects $name', ({ value }) => {
        expect(isSidePanelContent(value)).toBe(false);
    });
});

describe('contentForLookupResult', () => {
    it('shows the highest ranked discussion when one was found', () => {
        const result: HnLookupResult = {
            status: HN_LOOKUP_STATUS.FOUND,
            primary: discussion,
            alternatives: [{ ...discussion, id: '999' }],
        };

        expect(contentForLookupResult(result)).toEqual({
            kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION,
            itemId: ITEM_ID,
        });
    });

    it.each([
        { result: { status: HN_LOOKUP_STATUS.NOT_FOUND }, reason: HN_LOOKUP_STATUS.NOT_FOUND },
        { result: { status: HN_LOOKUP_STATUS.RESTRICTED }, reason: HN_LOOKUP_STATUS.RESTRICTED },
        {
            result: { status: HN_LOOKUP_STATUS.ERROR, reason: HN_LOOKUP_ERROR_REASON.LOOKUP_FAILED },
            reason: HN_LOOKUP_STATUS.ERROR,
        },
        {
            // Both classified failures collapse: which one occurred is a
            // diagnostic detail the reader cannot act on.
            result: { status: HN_LOOKUP_STATUS.ERROR, reason: HN_LOOKUP_ERROR_REASON.INVALID_RESPONSE },
            reason: HN_LOOKUP_STATUS.ERROR,
        },
    ])('reports $reason when the lookup returns $result.status', ({ result, reason }) => {
        expect(contentForLookupResult(result as HnLookupResult)).toEqual({
            kind: SIDE_PANEL_CONTENT_KIND.UNAVAILABLE,
            reason,
        });
    });
});
