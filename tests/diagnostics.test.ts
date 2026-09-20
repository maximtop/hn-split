import { afterEach, describe, expect, it, vi } from 'vitest';

import { DiagnosticLog } from '../src/browser/diagnostic-log';
import type { DiagnosticStorage } from '../src/browser/diagnostic-log';
import { createDiagnosticHandler } from '../src/background/diagnostic-handler';
import {
    DIAGNOSTIC_ERROR, DIAGNOSTIC_FORMAT_VERSION, DIAGNOSTIC_LEVEL, DIAGNOSTIC_LIMIT,
    DIAGNOSTIC_SOURCE, diagnosticBytes, normalizeDiagnostic,
} from '../src/shared/diagnostics';
import type { DiagnosticBuffer, DiagnosticEvent } from '../src/shared/diagnostics';
import { DIAGNOSTIC_EVENT, FOLLOW_DIAGNOSTIC_CODE } from '../src/shared/diagnostic-events';
import { DIAGNOSTIC_REQUEST, installDiagnosticTransport } from '../src/shared/diagnostic-protocol';
import {
    logDiagnostic, logFollowWarning, logWarning, setDiagnosticSink,
} from '../src/shared/logger';
import { formatDiagnosticExport } from '../src/shared/diagnostic-export';

const event: DiagnosticEvent = {
    level: DIAGNOSTIC_LEVEL.INFO,
    message: DIAGNOSTIC_EVENT.FRAMING_READY,
    details: { tabId: 1 },
};
const empty = (): DiagnosticBuffer => ({ formatVersion: DIAGNOSTIC_FORMAT_VERSION, entries: [] });

function memoryStorage(initial?: unknown): DiagnosticStorage & { value: unknown } {
    return {
        value: initial,
        async read() { return structuredClone(this.value); },
        async write(buffer) { this.value = structuredClone(buffer); },
        async clear() { this.value = undefined; },
    };
}

