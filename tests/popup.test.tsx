import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/popup/App';
import type { BackgroundResponse } from '../src/shared/messages';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const foundResponse: BackgroundResponse = {
    ok: true,
    result: {
        status: 'found',
        primary: {
            id: '123',
            title: 'Primary discussion',
            articleUrl: 'https://example.com/story',
            comments: 10,
            points: 20,
            createdAt: 1,
        },
        alternatives: [{
            id: '456',
            title: 'Alternative discussion',
            articleUrl: 'https://example.com/story',
            comments: 5,
            points: 8,
            createdAt: 2,
        }],
    },
};

function installChrome(sendMessage: ReturnType<typeof vi.fn>): ReturnType<typeof vi.fn> {
    const openOptionsPage = vi.fn(async () => undefined);
    vi.stubGlobal('chrome', {
        runtime: { sendMessage, openOptionsPage },
        scripting: {
            executeScript: vi.fn(async () => [{
                result: { pageUrl: 'https://example.com/story', canonicalHref: null },
            }]),
        },
        tabs: { query: vi.fn(async () => [{ id: 40 }]) },
    } as unknown as typeof chrome);
    return openOptionsPage;
}

async function renderLoadedApp(): Promise<{ container: HTMLDivElement; unmount: () => Promise<void> }> {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
        root.render(<App />);
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

describe('App discussion opens', () => {
    it('shows an actionable error and re-enables buttons when messaging rejects', async () => {
        const sendMessage = vi.fn()
            .mockResolvedValueOnce(foundResponse)
            .mockRejectedValueOnce(new Error('Extension context invalidated'));
        installChrome(sendMessage);
        const view = await renderLoadedApp();
        const buttons = [...view.container.querySelectorAll<HTMLButtonElement>('button.discussion')];

        await act(async () => {
            buttons[0]?.click();
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        expect(buttons.every(({ disabled }) => !disabled)).toBe(true);
        expect(view.container.querySelector('.status--error')?.textContent)
            .toBe('Unable to open discussion: Extension context invalidated');
        await view.unmount();
    });

    it('disables every discussion button while an open request is pending', async () => {
        const pending = new Promise<BackgroundResponse>(() => undefined);
        const sendMessage = vi.fn()
            .mockResolvedValueOnce(foundResponse)
            .mockReturnValueOnce(pending);
        installChrome(sendMessage);
        const view = await renderLoadedApp();
        const buttons = [...view.container.querySelectorAll<HTMLButtonElement>('button.discussion')];

        await act(async () => {
            buttons[0]?.click();
            await Promise.resolve();
        });

        expect(buttons).toHaveLength(2);
        expect(buttons.every(({ disabled }) => disabled)).toBe(true);
        await view.unmount();
    });

    it('opens availability settings from the popup', async () => {
        const openOptionsPage = installChrome(vi.fn().mockResolvedValue(foundResponse));
        const view = await renderLoadedApp();

        await act(async () => {
            view.container.querySelector<HTMLButtonElement>('button.settings-link')?.click();
            await Promise.resolve();
        });

        expect(openOptionsPage).toHaveBeenCalledOnce();
        await view.unmount();
    });

    it('rejects a malformed successful lookup response', async () => {
        installChrome(vi.fn().mockResolvedValue({
            ok: true,
            result: {
                status: 'found',
                primary: {
                    id: '0', title: 'Invalid', articleUrl: 'https://example.com/story',
                    comments: 1, points: 1, createdAt: 1,
                },
                alternatives: [],
            },
        }));

        const view = await renderLoadedApp();

        expect(view.container.querySelectorAll('button.discussion')).toHaveLength(0);
        expect(view.container.querySelector('.status--error')?.textContent)
            .toBe('Invalid response from extension.');
        await view.unmount();
    });

    it('rejects a malformed successful open response and re-enables buttons', async () => {
        const sendMessage = vi.fn()
            .mockResolvedValueOnce(foundResponse)
            .mockResolvedValueOnce({ ok: true, result: { mode: 'adjacent_tab', tabId: -1 } });
        installChrome(sendMessage);
        const view = await renderLoadedApp();
        const buttons = [...view.container.querySelectorAll<HTMLButtonElement>('button.discussion')];

        await act(async () => {
            buttons[0]?.click();
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        expect(buttons.every(({ disabled }) => !disabled)).toBe(true);
        expect(view.container.querySelector('.status--error')?.textContent)
            .toBe('Unable to open discussion: Invalid response from extension.');
        await view.unmount();
    });
});
