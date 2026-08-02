import { describe, expect, it } from 'vitest';

import {
    isAvailabilitySettingResponse,
    isBackgroundRequest,
    isLookupResponse,
    isOpenDiscussionResponse,
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
        { type: 'availability_setting_changed' },
        { type: 'availability_setting_changed', enabled: 'yes' },
    ])('rejects malformed request %#', (request) => {
        expect(isBackgroundRequest(request)).toBe(false);
    });

    it.each([
        { type: 'lookup', context: { pageUrl: 'https://example.com', canonicalHref: null } },
        { type: 'lookup', context: { pageUrl: 'https://example.com', canonicalHref: 'https://example.com/story' } },
        { type: 'open_discussion', articleTabId: 0, itemId: '1' },
        { type: 'open_discussion', articleTabId: 42, itemId: '123456' },
        { type: 'availability_setting_changed', enabled: true },
        { type: 'availability_setting_changed', enabled: false },
    ])('accepts valid request %#', (request) => {
        expect(isBackgroundRequest(request)).toBe(true);
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

    it('accepts well-formed errors for popup operations', () => {
        expect(isLookupResponse({ ok: false, error: 'failed' })).toBe(true);
        expect(isOpenDiscussionResponse({ ok: false, error: 'failed' })).toBe(true);
    });

    it.each([
        undefined,
        { ok: true },
        { ok: true, result: { status: 'wrong' } },
        { ok: false, error: 'failed' },
    ])('rejects malformed or unsuccessful availability response %#', (response) => {
        expect(isAvailabilitySettingResponse(response)).toBe(false);
    });
});
