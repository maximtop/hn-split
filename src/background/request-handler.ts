import { DiscussionTabManager } from '../browser/open-discussion';
import { BACKGROUND_REQUEST_TYPE } from '../shared/messages';
import type { BackgroundRequest, BackgroundResponse } from '../shared/messages';
import { lookupArticle } from './article-lookup';
import { setAutomaticAvailability } from './automatic-availability-controller';
import {
    getAutomaticAvailabilityEnabled,
    sessionStore,
    tabs,
} from './chrome-adapters';

const UNEXPECTED_EXTENSION_ERROR = 'Unexpected extension error';
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

        return {
            ok: true,
            result: await discussionTabs.open(request.articleTabId, request.itemId),
        };
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : UNEXPECTED_EXTENSION_ERROR,
        };
    }
}
