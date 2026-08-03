import { afterEach, describe, expect, it } from 'vitest';

import { detectArticleClick } from '../src/content/article-click';
import type { ArticleClickEventLike } from '../src/content/article-click';

const STORY_ID = '424242';
const EXTERNAL_HREF = 'https://article.example.com/story';

interface StoryRowOptions {
    rowId?: string | null;
    href?: string;
    rowClass?: string;
}

/**
 * Renders one realistic Hacker News listing row: the story anchor inside
 * `.titleline`, the nested `from?site=` chip, and the subtext comments link.
 */
function renderStoryRow({
    rowId = STORY_ID,
    href = EXTERNAL_HREF,
    rowClass = 'athing submission',
}: StoryRowOptions = {}): {
    storyAnchor: HTMLAnchorElement;
    siteAnchor: HTMLAnchorElement;
    commentsAnchor: HTMLAnchorElement;
    rankCell: HTMLElement;
} {
    const table = document.createElement('table');
    const idAttribute = rowId === null ? '' : ` id="${rowId}"`;
    table.innerHTML = `
        <tbody>
            <tr class="${rowClass}"${idAttribute}>
                <td class="title"><span class="rank">1.</span></td>
                <td class="title">
                    <span class="titleline"><a href="${href}">Story title</a>
                        <span class="sitebit comhead"> (<a href="from?site=article.example.com"><span class="sitestr">article.example.com</span></a>)</span>
                    </span>
                </td>
            </tr>
            <tr>
                <td class="subtext"><a href="item?id=${STORY_ID}">12&nbsp;comments</a></td>
            </tr>
        </tbody>
    `;
    document.body.append(table);
    const storyAnchor = table.querySelector<HTMLAnchorElement>('.titleline > a');
    const siteAnchor = table.querySelector<HTMLAnchorElement>('.sitebit a');
    const commentsAnchor = table.querySelector<HTMLAnchorElement>('.subtext a');
    const rankCell = table.querySelector<HTMLElement>('.rank');
    if (storyAnchor === null || siteAnchor === null || commentsAnchor === null || rankCell === null) {
        throw new Error('Fixture markup is missing an expected element');
    }
    return { storyAnchor, siteAnchor, commentsAnchor, rankCell };
}

/**
 * Fabricates the click-event fields; jsdom keeps `isTrusted` read-only on real
 * events, so the pure detector receives plain objects instead.
 */
function clickEvent(target: unknown, overrides: Partial<ArticleClickEventLike> = {}): ArticleClickEventLike {
    return {
        isTrusted: true,
        button: 0,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        defaultPrevented: false,
        target,
        ...overrides,
    };
}

function pageOrigin(): string {
    return window.location.origin;
}

afterEach(() => {
    document.body.replaceChildren();
});

describe('detectArticleClick', () => {
    it('accepts an unmodified primary click on an external story link', () => {
        const { storyAnchor } = renderStoryRow();

        expect(detectArticleClick(clickEvent(storyAnchor), pageOrigin())).toBe(STORY_ID);
    });

    it('accepts keyboard activation, which dispatches an equivalent click event', () => {
        const { storyAnchor } = renderStoryRow();

        // Enter on a focused link fires a click with the primary button and no
        // modifiers, so it intentionally passes the same filter.
        expect(detectArticleClick(clickEvent(storyAnchor, { button: 0 }), pageOrigin())).toBe(STORY_ID);
    });

    it.each([
        { name: 'middle click', overrides: { button: 1 } },
        { name: 'right click', overrides: { button: 2 } },
        { name: 'meta click', overrides: { metaKey: true } },
        { name: 'ctrl click', overrides: { ctrlKey: true } },
        { name: 'shift click', overrides: { shiftKey: true } },
        { name: 'alt click', overrides: { altKey: true } },
        { name: 'canceled click', overrides: { defaultPrevented: true } },
        { name: 'synthetic click', overrides: { isTrusted: false } },
    ] satisfies Array<{ name: string; overrides: Partial<ArticleClickEventLike> }>)(
        'ignores a $name on a story link',
        ({ overrides }) => {
            const { storyAnchor } = renderStoryRow();

            expect(detectArticleClick(clickEvent(storyAnchor, overrides), pageOrigin())).toBeNull();
        },
    );

    it('ignores links that download instead of navigating', () => {
        const { storyAnchor } = renderStoryRow();
        storyAnchor.setAttribute('download', '');

        expect(detectArticleClick(clickEvent(storyAnchor), pageOrigin())).toBeNull();
    });

    it('ignores links targeting another browsing context but accepts _self', () => {
        const { storyAnchor } = renderStoryRow();

        storyAnchor.setAttribute('target', '_blank');
        expect(detectArticleClick(clickEvent(storyAnchor), pageOrigin())).toBeNull();

        storyAnchor.setAttribute('target', '_self');
        expect(detectArticleClick(clickEvent(storyAnchor), pageOrigin())).toBe(STORY_ID);
    });

    it('ignores the nested site chip inside the title line', () => {
        const { siteAnchor } = renderStoryRow();

        expect(detectArticleClick(clickEvent(siteAnchor), pageOrigin())).toBeNull();
    });

    it('ignores the comments link outside the title line', () => {
        const { commentsAnchor } = renderStoryRow();

        expect(detectArticleClick(clickEvent(commentsAnchor), pageOrigin())).toBeNull();
    });

    it('ignores links that stay on the current origin, such as self posts', () => {
        const { storyAnchor } = renderStoryRow({ href: 'item?id=424242' });

        expect(detectArticleClick(clickEvent(storyAnchor), pageOrigin())).toBeNull();
    });

    it.each(['mailto:someone@example.com', 'javascript:void(0)'])(
        'ignores non-HTTP(S) story links (%s)',
        (href) => {
            const { storyAnchor } = renderStoryRow({ href });

            expect(detectArticleClick(clickEvent(storyAnchor), pageOrigin())).toBeNull();
        },
    );

    it.each([
        { name: 'a missing row id', rowId: null },
        { name: 'a non-numeric row id', rowId: 'story-424242' },
        { name: 'a zero row id', rowId: '0' },
        { name: 'an unsafely large row id', rowId: String(Number.MAX_SAFE_INTEGER + 1) },
    ])('ignores a story row with $name', ({ rowId }) => {
        const { storyAnchor } = renderStoryRow({ rowId });

        expect(detectArticleClick(clickEvent(storyAnchor), pageOrigin())).toBeNull();
    });

    it('ignores anchors outside a story row, as in comment markup', () => {
        const paragraph = document.createElement('p');
        paragraph.innerHTML = `<span class="titleline"><a href="${EXTERNAL_HREF}">Detached</a></span>`;
        document.body.append(paragraph);
        const anchor = paragraph.querySelector('a');

        expect(detectArticleClick(clickEvent(anchor), pageOrigin())).toBeNull();
    });

    it('ignores clicks that land outside any anchor', () => {
        const { rankCell } = renderStoryRow();

        expect(detectArticleClick(clickEvent(rankCell), pageOrigin())).toBeNull();
        expect(detectArticleClick(clickEvent(null), pageOrigin())).toBeNull();
    });
});
