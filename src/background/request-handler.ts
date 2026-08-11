import { DiscussionTabManager } from '../browser/open-discussion';
import { logDiagnostic, logWarning } from '../shared/logger';
import { BACKGROUND_ERROR_CODE, BACKGROUND_REQUEST_TYPE } from '../shared/messages';
import type { BackgroundErrorCode, BackgroundRequest, BackgroundResponse } from '../shared/messages';
import type { SidePanelContent } from '../shared/side-panel-content';
import { setArticleClickSetting } from './article-click-controller';
import { lookupArticle } from './article-lookup';
import { setAutomaticAvailability } from './automatic-availability-controller';
import {
    getArticleClickDiscussionEnabled,
    getAutomaticAvailabilityEnabled,
    getSidePanelFollowEnabled,
    getSidePanelContent,
    sessionStore,
    tabs,
} from './chrome-adapters';
import {
    cancelSidePanelExplicitOperation,
    reserveSidePanelExplicitOperation,
    selectSidePanelDiscussion,
} from './side-panel-content-controller';
import {
    checkActiveSidePanelTab,
    enableSidePanelFollow,
    setSidePanelFollowSetting,
} from './side-panel-follow-controller';

const REQUEST_ERROR_CODE: Record<BackgroundRequest['type'], BackgroundErrorCode> = {
    [BACKGROUND_REQUEST_TYPE.LOOKUP]: BACKGROUND_ERROR_CODE.LOOKUP_REQUEST_FAILED,
    [BACKGROUND_REQUEST_TYPE.OPEN_DISCUSSION]: BACKGROUND_ERROR_CODE.OPEN_DISCUSSION_FAILED,
    [BACKGROUND_REQUEST_TYPE.GET_AVAILABILITY_SETTING]: BACKGROUND_ERROR_CODE.SETTING_READ_FAILED,
    [BACKGROUND_REQUEST_TYPE.SET_AVAILABILITY_SETTING]: BACKGROUND_ERROR_CODE.SETTING_UPDATE_FAILED,
    [BACKGROUND_REQUEST_TYPE.GET_ARTICLE_CLICK_SETTING]: BACKGROUND_ERROR_CODE.SETTING_READ_FAILED,
    [BACKGROUND_REQUEST_TYPE.SET_ARTICLE_CLICK_SETTING]: BACKGROUND_ERROR_CODE.SETTING_UPDATE_FAILED,
    [BACKGROUND_REQUEST_TYPE.SELECT_SIDE_PANEL_DISCUSSION]: BACKGROUND_ERROR_CODE.SIDE_PANEL_SELECTION_FAILED,
    [BACKGROUND_REQUEST_TYPE.GET_SIDE_PANEL_DISCUSSION]: BACKGROUND_ERROR_CODE.SIDE_PANEL_SELECTION_FAILED,
    [BACKGROUND_REQUEST_TYPE.CHECK_ACTIVE_SIDE_PANEL_TAB]: BACKGROUND_ERROR_CODE.SIDE_PANEL_SELECTION_FAILED,
    [BACKGROUND_REQUEST_TYPE.ENABLE_SIDE_PANEL_FOLLOW]: BACKGROUND_ERROR_CODE.SETTING_UPDATE_FAILED,
    [BACKGROUND_REQUEST_TYPE.GET_SIDE_PANEL_FOLLOW_SETTING]: BACKGROUND_ERROR_CODE.SETTING_READ_FAILED,
    [BACKGROUND_REQUEST_TYPE.SET_SIDE_PANEL_FOLLOW_SETTING]: BACKGROUND_ERROR_CODE.SETTING_UPDATE_FAILED,
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
            const reservation = reserveSidePanelExplicitOperation(
                request.windowId,
                request.tabId,
            );
            let content: SidePanelContent;
            try {
                const tab = await tabs.get(request.tabId);
                if (tab.windowId !== request.windowId) {
                    throw new Error('Side panel selection tab moved to another window');
                }
                content = await selectSidePanelDiscussion({
                    reservation,
                    tabId: request.tabId,
                    windowId: request.windowId,
                    itemId: request.itemId,
                    sourceUrl: request.sourceUrl,
                });
            } catch (error) {
                cancelSidePanelExplicitOperation(request.windowId, reservation, true);
                throw error;
            }
            logDiagnostic('side panel selection stored.', {
                tabId: request.tabId,
                windowId: request.windowId,
                kind: content.kind,
            });
            return {
                ok: true,
                result: { content },
            };
        }

        if (request.type === BACKGROUND_REQUEST_TYPE.GET_SIDE_PANEL_DISCUSSION) {
            const projection = await getSidePanelContent(request.windowId);
            return { ok: true, result: { content: projection?.content ?? null } };
        }

        if (request.type === BACKGROUND_REQUEST_TYPE.CHECK_ACTIVE_SIDE_PANEL_TAB) {
            return {
                ok: true,
                result: { content: await checkActiveSidePanelTab(request.windowId) },
            };
        }

        if (request.type === BACKGROUND_REQUEST_TYPE.ENABLE_SIDE_PANEL_FOLLOW) {
            return {
                ok: true,
                result: { content: await enableSidePanelFollow(request.windowId) },
            };
        }

        if (request.type === BACKGROUND_REQUEST_TYPE.GET_SIDE_PANEL_FOLLOW_SETTING) {
            return {
                ok: true,
                result: { enabled: await getSidePanelFollowEnabled() },
            };
        }

        if (request.type === BACKGROUND_REQUEST_TYPE.SET_SIDE_PANEL_FOLLOW_SETTING) {
            return {
                ok: true,
                result: { enabled: await setSidePanelFollowSetting(request.enabled) },
            };
        }

        if (request.type === BACKGROUND_REQUEST_TYPE.OPEN_DISCUSSION) {
            return {
                ok: true,
                result: await discussionTabs.open(request.articleTabId, request.itemId),
            };
        }

        request satisfies never;
        throw new Error('Unsupported background request');
    } catch (error) {
        // Keep the raw diagnostic local; the protocol carries only stable codes
        // that each UI surface translates in its own locale.
        logWarning('background request failed.', { requestType: request.type }, error);
        return { ok: false, error: REQUEST_ERROR_CODE[request.type] };
    }
}