afterEach(() => {
    setDiagnosticSink(undefined);
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('diagnostic privacy boundary', () => {
    it('retains only catalog messages, scalar identifiers and stable error categories', () => {
        const secret = 'https://secret.example/?token=credential';
        const error = new TypeError(secret);
        error.name = secret;
        const result = normalizeDiagnostic(DIAGNOSTIC_LEVEL.WARNING, DIAGNOSTIC_EVENT.POPUP_LOOKUP_FAILED, [
            { tabId: 2, windowId: 3, url: secret, cookie: secret, title: secret, content: secret, candidates: [secret], headers: secret },
            error,
        ]);
        expect(result?.details).toEqual({ tabId: 2, windowId: 3, errorCategory: DIAGNOSTIC_ERROR.TYPE });
        expect(JSON.stringify(result)).not.toContain(secret);
        expect(normalizeDiagnostic(DIAGNOSTIC_LEVEL.WARNING, secret, [error])).toBeNull();
        expect(normalizeDiagnostic(DIAGNOSTIC_LEVEL.INFO, event.message, [{ tabId: secret, revision: Infinity }])?.details).toEqual({});
    });

    it('keeps console output and feeds all existing logger entry points without content-script collection', async () => {
        const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const sink = vi.fn(async () => undefined);
        logDiagnostic(event.message, { tabId: 1 });
        expect(sink).not.toHaveBeenCalled();
        setDiagnosticSink(sink);
        logDiagnostic(event.message, { tabId: 1 });
        logWarning(DIAGNOSTIC_EVENT.POPUP_LOOKUP_FAILED, new Error('secret'));
        logFollowWarning(FOLLOW_DIAGNOSTIC_CODE.LOOKUP_FAILED, { windowId: 3 });
        await Promise.resolve();
        expect(sink).toHaveBeenCalledTimes(3);
        expect(info).toHaveBeenCalledTimes(2);
        expect(warn).toHaveBeenCalledTimes(2);
        expect(JSON.stringify(sink.mock.calls)).not.toContain('secret');
    });

    it('contains synchronous and asynchronous sink failures without recursive collection', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        vi.spyOn(console, 'info').mockImplementation(() => undefined);
        const sink = vi.fn(() => {
            throw new Error('private payload');
        });
        setDiagnosticSink(sink);
        expect(() => logDiagnostic(event.message)).not.toThrow();
        expect(sink).toHaveBeenCalledTimes(1);
        const reject = vi.fn(async () => {
            throw new Error('private payload');
        });
        setDiagnosticSink(reject);
        logDiagnostic(event.message);
        await Promise.resolve();
        expect(reject).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledTimes(2);
        expect(JSON.stringify(warn.mock.calls)).not.toContain('private payload');
    });
});

describe('background session collector', () => {
    it('serializes concurrent appends without losing entries and restores across worker instances', async () => {
        const storage = memoryStorage();
        const log = new DiagnosticLog(storage);
        await Promise.all(Array.from({ length: 30 }, (_, tabId) => log.append({ ...event, details: { tabId } }, DIAGNOSTIC_SOURCE.BACKGROUND)));
        const restored = new DiagnosticLog(storage);
        expect((await restored.snapshot()).entries.map((entry) => entry.details.tabId)).toEqual(Array.from({ length: 30 }, (_, i) => i));
        expect((await new DiagnosticLog(memoryStorage()).snapshot()).entries).toEqual([]);
    });

    it('evicts oldest entries at the production count cap', async () => {
        const log = new DiagnosticLog(memoryStorage());
        for (let tabId = 0; tabId <= DIAGNOSTIC_LIMIT.ENTRIES; tabId += 1) {
            await log.append({ ...event, details: { tabId } }, DIAGNOSTIC_SOURCE.BACKGROUND);
        }
        const buffer = await log.snapshot();
        expect(buffer.entries).toHaveLength(DIAGNOSTIC_LIMIT.ENTRIES);
        expect(buffer.entries[0]?.details.tabId).toBe(1);
        expect(diagnosticBytes(buffer)).toBeLessThanOrEqual(DIAGNOSTIC_LIMIT.BYTES);
    });

    it('independently applies serialized byte eviction', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-20T12:34:56Z'));
        const sample = { ...empty(), entries: [{ ...event, source: DIAGNOSTIC_SOURCE.BACKGROUND, timestamp: new Date().toISOString() }] };
        const cap = diagnosticBytes(sample);
        const log = new DiagnosticLog(memoryStorage(), { entries: 10, bytes: cap });
        await log.append(event, DIAGNOSTIC_SOURCE.BACKGROUND);
        await log.append({ ...event, details: { tabId: 2 } }, DIAGNOSTIC_SOURCE.BACKGROUND);
        const buffer = await log.snapshot();
        expect(buffer.entries.map((entry) => entry.details.tabId)).toEqual([2]);
        expect(diagnosticBytes(buffer)).toBeLessThanOrEqual(cap);
    });

    it('bounds queued appends while storage is busy and resumes after the queue drains', async () => {
        const storage = memoryStorage();
        let release!: (value: undefined) => void;
        const blocked = new Promise<undefined>((resolve) => {
            release = resolve;
        });
        vi.spyOn(storage, 'read').mockReturnValueOnce(blocked);
        const log = new DiagnosticLog(storage, { entries: 1, bytes: DIAGNOSTIC_LIMIT.BYTES });
        const pending = Array.from({ length: DIAGNOSTIC_LIMIT.PENDING }, () => log.append(event, DIAGNOSTIC_SOURCE.BACKGROUND));
        await expect(log.append(event, DIAGNOSTIC_SOURCE.BACKGROUND)).rejects.toThrow('Diagnostic queue full');
        release(undefined);
        await Promise.all(pending);
        await log.clear();
        await log.append(event, DIAGNOSTIC_SOURCE.BACKGROUND);
        expect((await log.snapshot()).entries).toHaveLength(1);
    });

    it('orders clear between earlier and later appends and never clears unrelated data', async () => {
        const storage = memoryStorage();
        const log = new DiagnosticLog(storage);
        const first = log.append(event, DIAGNOSTIC_SOURCE.POPUP);
        const clear = log.clear();
        const next = log.append({ ...event, details: { tabId: 2 } }, DIAGNOSTIC_SOURCE.OPTIONS);
        await Promise.all([first, clear, next]);
        expect((await log.snapshot()).entries.map((entry) => entry.details.tabId)).toEqual([2]);
        await log.clear();
        expect(storage.value).toBeUndefined();
    });

    it.each([
        { entries: 'malformed' },
        { ...empty(), entries: [{ ...event, source: DIAGNOSTIC_SOURCE.POPUP, timestamp: new Date().toISOString(), url: 'secret' }] },
    ])('drops malformed storage without exporting unsafe fields', async (initial) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const storage = memoryStorage(initial);
        const log = new DiagnosticLog(storage);
        expect(await log.snapshot()).toEqual(empty());
        expect(storage.value).toBeUndefined();
        await log.append(event, DIAGNOSTIC_SOURCE.BACKGROUND);
        expect((await log.snapshot()).entries).toHaveLength(1);
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it.each(['read', 'write', 'clear'] as const)('recovers the queue after a failed %s', async (method) => {
        const storage = memoryStorage();
        const log = new DiagnosticLog(storage);
        const spy = vi.spyOn(storage, method).mockRejectedValueOnce(new Error('storage failure'));
        const attempt = method === 'clear' ? log.clear() : log.append(event, DIAGNOSTIC_SOURCE.BACKGROUND);
        await expect(attempt).rejects.toThrow('storage failure');
        spy.mockRestore();
        await log.append(event, DIAGNOSTIC_SOURCE.BACKGROUND);
        expect((await log.snapshot()).entries).toHaveLength(1);
    });
});

describe('runtime ownership and export', () => {
    const runtime = { id: 'extension-id', getURL: (path: string) => `chrome-extension://extension-id/${path}` };
    const sender = (path: string): chrome.runtime.MessageSender => ({ id: runtime.id, url: runtime.getURL(path) });

    it('collects UI contexts through the facade into one background writer and exports a safe versioned snapshot', async () => {
        vi.spyOn(console, 'info').mockImplementation(() => undefined);
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-20T12:34:56Z'));
        const log = new DiagnosticLog(memoryStorage());
        const handle = createDiagnosticHandler(log, runtime);
        for (const path of ['popup.html', 'options.html', 'side-panel.html']) {
            installDiagnosticTransport(async (request) => handle(request, sender(path)));
            logDiagnostic(event.message, { tabId: 2, url: 'secret' });
        }
        // The snapshot is queued behind all three incoming appends.
        const response = await handle({ type: DIAGNOSTIC_REQUEST.SNAPSHOT }, sender('options.html'));
        expect(response?.ok).toBe(true);
        if (!response?.ok || !response.buffer) throw new Error('Missing buffer');
        expect(response.buffer.entries.map((entry) => entry.source)).toEqual([
            DIAGNOSTIC_SOURCE.POPUP, DIAGNOSTIC_SOURCE.OPTIONS, DIAGNOSTIC_SOURCE.SIDE_PANEL,
        ]);
        const file = formatDiagnosticExport(response.buffer, '0.1.2', new Date());
        expect(file.filename).toBe('20260920_123456_hn_split_v0.1.2.txt');
        const lines = file.text.trim().split('\n').map((line) => JSON.parse(line));
        expect(lines[0]).toEqual({ formatVersion: DIAGNOSTIC_FORMAT_VERSION, extensionVersion: '0.1.2', exportedAt: new Date().toISOString() });
        expect(lines.slice(1)).toEqual(response.buffer.entries);
        expect(file.text).not.toContain('secret');
        expect(await handle({ type: DIAGNOSTIC_REQUEST.CLEAR }, sender('options.html'))).toEqual({ ok: true });
        expect((await log.snapshot()).entries).toEqual([]);
    });

    it('rejects web/content senders, spoofed sources, unsafe details and read/clear outside options', async () => {
        const log = new DiagnosticLog(memoryStorage());
        const handle = createDiagnosticHandler(log, runtime);
        const append = { type: DIAGNOSTIC_REQUEST.APPEND, event };
        for (const untrusted of [
            { id: runtime.id, url: 'https://news.ycombinator.com' },
            { id: 'other', url: runtime.getURL('options.html') },
            { id: runtime.id },
        ]) expect(handle(append, untrusted)).toBeNull();
        expect(handle({ ...append, source: DIAGNOSTIC_SOURCE.BACKGROUND }, sender('popup.html'))).toBeNull();
        expect(handle({ ...append, event: { ...event, details: { url: 'secret' } } }, sender('popup.html'))).toBeNull();
        expect(handle({ type: DIAGNOSTIC_REQUEST.CLEAR }, sender('popup.html'))).toBeNull();
        expect(handle({ type: DIAGNOSTIC_REQUEST.SNAPSHOT }, sender('side-panel.html'))).toBeNull();
        expect((await log.snapshot()).entries).toEqual([]);
    });

    it('returns a stable failure response without recursive logging or leaking storage errors', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const storage = memoryStorage();
        vi.spyOn(storage, 'write').mockRejectedValue(new Error('secret'));
        const handle = createDiagnosticHandler(new DiagnosticLog(storage), runtime);
        expect(await handle({ type: DIAGNOSTIC_REQUEST.APPEND, event }, sender('popup.html'))).toEqual({ ok: false });
        expect(warn).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(warn.mock.calls)).not.toContain('secret');
    });
});
