import type { OpenDiscussionResult } from '../browser/openDiscussion';
import { isHnLookupResult } from '../domain/hn';
import type { HnLookupResult } from '../domain/hn';
import type { PageContext } from '../page/context';

export interface LookupRequest {
    type: 'lookup';
    context: PageContext;
}

export interface OpenDiscussionRequest {
    type: 'open_discussion';
    articleTabId: number;
    itemId: string;
}

export interface AvailabilitySettingChangedRequest {
    type: 'availability_setting_changed';
    enabled: boolean;
}

export type BackgroundRequest = LookupRequest | OpenDiscussionRequest | AvailabilitySettingChangedRequest;

export interface AvailabilitySettingResult {
    status: 'updated';
}

export type BackgroundResponse =
    | { ok: true; result: HnLookupResult | OpenDiscussionResult | AvailabilitySettingResult }
    | { ok: false; error: string };

export function isAvailabilitySettingResponse(
    value: unknown,
): value is { ok: true; result: AvailabilitySettingResult } {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const response = value as Record<string, unknown>;
    if (response.ok !== true || typeof response.result !== 'object' || response.result === null) {
        return false;
    }
    return (response.result as Record<string, unknown>).status === 'updated';
}

function isErrorResponse(value: unknown): value is { ok: false; error: string } {
    return typeof value === 'object'
        && value !== null
        && (value as Record<string, unknown>).ok === false
        && typeof (value as Record<string, unknown>).error === 'string';
}

export function isLookupResponse(
    value: unknown,
): value is { ok: true; result: HnLookupResult } | { ok: false; error: string } {
    if (isErrorResponse(value)) {
        return true;
    }
    return typeof value === 'object'
        && value !== null
        && (value as Record<string, unknown>).ok === true
        && isHnLookupResult((value as Record<string, unknown>).result);
}

export function isOpenDiscussionResponse(
    value: unknown,
): value is { ok: true; result: OpenDiscussionResult } | { ok: false; error: string } {
    if (isErrorResponse(value)) {
        return true;
    }
    if (typeof value !== 'object' || value === null
        || (value as Record<string, unknown>).ok !== true) {
        return false;
    }
    const result = (value as Record<string, unknown>).result;
    if (typeof result !== 'object' || result === null) {
        return false;
    }
    const record = result as Record<string, unknown>;
    return ['adjacent_tab', 'reused_tab', 'split_view'].includes(String(record.mode))
        && typeof record.tabId === 'number'
        && Number.isSafeInteger(record.tabId)
        && record.tabId >= 0;
}

export function isBackgroundRequest(value: unknown): value is BackgroundRequest {
    if (typeof value !== 'object' || value === null || !('type' in value)) {
        return false;
    }
    const request = value as Record<string, unknown>;
    if (request.type === 'lookup') {
        if (typeof request.context !== 'object' || request.context === null) {
            return false;
        }
        const context = request.context as Record<string, unknown>;
        return typeof context.pageUrl === 'string'
            && (typeof context.canonicalHref === 'string' || context.canonicalHref === null);
    }
    if (request.type === 'availability_setting_changed') {
        return typeof request.enabled === 'boolean';
    }
    if (request.type !== 'open_discussion'
        || typeof request.articleTabId !== 'number'
        || !Number.isSafeInteger(request.articleTabId)
        || request.articleTabId < 0
        || typeof request.itemId !== 'string'
        || !/^\d+$/.test(request.itemId)) {
        return false;
    }
    const itemId = Number(request.itemId);
    return Number.isSafeInteger(itemId) && itemId > 0;
}
