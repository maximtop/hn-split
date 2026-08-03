/**
 * Identifies the "Open in Split" link context-menu item. The identifier is
 * stable so the click listener can tell this item apart from any menu item the
 * extension may add later.
 */
export const OPEN_IN_SPLIT_MENU = {
    ID: 'open_in_split_link',
} as const;

/**
 * Names the menu context that limits the item to link targets, so it never
 * appears on plain page, selection, or image right-clicks.
 */
export const LINK_MENU_CONTEXT = 'link';

/**
 * Restricts the menu item to HTTP and HTTPS link targets. This is the coarse
 * declarative filter Chrome can apply before the menu is drawn; the conservative
 * eligibility rules in `src/domain/url.ts` still decide, at click time, whether
 * a link may be looked up.
 */
export const HTTP_LINK_TARGET_PATTERNS = ['http://*/*', 'https://*/*'] as const;
