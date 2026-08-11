import { describe, expect, it } from 'vitest';

import {
    SIDE_PANEL_CONTEXT,
    SIDE_PANEL_DISCARD_TAB,
    SIDE_PANEL_KEEPALIVE,
    SIDE_PANEL_READY,
    SIDE_PANEL_RESET,
    SIDE_PANEL_TARGET,
    isArticleClickMessage,
    isAvailabilitySettingReadResponse,
    isAvailabilitySettingResponse,
    isBackgroundRequest,
    isLookupResponse,
    isOpenDiscussionResponse,
    isSidePanelContentResponse,
    isSidePanelPortMessage,
} from '../src/shared/messages';

describe('isBackgroundRequest', () => {
    it.each([
        null,
        {},
        { type: 'lookup' },
        { type: 'lookup', context: null },
        { type: 'lookup', context: { pageUrl: 3, canonicalHref: null } },
        { type: 'lookup', context: { pageUrl: 'https://example.com', canonicalHref: 3 } },
        { type: 'open_discussion' },
        { type: 'open_discussion', articleTabId: -1, itemId: '123' },
        { type: 'open_discussion', articleTabId: 1.5, itemId: '123' },
        { type: 'open_discussion', articleTabId: Number.POSITIVE_INFINITY, itemId: '123' },
        { type: 'open_discussion', articleTabId: Number.MAX_SAFE_INTEGER + 1, itemId: '123' },
        { type: 'open_discussion', articleTabId: 1, itemId: 123 },
        { type: 'open_discussion', articleTabId: 1, itemId: '' },
        { type: 'open_discussion', articleTabId: 1, itemId: '0' },
        { type: 'open_discussion', articleTabId: 1, itemId: String(Number.MAX_SAFE_INTEGER + 1) },
        { type: 'open_discussion', articleTabId: 1, itemId: '12x' },
        { type: 'set_availability_setting' },
        { type: 'set_availability_setting', enabled: 'yes' },
        { type: 'set_article_click_setting' },
        { type: 'set_article_click_setting', enabled: 'yes' },
        { type: 'select_side_panel_discussion', itemId: '123' },
        { type: 'select_side_panel_discussion', tabId: 1, itemId: '123', sourceUrl: 'https://example.com', windowId: -1 },
        { type: 'select_side_panel_discussion', tabId: 1, itemId: '123', sourceUrl: 'https://example.com', windowId: 1.5 },
        { type: 'select_side_panel_discussion', tabId: -1, itemId: '123', sourceUrl: 'https://example.com', windowId: 1 },
        { type: 'select_side_panel_discussion', tabId: 1, itemId: '123', sourceUrl: 42, windowId: 1 },
        { type: 'select_side_panel_discussion', tabId: 1, itemId: '123', windowId: 1 },
        { type: 'check_active_side_panel_tab' },
        { type: 'check_active_side_panel_tab', windowId: -1 },
        { type: 'check_active_side_panel_tab', windowId: 3, tabId: 7 },
        { type: 'enable_side_panel_follow' },
        { type: 'enable_side_panel_follow', windowId: 3, tabId: 7 },
        { type: 'get_side_panel_follow_setting', enabled: true },
        { type: 'set_side_panel_follow_setting' },
        { type: 'set_side_panel_follow_setting', enabled: 'yes' },
        { type: 'get_side_panel_discussion' },
        { type: 'get_side_panel_discussion', windowId: '4' },
        { type: 'open_discussion_for_click', itemId: '123' },
    ])('rejects malformed request %#', (request) => {
        expect(isBackgroundRequest(request)).toBe(false);
    });

    it.each([
        { type: 'lookup', context: { pageUrl: 'https://example.com', canonicalHref: null } },
        { type: 'lookup', context: { pageUrl: 'https://example.com', canonicalHref: 'https://example.com/story' } },
        { type: 'open_discussion', articleTabId: 0, itemId: '1' },
        { type: 'open_discussion', articleTabId: 42, itemId: '123456' },
        { type: 'set_availability_setting', enabled: true },
        { type: 'set_availability_setting', enabled: false },
        { type: 'get_availability_setting' },
        { type: 'set_article_click_setting', enabled: true },
        { type: 'set_article_click_setting', enabled: false },
        { type: 'get_article_click_setting' },
        {
            type: 'select_side_panel_discussion',
            tabId: 0,
            itemId: '123',
            sourceUrl: 'https://example.com/story',
            windowId: 0,
        },
        {
            type: 'select_side_panel_discussion',
            tabId: 7,
            itemId: '123',
            sourceUrl: 'https://example.com/story',
            windowId: 42,
        },
        { type: 'get_side_panel_discussion', windowId: 4 },
        { type: 'check_active_side_panel_tab', windowId: 3 },
        { type: 'enable_side_panel_follow', windowId: 3 },
        { type: 'get_side_panel_follow_setting' },
        { type: 'set_side_panel_follow_setting', enabled: true },
        { type: 'set_side_panel_follow_setting', enabled: false },
    ])('accepts valid request %#', (request) => {
        expect(isBackgroundRequest(request)).toBe(true);
    });
});

