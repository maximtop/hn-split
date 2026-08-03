import { DiscussionTabManager } from '../browser/open-discussion';
import { logWarning } from '../shared/logger';
import { BACKGROUND_ERROR_CODE, BACKGROUND_REQUEST_TYPE } from '../shared/messages';
import type { BackgroundErrorCode, BackgroundRequest, BackgroundResponse } from '../shared/messages';
import { setArticleClickSetting } from './article-click-controller';
import { lookupArticle } from './article-lookup';
import { setAutomaticAvailability } from './automatic-availability-controller';
import {
    getArticleClickDiscussionEnabled,
    getAutomaticAvailabilityEnabled,
    getSidePanelContent,
    sessionStore,
    tabs,
} from './chrome-adapters';
import { selectSidePanelDiscussion } from './side-panel-content-controller';

const REQUEST_ERROR_CODE: Record<BackgroundRequest['type'], BackgroundErrorCode> = {
    [BACKGROUND_REQUEST_TYPE.LOOKUP]: BACKGROUND_ERROR_CODE.LOOKUP_REQUEST_FAILED,
    [BACKGROUND_REQUEST_TYPE.OPEN_DISCUSSION]: BACKGROUND_ERROR_CODE.OPEN_DISCUSSION_FAILED,
    [BACKGROUND_REQUEST_TYPE.GET_AVAILABILITY_SETTING]: BACKGROUND_ERROR_CODE.SETTING_READ_FAILED,
    [BACKGROUND_REQUEST_TYPE.SET_AVAILABILITY_SETTING]: BACKGROUND_ERROR_CODE.SETTING_UPDATE_FAILED,
    [BACKGROUND_REQUEST_TYPE.GET_ARTICLE_CLICK_SETTING]: BACKGROUND_ERROR_CODE.SETTING_READ_FAILED,
    [BACKGROUND_REQUEST_TYPE.SET_ARTICLE_CLICK_SETTING]: BACKGROUND_ERROR_CODE.SETTING_UPDATE_FAILED,
    [BACKGROUND_REQUEST_TYPE.SELECT_SIDE_PANEL_DISCUSSION]: BACKGROUND_ERROR_CODE.SIDE_PANEL_SELECTION_FAILED,
    [BACKGROUND_REQUEST_TYPE.GET_SIDE_PANEL_DISCUSSION]: BACKGROUND_ERROR_CODE.SIDE_PANEL_SELECTION_FAILED,
};

const discussionTabs = new DiscussionTabManager(tabs, sessionStore);

/**
 * Routes one validated runtime request to its background operation.
 * @param request - The validated background request to process.
 */
export async function handleRequest(request: BackgroundRequest): Promise<BackgroundResponse> {
    try {
        if (request.type === BACKGROUND_REQUEST_TYPE.LOOKUP) {
            const result = await lookupArticle(
                request.context.pageUrl,
                request.context.canonicalHref,
            );
            return { ok: true, result };
        }

        if (request.type === BACKGROUND_REQUEST_TYPE.GET_AVAILABILITY_SETTING) {
            return {
                ok: true,
                result: { enabled: await getAutomaticAvailabilityEnabled() },
            };
        }

        if (request.type === BACKGROUND_REQUEST_TYPE.SET_AVAILABILITY_SETTING) {
            return {
                ok: true,
                result: { enabled: await setAutomaticAvailability(request.enabled) },
            };
        }

        if (request.type === BACKGROUND_REQUEST_TYPE.GET_ARTICLE_CLICK_SETTING) {
            return {
                ok: true,
                result: { enabled: await getArticleClickDiscussionEnabled() },
            };
        }

        if (request.type === BACKGROUND_REQUEST_TYPE.SET_ARTICLE_CLICK_SETTING) {
            return {
                ok: true,
                result: { enabled: await setArticleClickSetting(request.enabled) },
            };
        }

        if (request.type === BACKGROUND_REQUEST_TYPE.SELECT_SIDE_PANEL_DISCUSSION) {
            return { ok: true, result: { content: await selectSidePanelDiscussion(request.itemId) } };
        }

        if (request.type === BACKGROUND_REQUEST_TYPE.GET_SIDE_PANEL_DISCUSSION) {
            return { ok: true, result: { content: await getSidePanelContent() } };
        }

        return {
            ok: true,
            result: await discussionTabs.open(request.articleTabId, request.itemId),
        };
    } catch (error) {
        // Keep the raw diagnostic local; the protocol carries only stable codes
        // that each UI surface translates in its own locale.
        logWarning('background request failed.', error);
        return { ok: false, error: REQUEST_ERROR_CODE[request.type] };
    }
}
