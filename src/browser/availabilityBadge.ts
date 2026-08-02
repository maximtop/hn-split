import type { HnLookupResult } from '../domain/hn';

const HN_ORANGE = '#ff6600';

export interface AvailabilityBadge {
    text: string;
    title: string;
    color?: string;
}

export function badgeForLookupResult(result: HnLookupResult): AvailabilityBadge {
    if (result.status !== 'found') {
        return { text: '', title: 'HN Split' };
    }

    const comments = result.primary.comments;
    if (comments === 0) {
        return {
            text: 'HN',
            color: HN_ORANGE,
            title: 'Hacker News discussion available',
        };
    }

    return {
        text: comments > 999 ? '999+' : String(comments),
        color: HN_ORANGE,
        title: `${comments} Hacker News comments available`,
    };
}
