import { StrictMode, act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import enMessages from '../public/_locales/en/messages.json' with { type: 'json' };
import { OptionsApp } from '../src/options/options-app';
import { OptionsStore } from '../src/options/options-store';
import { BACKGROUND_REQUEST_TYPE } from '../src/shared/messages';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VALID_MUTATION = { ok: true, result: { enabled: true } };

function isConfirmedMutation(response: unknown): boolean {
    return response !== null
        && typeof response === 'object'
        && 'ok' in response
        && response.ok === true
        && 'result' in response
        && response.result !== null
        && typeof response.result === 'object'
        && 'enabled' in response.result
        && typeof response.result.enabled === 'boolean';
}

function installChrome({
    availabilityMutation = VALID_MUTATION,
    articleClickMutation = VALID_MUTATION,
}: {
    availabilityMutation?: unknown;
    articleClickMutation?: unknown;
} = {}): {
    sendMessage: ReturnType<typeof vi.fn>;
} {
    const state = { availability: false, articleClick: false };
    const sendMessage = vi.fn(async (request: { type: string; enabled?: boolean }) => {
        if (request.type === BACKGROUND_REQUEST_TYPE.GET_AVAILABILITY_SETTING) {
            return { ok: true, result: { enabled: state.availability } };
        }
        if (request.type === BACKGROUND_REQUEST_TYPE.GET_ARTICLE_CLICK_SETTING) {
            return { ok: true, result: { enabled: state.articleClick } };
        }
        if (request.type === BACKGROUND_REQUEST_TYPE.SET_AVAILABILITY_SETTING) {
            if (isConfirmedMutation(availabilityMutation) && request.enabled !== undefined) {
                state.availability = request.enabled;
            }
            return availabilityMutation;
        }
        if (isConfirmedMutation(articleClickMutation) && request.enabled !== undefined) {
            state.articleClick = request.enabled;
        }
        return articleClickMutation;
    });
    vi.stubGlobal('chrome', {
        runtime: { sendMessage },
    });
    return { sendMessage };
}

async function renderOptions(): Promise<{ container: HTMLDivElement; unmount: () => Promise<void> }> {
    const availability = new OptionsStore({
        readCurrent: async () => chrome.runtime.sendMessage({
            type: BACKGROUND_REQUEST_TYPE.GET_AVAILABILITY_SETTING,
        }),
        requestUpdate: async (enabled) => chrome.runtime.sendMessage({
            type: BACKGROUND_REQUEST_TYPE.SET_AVAILABILITY_SETTING,
            enabled,
        }),
    }, {
        enabledKey: 'automatic_enabled',
        disabledKey: 'automatic_disabled',
    });
    const articleClick = new OptionsStore({
        readCurrent: async () => chrome.runtime.sendMessage({
            type: BACKGROUND_REQUEST_TYPE.GET_ARTICLE_CLICK_SETTING,
        }),
        requestUpdate: async (enabled) => chrome.runtime.sendMessage({
            type: BACKGROUND_REQUEST_TYPE.SET_ARTICLE_CLICK_SETTING,
            enabled,
        }),
    }, {
        enabledKey: 'article_click_open_enabled',
        disabledKey: 'article_click_open_disabled',
    });
    await availability.load();
    await articleClick.load();
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
        root.render(
            <StrictMode>
                <OptionsApp availability={availability} articleClick={articleClick} />
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

function switchByLabel(container: HTMLElement, labelText: string): HTMLInputElement | null {
    const label = Array.from(container.querySelectorAll('label'))
        .find((candidate) => candidate.textContent === labelText);
    if (label?.htmlFor === undefined || label.htmlFor === '') {
        return null;
    }
    const input = document.getElementById(label.htmlFor);
    return input instanceof HTMLInputElement ? input : null;
}

afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
});

describe('OptionsApp', () => {
    it('enables each setting exclusively through background messages', async () => {
        const chromeMocks = installChrome();
        const view = await renderOptions();
        const availabilitySwitch = switchByLabel(view.container, enMessages.automatic_badge_label.message);
        const articleClickSwitch = switchByLabel(view.container, enMessages.article_click_open_label.message);

        await act(async () => {
            availabilitySwitch?.click();
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        await act(async () => {
            articleClickSwitch?.click();
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        expect(chromeMocks.sendMessage).toHaveBeenCalledWith({
            type: BACKGROUND_REQUEST_TYPE.SET_AVAILABILITY_SETTING,
            enabled: true,
        });
        expect(chromeMocks.sendMessage).toHaveBeenCalledWith({
            type: BACKGROUND_REQUEST_TYPE.SET_ARTICLE_CLICK_SETTING,
            enabled: true,
        });
        expect(availabilitySwitch?.checked).toBe(true);
        expect(articleClickSwitch?.checked).toBe(true);
        await view.unmount();
    });

    it.each([
        null,
        { ok: true },
        { ok: false, error: 'Unable to clear badges' },
    ])('resynchronizes the availability switch when mutation returns %#', async (availabilityMutation) => {
        const chromeMocks = installChrome({ availabilityMutation });
        const view = await renderOptions();
        const availabilitySwitch = switchByLabel(view.container, enMessages.automatic_badge_label.message);

        await act(async () => {
            availabilitySwitch?.click();
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        expect(availabilitySwitch?.checked).toBe(false);
        expect(chromeMocks.sendMessage).toHaveBeenCalledWith({
            type: BACKGROUND_REQUEST_TYPE.SET_AVAILABILITY_SETTING,
            enabled: true,
        });
        const requestTypes = (chromeMocks.sendMessage.mock.calls as Array<[{ type: string }]>)
            .map(([request]) => request.type);
        expect(requestTypes.filter((type) => type === BACKGROUND_REQUEST_TYPE.GET_AVAILABILITY_SETTING))
            .toHaveLength(2);
        expect(view.container.querySelector('.settings-status')?.textContent).not.toBe('');
        await view.unmount();
    });

    it.each([
        null,
        { ok: true },
        { ok: false, error: 'Unable to register the script' },
    ])('resynchronizes the article-click switch when mutation returns %#', async (articleClickMutation) => {
        const chromeMocks = installChrome({ articleClickMutation });
        const view = await renderOptions();
        const articleClickSwitch = switchByLabel(view.container, enMessages.article_click_open_label.message);

        await act(async () => {
            articleClickSwitch?.click();
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        expect(articleClickSwitch?.checked).toBe(false);
        expect(chromeMocks.sendMessage).toHaveBeenCalledWith({
            type: BACKGROUND_REQUEST_TYPE.SET_ARTICLE_CLICK_SETTING,
            enabled: true,
        });
        const requestTypes = (chromeMocks.sendMessage.mock.calls as Array<[{ type: string }]>)
            .map(([request]) => request.type);
        expect(requestTypes.filter((type) => type === BACKGROUND_REQUEST_TYPE.GET_ARTICLE_CLICK_SETTING))
            .toHaveLength(2);
        expect(view.container.querySelector('.settings-status')?.textContent).not.toBe('');
        await view.unmount();
    });
});
