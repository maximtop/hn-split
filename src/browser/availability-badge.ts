import type { HnLookupResult } from '../domain/hn';
import { t } from '../shared/i18n';

const HN_ORANGE = '#ff6600';
const MAX_BADGE_COUNT = 999;

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
 * Maps a validated lookup result to localized browser-action badge state.
 * @param result - The validated Hacker News lookup result to represent.
 */
export function badgeForLookupResult(result: HnLookupResult): AvailabilityBadge {
    if (result.status !== 'found') {
        return { text: '', title: 'HN Split' };
    }

    const comments = result.primary.comments;
    if (comments === 0) {
        return {
            text: 'HN',
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
