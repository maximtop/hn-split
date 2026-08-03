import { describe, expect, it } from 'vitest';

import { badgeForLookupResult } from '../src/browser/availability-badge';
import type { HnLookupResult } from '../src/domain/hn';

function found(comments: number): HnLookupResult {
    return {
        status: 'found',
        primary: {
            id: '123',
            title: 'Story',
            articleUrl: 'https://example.com/story',
            comments,
            points: 10,
            createdAt: 1,
        },
        alternatives: [],
    };
}

describe('badgeForLookupResult', () => {
    it('shows the comment count with Hacker News styling', () => {
        expect(badgeForLookupResult(found(42))).toEqual({
            text: '42',
            color: '#ff6600',
            title: '42 Hacker News comments available',
        });
    });

    it('shows HN for a discussion without comments', () => {
        expect(badgeForLookupResult(found(0))).toEqual({
            text: 'HN',
            color: '#ff6600',
            title: 'Hacker News discussion available',
        });
    });

    it('caps counts that do not fit in a toolbar badge', () => {
        expect(badgeForLookupResult(found(1_500))).toMatchObject({ text: '999+' });
    });

    it.each<HnLookupResult>([
        { status: 'not_found' },
        { status: 'restricted' },
        { status: 'error', reason: 'lookup_failed' },
    ])('clears the badge when no discussion is available', (result) => {
        expect(badgeForLookupResult(result)).toEqual({
            text: '',
            title: 'Split for Hacker News',
        });
    });
});
