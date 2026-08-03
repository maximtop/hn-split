import { describe, expect, it, vi } from 'vitest';

import { ensureArticleClickRegistration } from '../src/browser/article-click-registration';
import type { ContentScriptRegistry } from '../src/browser/article-click-registration';

function registry(registered: boolean): ContentScriptRegistry {
    return {
        isRegistered: vi.fn(async () => registered),
        register: vi.fn(async () => undefined),
        unregister: vi.fn(async () => undefined),
    };
}

describe('ensureArticleClickRegistration', () => {
    it('registers the script when enabled and absent', async () => {
        const scripts = registry(false);

        await ensureArticleClickRegistration(true, scripts);

        expect(scripts.register).toHaveBeenCalledOnce();
        expect(scripts.unregister).not.toHaveBeenCalled();
    });

    it('leaves an existing registration alone when enabled', async () => {
        const scripts = registry(true);

        await ensureArticleClickRegistration(true, scripts);

        expect(scripts.register).not.toHaveBeenCalled();
        expect(scripts.unregister).not.toHaveBeenCalled();
    });

    it('unregisters the script when disabled and present', async () => {
        const scripts = registry(true);

        await ensureArticleClickRegistration(false, scripts);

        expect(scripts.register).not.toHaveBeenCalled();
        expect(scripts.unregister).toHaveBeenCalledOnce();
    });

    it('does nothing when disabled and absent', async () => {
        const scripts = registry(false);

        await ensureArticleClickRegistration(false, scripts);

        expect(scripts.register).not.toHaveBeenCalled();
        expect(scripts.unregister).not.toHaveBeenCalled();
    });

    it('propagates registry failures to the caller', async () => {
        const scripts = registry(false);
        vi.mocked(scripts.register).mockRejectedValueOnce(new Error('registration denied'));

        await expect(ensureArticleClickRegistration(true, scripts)).rejects.toThrow('registration denied');

        vi.mocked(scripts.isRegistered).mockRejectedValueOnce(new Error('query failed'));
        await expect(ensureArticleClickRegistration(false, scripts)).rejects.toThrow('query failed');
    });
});
