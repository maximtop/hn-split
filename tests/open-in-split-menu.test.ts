import { describe, expect, it, vi } from 'vitest';

import enMessages from '../public/_locales/en/messages.json' with { type: 'json' };
import { ensureOpenInSplitMenu } from '../src/browser/open-in-split-menu';
import type { OpenInSplitMenuProperties, OpenInSplitMenuRegistry } from '../src/browser/open-in-split-menu';
import { HTTP_LINK_TARGET_PATTERNS, LINK_MENU_CONTEXT, OPEN_IN_SPLIT_MENU } from '../src/shared/context-menus';

/**
 * Builds a registry that records the order of its calls.
 */
function registry(): { menu: OpenInSplitMenuRegistry; calls: string[]; created: OpenInSplitMenuProperties[] } {
    const calls: string[] = [];
    const created: OpenInSplitMenuProperties[] = [];
    return {
        calls,
        created,
        menu: {
            removeAll: vi.fn(async () => {
                calls.push('removeAll');
            }),
            create: vi.fn(async (properties: OpenInSplitMenuProperties) => {
                calls.push('create');
                created.push(properties);
            }),
        },
    };
}

describe('ensureOpenInSplitMenu', () => {
    it('clears existing items before creating the link action', async () => {
        const { menu, calls } = registry();

        await ensureOpenInSplitMenu(menu);

        // Chrome rejects a second item with the same identifier, so a worker
        // start that follows an earlier one must clear first.
        expect(calls).toEqual(['removeAll', 'create']);
    });

    it('publishes one localized item limited to HTTP and HTTPS links', async () => {
        const { menu, created } = registry();

        await ensureOpenInSplitMenu(menu);

        expect(created).toEqual([{
            id: OPEN_IN_SPLIT_MENU.ID,
            title: enMessages.context_menu_open_in_split.message,
            contexts: [LINK_MENU_CONTEXT],
            targetUrlPatterns: [...HTTP_LINK_TARGET_PATTERNS],
        }]);
    });

    it('propagates a rejected creation so the worker can report it', async () => {
        const { menu } = registry();
        vi.mocked(menu.create).mockRejectedValueOnce(new Error('duplicate id'));

        await expect(ensureOpenInSplitMenu(menu)).rejects.toThrow('duplicate id');
    });
});
