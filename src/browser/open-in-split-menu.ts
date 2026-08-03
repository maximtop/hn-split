import { HTTP_LINK_TARGET_PATTERNS, LINK_MENU_CONTEXT, OPEN_IN_SPLIT_MENU } from '../shared/context-menus';
import { t } from '../shared/i18n';

/**
 * Describes the menu item the extension contributes to link right-clicks.
 */
export interface OpenInSplitMenuProperties {
    /**
     * Identifies the menu item for the click listener.
     */
    id: string;
    /**
     * Contains the localized menu label the user reads.
     */
    title: string;
    /**
     * Limits the item to the right-click contexts it belongs in.
     */
    contexts: string[];
    /**
     * Limits the item to the link targets it can act on.
     */
    targetUrlPatterns: string[];
}

/**
 * Defines the menu operations used to publish the link action.
 */
export interface OpenInSplitMenuRegistry {
    /**
     * Removes every menu item this extension owns.
     */
    removeAll(): Promise<void>;
    /**
     * Creates one menu item.
     * @param properties - The menu item to create.
     */
    create(properties: OpenInSplitMenuProperties): Promise<void>;
}

/**
 * Publishes the "Open in Split" link action.
 *
 * Chrome keeps menu items across worker suspensions but drops them when the
 * extension is updated, disabled and re-enabled, or the browser restarts, and
 * it rejects a second item with the same identifier. Clearing first therefore
 * makes this safe to run unconditionally on every worker start, which is how
 * the registration converges in all of those cases.
 * @param registry - The menu operations to converge.
 */
export async function ensureOpenInSplitMenu(registry: OpenInSplitMenuRegistry): Promise<void> {
    await registry.removeAll();
    await registry.create({
        id: OPEN_IN_SPLIT_MENU.ID,
        title: t('context_menu_open_in_split'),
        contexts: [LINK_MENU_CONTEXT],
        targetUrlPatterns: [...HTTP_LINK_TARGET_PATTERNS],
    });
}