describe('isSidePanelPortMessage', () => {
    it.each([
        { type: SIDE_PANEL_CONTEXT, windowId: 3 },
        { type: SIDE_PANEL_KEEPALIVE },
        { type: SIDE_PANEL_READY, tabId: 7, projectionRevision: 4 },
        { type: SIDE_PANEL_TARGET, tabId: 8, minimumProjectionRevision: 5 },
        { type: SIDE_PANEL_DISCARD_TAB, tabId: 7 },
        { type: SIDE_PANEL_RESET },
    ])('accepts valid port message %#', (message) => {
        expect(isSidePanelPortMessage(message)).toBe(true);
    });

    it.each([
        null,
        {},
        { type: 'unknown' },
        { type: SIDE_PANEL_CONTEXT },
        { type: SIDE_PANEL_CONTEXT, windowId: -1 },
        { type: SIDE_PANEL_CONTEXT, windowId: 3, url: 'https://example.com' },
        { type: SIDE_PANEL_KEEPALIVE, tabId: 7 },
        { type: SIDE_PANEL_READY },
        { type: SIDE_PANEL_READY, tabId: 7, projectionRevision: 0 },
        { type: SIDE_PANEL_READY, tabId: 1.5, projectionRevision: 4 },
        { type: SIDE_PANEL_READY, tabId: 7, projectionRevision: Number.MAX_SAFE_INTEGER + 1 },
        { type: SIDE_PANEL_TARGET, tabId: 8, minimumProjectionRevision: 0 },
        { type: SIDE_PANEL_TARGET, tabId: Number.POSITIVE_INFINITY, minimumProjectionRevision: 5 },
        { type: SIDE_PANEL_DISCARD_TAB, tabId: -1 },
        { type: SIDE_PANEL_DISCARD_TAB, tabId: 7, itemId: '424242' },
        { type: SIDE_PANEL_RESET, reason: 'reconnect' },
    ])('rejects malformed port message %#', (message) => {
        expect(isSidePanelPortMessage(message)).toBe(false);
    });
});

describe('isArticleClickMessage', () => {
    it.each([
        null,
        {},
        { type: 'open_discussion_for_click' },
        { type: 'open_discussion_for_click', itemId: 123 },
        { type: 'open_discussion_for_click', itemId: '123' },
        { type: 'open_discussion_for_click', itemId: '123', articleUrl: 42 },
        { type: 'open_discussion_for_click', itemId: '123', articleUrl: 'not a URL' },
        {
            type: 'open_discussion_for_click',
            itemId: '123',
            articleUrl: 'https://example.com/story',
            unexpected: true,
        },
        { type: 'open_discussion_for_click', itemId: '' },
        { type: 'open_discussion_for_click', itemId: '0' },
        { type: 'open_discussion_for_click', itemId: '12x' },
        { type: 'open_discussion_for_click', itemId: String(Number.MAX_SAFE_INTEGER + 1) },
        { type: 'open_discussion', articleTabId: 1, itemId: '123' },
        { type: 'lookup', context: { pageUrl: 'https://example.com', canonicalHref: null } },
    ])('rejects non-click or malformed message %#', (message) => {
        expect(isArticleClickMessage(message)).toBe(false);
    });

    it.each([
        { type: 'open_discussion_for_click', itemId: '1', articleUrl: 'https://example.com/a' },
        {
            type: 'open_discussion_for_click',
            itemId: '424242',
            articleUrl: 'http://news.example.org/story',
        },
    ])('accepts valid click message %#', (message) => {
        expect(isArticleClickMessage(message)).toBe(true);
    });
});

