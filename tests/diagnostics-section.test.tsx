import { MantineProvider } from '@mantine/core';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';

import enMessages from '../public/_locales/en/messages.json';
import { DiagnosticsSection, downloadDiagnostics } from '../src/options/diagnostics-section';
import { DIAGNOSTIC_EVENT } from '../src/shared/diagnostic-events';
import { DIAGNOSTIC_REQUEST } from '../src/shared/diagnostic-protocol';
import { DIAGNOSTIC_FORMAT_VERSION, DIAGNOSTIC_LEVEL, DIAGNOSTIC_SOURCE } from '../src/shared/diagnostics';
import { theme } from '../src/shared/theme';

import type { DiagnosticExport } from '../src/shared/diagnostic-export';
import type { DiagnosticTransport } from '../src/shared/diagnostic-protocol';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const empty = { formatVersion: DIAGNOSTIC_FORMAT_VERSION, entries: [] };
const entry = {
    level: DIAGNOSTIC_LEVEL.INFO,
    source: DIAGNOSTIC_SOURCE.OPTIONS,
    message: DIAGNOSTIC_EVENT.FRAMING_READY,
    details: { tabId: 1 },
    timestamp: '2026-09-20T12:34:56.000Z',
};
const unmounts: (() => void)[] = [];

async function render(send: DiagnosticTransport, download = vi.fn()) {
    vi.stubGlobal('chrome', { runtime: { getManifest: () => ({ version: '0.1.2' }) } });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    unmounts.push(() => {
        root.unmount();
        container.remove();
    });
    await act(async () => {
        root.render(
            <MantineProvider theme={theme}><DiagnosticsSection send={send} download={download} /></MantineProvider>,
        );
    });
    return { container, download };
}

async function click(container: HTMLElement, name: string) {
    const button = [...container.querySelectorAll('button')].find((element) => element.textContent === name);
    expect(button).toBeDefined();
    await act(async () => button?.click());
}

