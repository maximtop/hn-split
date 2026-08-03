import { StrictMode, act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OptionsApp } from '../src/options/options-app';
import { OptionsStore } from '../src/options/options-store';
import { BACKGROUND_REQUEST_TYPE } from '../src/shared/messages';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function installChrome({
    storedEnabled = false,
    mutationResponse = { ok: true, result: { enabled: true } },
}: {
    storedEnabled?: boolean;
    mutationResponse?: unknown;
} = {}): {
    sendMessage: ReturnType<typeof vi.fn>;
} {
    let currentEnabled = storedEnabled;
    const sendMessage = vi.fn(async (request: { type: string; enabled?: boolean }) => {
        if (request.type === BACKGROUND_REQUEST_TYPE.GET_AVAILABILITY_SETTING) {
            return { ok: true, result: { enabled: currentEnabled } };
        }
        if (
            request.type === BACKGROUND_REQUEST_TYPE.SET_AVAILABILITY_SETTING
            && mutationResponse !== null
            && typeof mutationResponse === 'object'
            && 'ok' in mutationResponse
            && mutationResponse.ok === true
            && 'result' in mutationResponse
            && mutationResponse.result !== null
            && typeof mutationResponse.result === 'object'
            && 'enabled' in mutationResponse.result
            && typeof mutationResponse.result.enabled === 'boolean'
            && request.enabled !== undefined
        ) {
            currentEnabled = request.enabled;
        }
        return mutationResponse;
    });
    vi.stubGlobal('chrome', {
        runtime: { sendMessage },
    } as unknown as typeof chrome);
    return { sendMessage };
}

async function renderOptions(): Promise<{ container: HTMLDivElement; unmount: () => Promise<void> }> {
    const store = new OptionsStore({
        readCurrent: async () => chrome.runtime.sendMessage({
            type: BACKGROUND_REQUEST_TYPE.GET_AVAILABILITY_SETTING,
        }),
        requestUpdate: async (enabled) => chrome.runtime.sendMessage({
            type: BACKGROUND_REQUEST_TYPE.SET_AVAILABILITY_SETTING,
            enabled,
        }),
    });
    await store.load();
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
        root.render(
            <StrictMode>
                <OptionsApp store={store} />
            </StrictMode>,
        );
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
    it('enables automatic availability exclusively through background messages', async () => {
        const chromeMocks = installChrome();
        const view = await renderOptions();
        const checkbox = view.container.querySelector<HTMLInputElement>('input[type="checkbox"]');

        await act(async () => {
            checkbox?.click();
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        expect(chromeMocks.sendMessage).toHaveBeenNthCalledWith(1, {
            type: BACKGROUND_REQUEST_TYPE.GET_AVAILABILITY_SETTING,
        });
        expect(chromeMocks.sendMessage).toHaveBeenNthCalledWith(2, {
            type: BACKGROUND_REQUEST_TYPE.SET_AVAILABILITY_SETTING,
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
    ])('resynchronizes through the background worker when mutation returns %#', async (mutationResponse) => {
        const chromeMocks = installChrome({ mutationResponse });
        const view = await renderOptions();
        const checkbox = view.container.querySelector<HTMLInputElement>('input[type="checkbox"]');

        await act(async () => {
            checkbox?.click();
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        expect(checkbox?.checked).toBe(false);
        expect(chromeMocks.sendMessage).toHaveBeenNthCalledWith(2, {
            type: BACKGROUND_REQUEST_TYPE.SET_AVAILABILITY_SETTING,
            enabled: true,
        });
        expect(chromeMocks.sendMessage).toHaveBeenNthCalledWith(3, {
            type: BACKGROUND_REQUEST_TYPE.GET_AVAILABILITY_SETTING,
        });
        expect(view.container.querySelector('.settings-status')?.textContent).not.toBe('');
        await view.unmount();
    });
});
