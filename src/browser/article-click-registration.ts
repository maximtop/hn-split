/**
 * Defines the registration operations for the article-click content script.
 */
export interface ContentScriptRegistry {
    /**
     * Determines whether the article-click content script is registered.
     */
    isRegistered(): Promise<boolean>;
    /**
     * Registers the article-click content script.
     */
    register(): Promise<void>;
    /**
     * Removes the article-click content script registration.
     */
    unregister(): Promise<void>;
}

/**
 * Converges the content-script registration onto the desired setting state.
 * Chrome throws when registering a duplicate ID or unregistering a missing
 * one, so both the toggle effect and the startup reconcile go through this
 * idempotent form instead of calling the registry blindly.
 * @param enabled - Whether the article-click setting is enabled.
 * @param registry - The content-script registration operations to converge.
 */
export async function ensureArticleClickRegistration(
    enabled: boolean,
    registry: ContentScriptRegistry,
): Promise<void> {
    const registered = await registry.isRegistered();
    if (enabled && !registered) {
        await registry.register();
        return;
    }
    if (!enabled && registered) {
        await registry.unregister();
    }
}
