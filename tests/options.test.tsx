import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OptionsApp } from '../src/options/options-app';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function installChrome({
    storedEnabled = false,
    response = { ok: true, result: { status: 'updated' } },
}: {
    storedEnabled?: boolean;
    response?: unknown;
} = {}): {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
} {
    const get = vi.fn(async () => ({ automatic_availability: storedEnabled }));
    const set = vi.fn(async () => undefined);
    const sendMessage = vi.fn(async () => response);
    vi.stubGlobal('chrome', {
        runtime: { sendMessage },
        storage: {
            local: {
                get,
                set,
            },
        },
    } as unknown as typeof chrome);
    return { get, set, sendMessage };
}

async function renderOptions(): Promise<{ container: HTMLDivElement; unmount: () => Promise<void> }> {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
        root.render(<OptionsApp />);
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return {
        container,
        unmount: async () => {
            await act(async () => root.unmount());
            container.remove();
        },
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
});

describe('OptionsApp', () => {
    it('enables automatic availability without optional-permission APIs', async () => {
        const chromeMocks = installChrome();
        const view = await renderOptions();
        const checkbox = view.container.querySelector<HTMLInputElement>('input[type="checkbox"]');

        await act(async () => {
            checkbox?.click();
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        expect(chromeMocks.set).not.toHaveBeenCalled();
        expect(chromeMocks.sendMessage).toHaveBeenCalledWith({
            type: 'availability_setting_changed',
            enabled: true,
        });
        expect(checkbox?.checked).toBe(true);
        expect(view.container.textContent).not.toContain('optional');
        await view.unmount();
    });

    it.each([
        null,
        { ok: true },
        { ok: false, error: 'Unable to clear badges' },
    ])('resynchronizes from background-owned storage when notification returns %#', async (response) => {
        const chromeMocks = installChrome({ response });
        const view = await renderOptions();
        const checkbox = view.container.querySelector<HTMLInputElement>('input[type="checkbox"]');

        await act(async () => {
            checkbox?.click();
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        expect(checkbox?.checked).toBe(false);
        expect(chromeMocks.set).not.toHaveBeenCalled();
        expect(chromeMocks.sendMessage).toHaveBeenCalledExactlyOnceWith({
            type: 'availability_setting_changed',
            enabled: true,
        });
        expect(chromeMocks.get).toHaveBeenCalledTimes(2);
        expect(view.container.querySelector('.settings-status')?.textContent).not.toBe('');
        await view.unmount();
    });
});