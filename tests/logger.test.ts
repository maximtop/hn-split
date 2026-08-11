import { afterEach, describe, expect, it, vi } from 'vitest';

import { EXTENSION_BRAND } from '../src/shared/brand';
import {
    FOLLOW_DIAGNOSTIC_CODE,
    FOLLOW_DIAGNOSTIC_EVENT,
    logDiagnostic,
    logDiagnosticWarning,
    logFollowWarning,
} from '../src/shared/logger';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('logDiagnostic', () => {
    it('renders structured context inline instead of passing a collapsible object', () => {
        const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

        logDiagnostic('test event.', {
            windowId: 5,
            kind: 'discussion',
        });

        expect(info).toHaveBeenCalledWith(
            `${EXTENSION_BRAND}: test event. {"windowId":5,"kind":"discussion"}`,
        );
        expect(info.mock.calls[0]).toHaveLength(1);
    });

    it('keeps entries without context as one readable string', () => {
        const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

        logDiagnostic('test event.');

        expect(info).toHaveBeenCalledWith(`${EXTENSION_BRAND}: test event.`);
    });
});

describe('logDiagnosticWarning', () => {
    it('rebuilds runtime details from its identifier allow-list', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const unsafe = {
            code: FOLLOW_DIAGNOSTIC_CODE.LOOKUP_FAILED,
            tabId: 7,
            windowId: 3,
            url: 'https://secret.example/private',
            query: 'private query',
            title: 'private title',
            identity: 'secret.example/private',
            itemId: '424242',
            error: new Error('private error'),
        };

        logDiagnosticWarning(FOLLOW_DIAGNOSTIC_EVENT.LOOKUP_FAILED, unsafe);

        expect(warn).toHaveBeenCalledWith(
            `${EXTENSION_BRAND}: ${FOLLOW_DIAGNOSTIC_EVENT.LOOKUP_FAILED} `
            + `{"code":"${FOLLOW_DIAGNOSTIC_CODE.LOOKUP_FAILED}","tabId":7,"windowId":3}`,
        );
        const entry = String(warn.mock.calls[0]?.[0]);
        expect(entry).not.toContain('secret');
        expect(entry).not.toContain('private');
        expect(entry).not.toContain(ITEM_SENTINEL);
    });

    it('rejects unknown runtime event, code, and unsafe identifiers', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        logDiagnosticWarning(
            'the URL-bearing caught error' as typeof FOLLOW_DIAGNOSTIC_EVENT.LOOKUP_FAILED,
            {
                code: 'unknown_code' as typeof FOLLOW_DIAGNOSTIC_CODE.LOOKUP_FAILED,
                tabId: Number.MAX_SAFE_INTEGER + 1,
                relatedTabId: Number.NaN,
                windowId: Number.POSITIVE_INFINITY,
            },
        );

        expect(warn).toHaveBeenCalledExactlyOnceWith(
            `${EXTENSION_BRAND}: ${FOLLOW_DIAGNOSTIC_EVENT.REJECTED} `
            + `{"code":"${FOLLOW_DIAGNOSTIC_CODE.REJECTED}"}`,
        );
    });

    it('maps a typed warning code to its exhaustive stable event', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        logFollowWarning(FOLLOW_DIAGNOSTIC_CODE.ASSOCIATION_WRITE_FAILED, {
            tabId: 7,
            windowId: 3,
        });

        expect(warn).toHaveBeenCalledWith(
            `${EXTENSION_BRAND}: ${FOLLOW_DIAGNOSTIC_EVENT.ASSOCIATION_WRITE_FAILED} `
            + `{"code":"${FOLLOW_DIAGNOSTIC_CODE.ASSOCIATION_WRITE_FAILED}","tabId":7,"windowId":3}`,
        );
    });

    it('rejects arbitrary details and messages at compile time', () => {
        const compileTimeAssertions = (): void => {
            // @ts-expect-error Follow diagnostics cannot contain a URL.
            logDiagnosticWarning(FOLLOW_DIAGNOSTIC_EVENT.LOOKUP_FAILED, { url: 'https://secret.example' });
            // @ts-expect-error Caught error messages are not stable diagnostic events.
            logDiagnosticWarning(new Error('secret').message, {
                code: FOLLOW_DIAGNOSTIC_CODE.LOOKUP_FAILED,
            });
            // @ts-expect-error Follow warning codes are a closed union.
            logFollowWarning('unknown_code', {});
        };
        expect(compileTimeAssertions).toBeTypeOf('function');
    });
});

const ITEM_SENTINEL = '424242';
