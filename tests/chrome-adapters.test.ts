import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import {
    applyAvailabilityBadge,
    contentScriptRegistry,
    contextMenuRegistry,
    getActiveTab,
    getSidePanelContent,
    getSidePanelFollowEnabled,
    listSidePanelContent,
    setSidePanelContent,
    setSidePanelFollowEnabled,
    sidePanelAssociations,
} from '../src/background/chrome-adapters';
import { ARTICLE_CLICK_CONTENT_SCRIPT } from '../src/shared/content-scripts';
import { SIDE_PANEL_ASSOCIATION_ORIGIN } from '../src/shared/side-panel-association';
import { SIDE_PANEL_CONTENT_KIND } from '../src/shared/side-panel-content';
import { sidePanelContentKey } from '../src/shared/storage-keys';

const TAB_ID = 7;
const WINDOW_ID = 3;

/**
 * Installs record-shaped Chrome local/session storage and tab-query fakes.
 *
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
                get: vi.fn(async (key: string | null) => (key === null
                    ? { ...session }
                    : { [key]: session[key] })),
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
    return {
        local,
        session,
        localSet,
        sessionSet,
        query,
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('side-panel Chrome adapters', () => {
    it('keeps follow disabled for missing or malformed values and persists only its key', async () => {
        const { local, localSet } = installChrome();

        await expect(getSidePanelFollowEnabled()).resolves.toBe(false);
        local.side_panel_follow = 'yes';
        await expect(getSidePanelFollowEnabled()).resolves.toBe(false);
        local.side_panel_follow = true;
        await expect(getSidePanelFollowEnabled()).resolves.toBe(true);
        local.automatic_availability = true;
        await setSidePanelFollowEnabled(false);

        expect(localSet).toHaveBeenCalledExactlyOnceWith({ side_panel_follow: false });
        expect(local.automatic_availability).toBe(true);
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

describe('article-click content script registration', () => {
    it('registers for top-level Hacker News documents only, never the framed discussion sub-frame', async () => {
        const registerContentScripts = vi.fn(async () => undefined);
        vi.stubGlobal('chrome', { scripting: { registerContentScripts } });

        await contentScriptRegistry.register();

        expect(registerContentScripts).toHaveBeenCalledExactlyOnceWith([{
            id: ARTICLE_CLICK_CONTENT_SCRIPT.ID,
            js: [ARTICLE_CLICK_CONTENT_SCRIPT.FILE],
            matches: ['https://news.ycombinator.com/*'],
            runAt: 'document_end',
            allFrames: false,
            persistAcrossSessions: true,
        }]);
    });

    it('reports registration state from the real registered-script list', async () => {
        const getRegisteredContentScripts = vi.fn(async () => [] as { id: string }[]);
        vi.stubGlobal('chrome', { scripting: { getRegisteredContentScripts } });

        await expect(contentScriptRegistry.isRegistered()).resolves.toBe(false);
        expect(getRegisteredContentScripts).toHaveBeenCalledExactlyOnceWith({
            ids: [ARTICLE_CLICK_CONTENT_SCRIPT.ID],
        });

        getRegisteredContentScripts.mockResolvedValueOnce([{ id: ARTICLE_CLICK_CONTENT_SCRIPT.ID }]);
        await expect(contentScriptRegistry.isRegistered()).resolves.toBe(true);
    });

    it('unregisters the article-click script by its stable id', async () => {
        const unregisterContentScripts = vi.fn(async () => undefined);
        vi.stubGlobal('chrome', { scripting: { unregisterContentScripts } });

        await contentScriptRegistry.unregister();

        expect(unregisterContentScripts).toHaveBeenCalledExactlyOnceWith({
            ids: [ARTICLE_CLICK_CONTENT_SCRIPT.ID],
        });
    });
});

describe('availability badge application', () => {
    it('applies badge text, color, and title in order for a live tab', async () => {
        const calls: string[] = [];
        vi.stubGlobal('chrome', {
            action: {
                setBadgeText: vi.fn(async () => {
                    calls.push('text');
                }),
                setBadgeBackgroundColor: vi.fn(async () => {
                    calls.push('color');
                }),
                setTitle: vi.fn(async () => {
                    calls.push('title');
                }),
            },
        });

        await applyAvailabilityBadge(TAB_ID, { text: '5', color: '#ff0000', title: 'Found' });

        expect(calls).toEqual(['text', 'color', 'title']);
        expect(chrome.action.setBadgeText).toHaveBeenCalledExactlyOnceWith({ tabId: TAB_ID, text: '5' });
        expect(chrome.action.setBadgeBackgroundColor)
            .toHaveBeenCalledExactlyOnceWith({ tabId: TAB_ID, color: '#ff0000' });
        expect(chrome.action.setTitle).toHaveBeenCalledExactlyOnceWith({ tabId: TAB_ID, title: 'Found' });
    });

    it('skips the background-color call when the badge carries no color', async () => {
        vi.stubGlobal('chrome', {
            action: {
                setBadgeText: vi.fn(async () => undefined),
                setBadgeBackgroundColor: vi.fn(async () => undefined),
                setTitle: vi.fn(async () => undefined),
            },
        });

        await applyAvailabilityBadge(TAB_ID, { text: '', title: 'Empty' });

        expect(chrome.action.setBadgeBackgroundColor).not.toHaveBeenCalled();
    });

    it('swallows the failure silently when the tab closed before the badge applied', async () => {
        vi.stubGlobal('chrome', {
            action: {
                setBadgeText: vi.fn(async () => {
                    throw new Error('No tab with id');
                }),
            },
            tabs: {
                get: vi.fn(async () => {
                    throw new Error('No tab with id');
                }),
            },
        });

        await expect(applyAvailabilityBadge(TAB_ID, { text: '5', title: 'Found' })).resolves.toBeUndefined();
    });

    it('rethrows the original failure when the tab is still open', async () => {
        const badgeFailure = new Error('Extension context invalidated');
        vi.stubGlobal('chrome', {
            action: {
                setBadgeText: vi.fn(async () => {
                    throw badgeFailure;
                }),
            },
            tabs: {
                get: vi.fn(async () => ({ id: TAB_ID })),
            },
        });

        await expect(applyAvailabilityBadge(TAB_ID, { text: '5', title: 'Found' })).rejects.toBe(badgeFailure);
    });
});

describe('context menu registration failure reporting', () => {
    it('resolves when Chrome reports no runtime error', async () => {
        vi.stubGlobal('chrome', {
            contextMenus: {
                create: vi.fn((_properties: unknown, callback: () => void) => {
                    callback();
                }),
            },
            runtime: {},
        });

        await expect(contextMenuRegistry.create({
            id: 'open_in_split_link',
            title: 'Open in Split',
            contexts: ['link'],
            targetUrlPatterns: ['http://*/*', 'https://*/*'],
        })).resolves.toBeUndefined();
    });

    it('rejects with the runtime.lastError message when Chrome reports a callback failure', async () => {
        vi.stubGlobal('chrome', {
            contextMenus: {
                create: vi.fn((_properties: unknown, callback: () => void) => {
                    callback();
                }),
            },
            runtime: { lastError: { message: 'Duplicate id' } },
        });

        await expect(contextMenuRegistry.create({
            id: 'open_in_split_link',
            title: 'Open in Split',
            contexts: ['link'],
            targetUrlPatterns: ['http://*/*', 'https://*/*'],
        })).rejects.toThrow('Duplicate id');
    });
});
