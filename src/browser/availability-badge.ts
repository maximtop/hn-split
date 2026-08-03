import { HN_LOOKUP_STATUS } from '../domain/hn';
import type { HnLookupResult } from '../domain/hn';
import { t } from '../shared/i18n';

const HN_ORANGE = '#ff6600';
const MAX_BADGE_COUNT = 999;
const GENERIC_BADGE_TEXT = 'HN';
const EXTENSION_BRAND = 'HN Split';

/**
 * Describes browser-action badge state derived from a lookup result.
 */
export interface AvailabilityBadge {
    /**
     * Contains the compact badge text.
     */
    text: string;
    /**
     * Contains the localized browser-action tooltip.
     */
    title: string;
    /**
     * Contains the optional badge background color.
     */
    color?: string;
}

/**
 * Clears automatic-availability state while preserving the extension tooltip.
 */
export const EMPTY_AVAILABILITY_BADGE: AvailabilityBadge = {
    text: '',
    title: EXTENSION_BRAND,
};

/**
 * Maps a validated lookup result to localized browser-action badge state.
 * @param result - The validated Hacker News lookup result to represent.
 */
export function badgeForLookupResult(result: HnLookupResult): AvailabilityBadge {
    if (result.status !== HN_LOOKUP_STATUS.FOUND) {
        return EMPTY_AVAILABILITY_BADGE;
    }

    const comments = result.primary.comments;
    if (comments === 0) {
        return {
            text: GENERIC_BADGE_TEXT,
            color: HN_ORANGE,
            title: t('badge_available'),
        };
    }

    return {
        text: comments > MAX_BADGE_COUNT ? `${MAX_BADGE_COUNT}+` : String(comments),
        color: HN_ORANGE,
        title: t('badge_comments_available', { comments: String(comments) }),
    };
}