afterEach(async () => {
    await act(async () => {
        unmounts.splice(0).forEach((unmount) => unmount());
    });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('diagnostics controls', () => {
    it('shows empty state and downloads nothing before a click, then exports a versioned empty bundle', async () => {
        const send = vi.fn(async () => ({ ok: true, buffer: empty }));
        const { container, download } = await render(send);
        expect(container.querySelector('[role="status"]')?.textContent).toContain(enMessages.diagnostics_empty.message);
        expect(download).not.toHaveBeenCalled();
        await click(container, enMessages.diagnostics_export.message);
        expect(send).toHaveBeenLastCalledWith({ type: DIAGNOSTIC_REQUEST.SNAPSHOT });
        expect(download).toHaveBeenCalledTimes(1);
        const file = download.mock.calls[0]?.[0] as { text: string; filename: string };
        expect(JSON.parse(file.text)).toMatchObject({
            formatVersion: DIAGNOSTIC_FORMAT_VERSION,
            extensionVersion: '0.1.2',
        });
        expect(file.filename).toMatch(/^\d{8}_\d{6}_hn_split_v0\.1\.2\.txt$/);
        expect(container.querySelector('[role="status"]')?.textContent)
            .toContain(enMessages.diagnostics_exported.message);
    });

    it('exports the latest snapshot and clears only after an explicit click', async () => {
        const send = vi.fn(async () => ({ ok: true, buffer: { ...empty, entries: [entry] } }));
        const { container, download } = await render(send);
        expect(container.textContent).toContain(enMessages.diagnostics_count.message.replace('%count%', '1'));
        await click(container, enMessages.diagnostics_export.message);
        const file = download.mock.calls[0]?.[0] as { text: string };
        expect(JSON.parse(file.text.trim().split('\n')[1]!)).toEqual(entry);
        await click(container, enMessages.diagnostics_clear.message);
        expect(send).toHaveBeenLastCalledWith({ type: DIAGNOSTIC_REQUEST.CLEAR });
        expect(container.querySelector('[role="status"]')?.textContent)
            .toContain(enMessages.diagnostics_cleared.message);
        expect(container.textContent).toContain(enMessages.diagnostics_empty.message);
    });

    it.each([
        { ok: false },
        { ok: true },
        { ok: true, buffer: { ...empty, entries: [{ ...entry, details: { url: 'PRIVATE_PAGE_PAYLOAD' } }] } },
    ])('shows stable failure feedback and does not download an invalid snapshot', async (response) => {
        const send = vi.fn(async () => response);
        const { container, download } = await render(send);
        expect(container.querySelector('[role="status"]')?.textContent)
            .toContain(enMessages.diagnostics_failure.message);
        await click(container, enMessages.diagnostics_export.message);
        expect(download).not.toHaveBeenCalled();
        expect(container.textContent).not.toContain('PRIVATE_PAGE_PAYLOAD');
        expect(container.querySelector('[role="status"]')?.textContent)
            .toContain(enMessages.diagnostics_failure.message);
    });

    it('recovers from runtime rejection and a failed download', async () => {
        const send = vi.fn(async () => ({ ok: true, buffer: empty }));
        send.mockRejectedValueOnce(new Error('private failure'));
        const download = vi.fn<(file: DiagnosticExport) => void>(() => {
            throw new Error('save failed');
        });
        const { container } = await render(send, download);
        expect(container.textContent).toContain(enMessages.diagnostics_failure.message);
        await click(container, enMessages.diagnostics_export.message);
        expect(container.textContent).toContain(enMessages.diagnostics_failure.message);
        download.mockImplementation(() => undefined);
        await click(container, enMessages.diagnostics_export.message);
        expect(container.textContent).toContain(enMessages.diagnostics_exported.message);
    });

    it('keeps the snapshot count when clearing fails', async () => {
        const send = vi.fn(async () => ({ ok: true, buffer: { ...empty, entries: [entry] } }));
        const { container } = await render(send);
        send.mockRejectedValueOnce(new Error('storage unavailable'));
        await click(container, enMessages.diagnostics_clear.message);
        expect(container.textContent).toContain(enMessages.diagnostics_count.message.replace('%count%', '1'));
        expect(container.textContent).toContain(enMessages.diagnostics_failure.message);
    });

    it('does not overwrite a clear result with an older pending initial snapshot', async () => {
        let resolveInitial!: (value: unknown) => void;
        const initial = new Promise((resolve) => {
            resolveInitial = resolve;
        });
        const send = vi.fn<DiagnosticTransport>().mockReturnValueOnce(initial).mockResolvedValue({ ok: true });
        const { container } = await render(send);
        await click(container, enMessages.diagnostics_clear.message);
        await act(async () => resolveInitial({ ok: true, buffer: { ...empty, entries: [entry] } }));
        expect(container.textContent).toContain(enMessages.diagnostics_empty.message);
        expect(container.textContent).toContain(enMessages.diagnostics_cleared.message);
    });
});

describe('local Blob download', () => {
    it('uses a text Blob and download anchor, then releases the URL without opening a window', () => {
        vi.useFakeTimers();
        const create = vi.fn<(blob: Blob) => string>().mockReturnValue('blob:local-support');
        const revoke = vi.fn();
        vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
        const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click')
            .mockImplementation(function recordClick(this: HTMLAnchorElement) {
                expect(this.download).toBe('support.txt');
                expect(this.href).toBe('blob:local-support');
                expect(this.isConnected).toBe(true);
            });
        const open = vi.spyOn(window, 'open');
        downloadDiagnostics({ filename: 'support.txt', text: 'safe diagnostic text' });
        expect(anchorClick).toHaveBeenCalledTimes(1);
        expect(create.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
        expect(open).not.toHaveBeenCalled();
        expect(document.querySelector('a[download]')).toBeNull();
        vi.runAllTimers();
        expect(revoke).toHaveBeenCalledWith('blob:local-support');
    });
});
