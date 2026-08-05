import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import enMessages from '../public/_locales/en/messages.json' with { type: 'json' };
import { SidePanelApp } from '../src/side-panel/side-panel-app';
import { discussionUrl } from '../src/domain/hn';
import { BACKGROUND_REQUEST_TYPE, SIDE_PANEL_READY } from '../src/shared/messages';
import type { SidePanelContent } from '../src/shared/side-panel-content';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ITEM_ID = '424242';
const WINDOW_ID = 3;

/**
 * Exposes the seams of the installed Chrome double.
 */
interface FakeChrome {
    /**
     * Delivers one background message to the panel's port listener.
     */
    emit: (message: { type: string }) => void;
    /**
     * Records every runtime request the panel sends.
     */
    sendMessage: ReturnType<typeof vi.fn>;
}

/**
 * Installs a Chrome double that answers with one panel content value.
 * @param content - The content the background worker reports.
 */
function installChrome(content: SidePanelContent | null): FakeChrome {
    const listeners: Array<(message: { type: string }) => void> = [];
    const sendMessage = vi.fn(async () => ({ ok: true, result: { content } }));
    vi.stubGlobal('chrome', {
        runtime: {
            connect: vi.fn(() => ({
                onMessage: { addListener: (listener: (message: { type: string }) => void) => listeners.push(listener) },
                disconnect: vi.fn(),
            })),
            sendMessage,
        },
        storage: {
            session: { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
        },
        windows: {
            getCurrent: vi.fn(async () => ({ id: WINDOW_ID })),
        },
    });
    return {
        emit: (message) => {
            for (const listener of listeners) {
                listener(message);
            }
        },
        sendMessage,
    };
}

async function renderPanel(): Promise<{ container: HTMLDivElement; unmount: () => Promise<void> }> {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
        root.render(<SidePanelApp />);
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

describe('SidePanelApp', () => {
    it.each([
        { name: 'nothing is selected', content: null, message: enMessages.side_panel_empty.message },
        { name: 'a lookup is running', content: { kind: 'pending' }, message: enMessages.side_panel_pending.message },
        {
            name: 'no discussion exists',
            content: { kind: 'unavailable', reason: 'not_found' },
            message: enMessages.discussion_not_found.message,
        },
        {
            name: 'the link is not eligible',
            content: { kind: 'unavailable', reason: 'restricted' },
            message: enMessages.restricted_page.message,
        },
        {
            name: 'the lookup failed',
            content: { kind: 'unavailable', reason: 'error' },
            message: enMessages.lookup_error.message,
        },
    ])('explains in a live region that $name', async ({ content, message }) => {
        installChrome(content as SidePanelContent | null);

        const panel = await renderPanel();

        expect(panel.container.querySelector('[role="status"]')?.textContent).toContain(message);
        expect(panel.container.querySelector('iframe')).toBeNull();
        await panel.unmount();
    });

    it('asks the background for its own window\'s selection', async () => {
        const fake = installChrome({ kind: 'discussion', itemId: ITEM_ID });

        const panel = await renderPanel();

        expect(fake.sendMessage).toHaveBeenCalledExactlyOnceWith({
            type: BACKGROUND_REQUEST_TYPE.GET_SIDE_PANEL_DISCUSSION,
            windowId: WINDOW_ID,
        });
        await panel.unmount();
    });

    it('frames the discussion only once the framing exception is confirmed', async () => {
        const port = installChrome({ kind: 'discussion', itemId: ITEM_ID });

        const panel = await renderPanel();

        // The exception must be installed before the frame is created, so the
        // panel waits for the worker's ready signal.
        expect(panel.container.querySelector('iframe')).toBeNull();
        await act(async () => {
            port.emit({ type: SIDE_PANEL_READY });
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(panel.container.querySelector('iframe')?.getAttribute('src')).toBe(discussionUrl(ITEM_ID));
        await panel.unmount();
    });
});
