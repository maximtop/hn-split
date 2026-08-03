import { ARTICLE_CLICK_MESSAGE_TYPE } from '../shared/content-scripts';
import { detectArticleClick } from './article-click';

// Bubble phase, and no preventDefault: page handlers run first and their
// cancellation is respected, while the browser still performs the navigation
// itself, keeping the referrer and history behavior of a plain click.
document.addEventListener('click', (event) => {
    const itemId = detectArticleClick(event, window.location.origin);
    if (itemId === null) {
        return;
    }
    // Fire and forget: the request is handed to the browser before the
    // navigation commits and reaches the worker even if this document dies;
    // only the unused response can be lost.
    void chrome.runtime.sendMessage({ type: ARTICLE_CLICK_MESSAGE_TYPE, itemId }).catch(() => undefined);
});
