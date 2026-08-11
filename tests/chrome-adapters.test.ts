import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    getActiveTab,
    getSidePanelContent,
    getSidePanelFollowEnabled,
    listSidePanelContent,
    setSidePanelContent,
    setSidePanelFollowEnabled,
    sidePanelAssociations,
} from '../src/background/chrome-adapters';
import { SIDE_PANEL_ASSOCIATION_ORIGIN } from '../src/shared/side-panel-association';
import { SIDE_PANEL_CONTENT_KIND } from '../src/shared/side-panel-content';
import { sidePanelContentKey } from '../src/shared/storage-keys';

const TAB_ID = 7;
const WINDOW_ID = 3;

/**
 * Installs record-shaped Chrome local/session storage and tab-query fakes.
 * @returns Observable local/session records and Chrome method mocks.
 */
function installChrome(): {
    local: Record<string, unknown>;
    session: Record<string, unknown>;
    localSet: ReturnType<typeof vi.fn>;
    sessionSet: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
} {
    const local: Record<string, unknown> = {};
    const session: Record<string, unknown> = {};
    const localSet = vi.fn(async (values: Record<string, unknown>) => {
        Object.assign(local, values);
    });
    const sessionSet = vi.fn(async (values: Record<string, unknown>) => {
        Object.assign(session, values);
    });
    const query = vi.fn(async (): Promise<chrome.tabs.Tab[]> => []);
    vi.stubGlobal('chrome', {
        storage: {
            local: {
                get: vi.fn(async (key: string) => ({ [key]: local[key] })),
                set: localSet,
            },
            session: {
                get: vi.fn(async (key: string | null) => key === null
                    ? { ...session }
                    : { [key]: session[key] }),
                set: sessionSet,
                remove: vi.fn(async (key: string | string[]) => {
                    for (const entry of Array.isArray(key) ? key : [key]) {
                        delete session[entry];
                    }
                }),
            },
        },
        tabs: { query },
    });
    return { local, session, localSet, sessionSet, query };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('side-panel Chrome adapters', () => {
    it('keeps follow disabled for missing or malformed values and persists only its key', async () => {
        const { local, localSet } = installChrome();

        await expect(getSidePanelFollowEnabled()).resolves.toBe(false);
        local['side_panel_follow'] = 'yes';
        await expect(getSidePanelFollowEnabled()).resolves.toBe(false);
        local['side_panel_follow'] = true;
        await expect(getSidePanelFollowEnabled()).resolves.toBe(true);
        local['automatic_availability'] = true;
        await setSidePanelFollowEnabled(false);

        expect(localSet).toHaveBeenCalledExactlyOnceWith({ side_panel_follow: false });
        expect(local['automatic_availability']).toBe(true);
    });

    it('queries only the active tab in the requested window', async () => {
        const { query } = installChrome();
        vi.mocked(query).mockResolvedValueOnce([{ id: TAB_ID, windowId: WINDOW_ID, index: 0 }]);

        await expect(getActiveTab(WINDOW_ID)).resolves.toMatchObject({ id: TAB_ID });
        expect(query).toHaveBeenCalledExactlyOnceWith({ active: true, windowId: WINDOW_ID });
        await expect(getActiveTab(WINDOW_ID)).resolves.toBeNull();
    });

    it('round trips associations through the process-wide lazy adapter', async () => {
        installChrome();
        const association = {
            tabId: TAB_ID,
            windowId: WINDOW_ID,
            origin: SIDE_PANEL_ASSOCIATION_ORIGIN.EXPLICIT,
            outcome: { kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION, itemId: '424242' },
            articleIdentity: 'example.com/story',
        } as const;

        await sidePanelAssociations.set(association);

        await expect(sidePanelAssociations.get(TAB_ID)).resolves.toEqual(association);
    });

    it('stores and lists only strict revisioned window projections', async () => {
        const { session, sessionSet } = installChrome();
        const projection = {
            revision: 4,
            content: { kind: SIDE_PANEL_CONTENT_KIND.MANUAL_REQUIRED, tabId: TAB_ID },
        } as const;

        await setSidePanelContent(WINDOW_ID, projection);
        await expect(getSidePanelContent(WINDOW_ID)).resolves.toEqual(projection);
        expect(sessionSet).toHaveBeenCalledWith({ [sidePanelContentKey(WINDOW_ID)]: projection });
        session[sidePanelContentKey(4)] = { kind: SIDE_PANEL_CONTENT_KIND.PENDING, tabId: TAB_ID };
        session[sidePanelContentKey(5)] = { ...projection, rawUrl: 'https://example.com/private' };

        await expect(listSidePanelContent()).resolves.toEqual([{ windowId: WINDOW_ID, projection }]);
        session[sidePanelContentKey(WINDOW_ID)] = projection.content;
        await expect(getSidePanelContent(WINDOW_ID)).resolves.toBeNull();
    });
});
