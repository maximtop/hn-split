import { describe, expect, it } from 'vitest';

import { HN_LOOKUP_STATUS } from '../src/domain/hn';
import {
    SIDE_PANEL_ASSOCIATION_ORIGIN,
    isSidePanelAssociation,
} from '../src/shared/side-panel-association';
import { SIDE_PANEL_CONTENT_KIND } from '../src/shared/side-panel-content';
import {
    sidePanelAssociationKey,
    sidePanelAssociationTabId,
} from '../src/shared/storage-keys';

const TAB_ID = 7;
const WINDOW_ID = 3;
const ITEM_ID = '424242';

describe('isSidePanelAssociation', () => {
    it('accepts reusable discussion and unavailable outcomes', () => {
        expect(isSidePanelAssociation({
            tabId: TAB_ID,
            windowId: WINDOW_ID,
            origin: SIDE_PANEL_ASSOCIATION_ORIGIN.EXPLICIT,
            outcome: { kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION, itemId: ITEM_ID },
            articleIdentity: 'example.com/story',
        })).toBe(true);
        expect(isSidePanelAssociation({
            tabId: TAB_ID,
            windowId: WINDOW_ID,
            origin: SIDE_PANEL_ASSOCIATION_ORIGIN.MANUAL,
            outcome: {
                kind: SIDE_PANEL_CONTENT_KIND.UNAVAILABLE,
                reason: HN_LOOKUP_STATUS.NOT_FOUND,
            },
            articleIdentity: null,
        })).toBe(true);
        expect(isSidePanelAssociation({
            tabId: TAB_ID,
            windowId: WINDOW_ID,
            origin: SIDE_PANEL_ASSOCIATION_ORIGIN.AUTOMATIC,
            outcome: {
                kind: SIDE_PANEL_CONTENT_KIND.UNAVAILABLE,
                reason: HN_LOOKUP_STATUS.RESTRICTED,
            },
            articleIdentity: null,
        })).toBe(true);
    });

    it.each([
        {
            name: 'recoverable error',
            value: {
                tabId: TAB_ID,
                windowId: WINDOW_ID,
                origin: SIDE_PANEL_ASSOCIATION_ORIGIN.MANUAL,
                outcome: {
                    kind: SIDE_PANEL_CONTENT_KIND.UNAVAILABLE,
                    reason: HN_LOOKUP_STATUS.ERROR,
                },
                articleIdentity: null,
            },
        },
        {
            name: 'raw URL identity',
            value: {
                tabId: TAB_ID,
                windowId: WINDOW_ID,
                origin: SIDE_PANEL_ASSOCIATION_ORIGIN.AUTOMATIC,
                outcome: { kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION, itemId: ITEM_ID },
                articleIdentity: 'https://example.com/story',
            },
        },
        {
            name: 'tracking identity',
            value: {
                tabId: TAB_ID,
                windowId: WINDOW_ID,
                origin: SIDE_PANEL_ASSOCIATION_ORIGIN.AUTOMATIC,
                outcome: { kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION, itemId: ITEM_ID },
                articleIdentity: 'example.com/story?utm_source=test',
            },
        },
        {
            name: 'extra raw field',
            value: {
                tabId: TAB_ID,
                windowId: WINDOW_ID,
                origin: SIDE_PANEL_ASSOCIATION_ORIGIN.EXPLICIT,
                outcome: { kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION, itemId: ITEM_ID },
                articleIdentity: null,
                rawUrl: 'https://example.com/story',
            },
        },
        {
            name: 'unsafe tab ownership',
            value: {
                tabId: Number.MAX_SAFE_INTEGER + 1,
                windowId: WINDOW_ID,
                origin: SIDE_PANEL_ASSOCIATION_ORIGIN.EXPLICIT,
                outcome: { kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION, itemId: ITEM_ID },
                articleIdentity: null,
            },
        },
        {
            name: 'negative window ownership',
            value: {
                tabId: TAB_ID,
                windowId: -1,
                origin: SIDE_PANEL_ASSOCIATION_ORIGIN.EXPLICIT,
                outcome: { kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION, itemId: ITEM_ID },
                articleIdentity: null,
            },
        },
        {
            name: 'unknown origin',
            value: {
                tabId: TAB_ID,
                windowId: WINDOW_ID,
                origin: 'restored',
                outcome: { kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION, itemId: ITEM_ID },
                articleIdentity: null,
            },
        },
        {
            name: 'extra nested outcome field',
            value: {
                tabId: TAB_ID,
                windowId: WINDOW_ID,
                origin: SIDE_PANEL_ASSOCIATION_ORIGIN.EXPLICIT,
                outcome: {
                    kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION,
                    itemId: ITEM_ID,
                    title: 'Private title',
                },
                articleIdentity: null,
            },
        },
    ])('rejects $name', ({ value }) => {
        expect(isSidePanelAssociation(value)).toBe(false);
    });
});

describe('side panel association storage keys', () => {
    it('round trips safe tab identifiers and rejects malformed suffixes', () => {
        expect(sidePanelAssociationTabId(sidePanelAssociationKey(TAB_ID))).toBe(TAB_ID);
        expect(sidePanelAssociationTabId('side_panel_tab:-1')).toBeNull();
        expect(sidePanelAssociationTabId('side_panel_tab:')).toBeNull();
        expect(sidePanelAssociationTabId('side_panel_tab:7x')).toBeNull();
        expect(sidePanelAssociationTabId(`side_panel_tab:${Number.MAX_SAFE_INTEGER}0`)).toBeNull();
        expect(sidePanelAssociationTabId('another:7')).toBeNull();
    });
});