describe('background response validation', () => {
    const discussion = {
        id: '123',
        title: 'Discussion',
        articleUrl: 'https://example.com/story',
        comments: 4,
        points: 5,
        createdAt: 6,
    };

    it('accepts complete lookup and open responses', () => {
        expect(isLookupResponse({
            ok: true,
            result: { status: 'found', primary: discussion, alternatives: [] },
        })).toBe(true);
        expect(isOpenDiscussionResponse({
            ok: true,
            result: { mode: 'adjacent_tab', tabId: 7 },
        })).toBe(true);
    });

    it.each([
        { ok: true, result: { status: 'found', primary: { ...discussion, id: '0' }, alternatives: [] } },
        { ok: true, result: { status: 'found', primary: { ...discussion, comments: -1 }, alternatives: [] } },
        { ok: true, result: { status: 'found', primary: discussion, alternatives: [{}] } },
        { ok: true, result: { status: 'unknown' } },
        { ok: true },
    ])('rejects malformed successful lookup response %#', (response) => {
        expect(isLookupResponse(response)).toBe(false);
    });

    it.each([
        { ok: true, result: { mode: 'unknown', tabId: 7 } },
        { ok: true, result: { mode: 'adjacent_tab', tabId: -1 } },
        { ok: true, result: { mode: 'adjacent_tab', tabId: 1.5 } },
        { ok: true, result: { mode: 'adjacent_tab', tabId: Number.MAX_SAFE_INTEGER + 1 } },
        { ok: true },
    ])('rejects malformed successful open response %#', (response) => {
        expect(isOpenDiscussionResponse(response)).toBe(false);
    });

    it('accepts stable error codes for popup operations', () => {
        expect(isLookupResponse({ ok: false, error: 'lookup_request_failed' })).toBe(true);
        expect(isOpenDiscussionResponse({ ok: false, error: 'open_discussion_failed' })).toBe(true);
    });

    it('rejects error responses carrying arbitrary text instead of a stable code', () => {
        expect(isLookupResponse({ ok: false, error: 'Unexpected extension error' })).toBe(false);
        expect(isOpenDiscussionResponse({ ok: false, error: 'No tab with id: 42' })).toBe(false);
    });

    it.each([
        undefined,
        { ok: true },
        { ok: true, result: { enabled: 'yes' } },
        { ok: true, result: { status: 'updated' } },
        { ok: false, error: 'failed' },
    ])('rejects malformed or unsuccessful availability response %#', (response) => {
        expect(isAvailabilitySettingResponse(response)).toBe(false);
    });

    it('accepts authoritative availability-setting responses', () => {
        expect(isAvailabilitySettingResponse({ ok: true, result: { enabled: true } })).toBe(true);
        expect(isAvailabilitySettingReadResponse({ ok: true, result: { enabled: false } })).toBe(true);
        expect(isAvailabilitySettingReadResponse({ ok: true, result: { enabled: 'yes' } })).toBe(false);
        expect(isAvailabilitySettingReadResponse({ ok: false, error: 'failed' })).toBe(false);
    });

    it.each([
        { ok: true, result: { content: null } },
        { ok: true, result: { content: { kind: 'discussion', tabId: 7, itemId: '424242' } } },
        { ok: true, result: { content: { kind: 'pending', tabId: 7 } } },
        { ok: true, result: { content: { kind: 'unavailable', tabId: 7, reason: 'not_found' } } },
        { ok: false, error: 'side_panel_selection_failed' },
    ])('accepts side panel content response %#', (response) => {
        expect(isSidePanelContentResponse(response)).toBe(true);
    });

    it.each([
        undefined,
        { ok: true },
        // The bare item id this response carried before panel states existed.
        { ok: true, result: { itemId: '424242' } },
        { ok: true, result: { content: '424242' } },
        { ok: true, result: { content: { kind: 'discussion' } } },
        { ok: true, result: { content: { kind: 'pending' } } },
        { ok: true, result: { content: { kind: 'unavailable', reason: 'found' } } },
    ])('rejects malformed side panel content response %#', (response) => {
        expect(isSidePanelContentResponse(response)).toBe(false);
    });
});
