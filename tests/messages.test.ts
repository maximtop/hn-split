import { describe, expect, it } from 'vitest';

import {
    isAvailabilitySettingReadResponse,
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
        { type: 'set_availability_setting' },
        { type: 'set_availability_setting', enabled: 'yes' },
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
});
