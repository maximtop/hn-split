import { BACKGROUND_REQUEST_TYPE } from '../shared/messages';
import type { BackgroundRequest } from '../shared/messages';
import { OptionsStore } from './options-store';

/**
 * Sends one validated options-page request to the background worker.
 */
export type OptionsMessageSender = (request: BackgroundRequest) => Promise<unknown>;

/**
 * Groups the three independent stores rendered by the options page.
 */
export interface OptionsStores {
    /**
     * Owns the automatic toolbar-badge preference.
     */
    availability: OptionsStore;
    /**
     * Owns the explicit Hacker News article-click behavior.
     */
    articleClick: OptionsStore;
    /**
     * Owns automatic active-tab following for an already-open side panel.
     */
    sidePanelFollow: OptionsStore;
}

/**
 * Creates the production options stores with their exact background protocol routes.
 * @param sendMessage - Runtime transport used for every setting read and mutation.
 */
export function createOptionsStores(sendMessage: OptionsMessageSender): OptionsStores {
    const availability = new OptionsStore({
        readCurrent: () => sendMessage({
            type: BACKGROUND_REQUEST_TYPE.GET_AVAILABILITY_SETTING,
        }),
        requestUpdate: (enabled) => sendMessage({
            type: BACKGROUND_REQUEST_TYPE.SET_AVAILABILITY_SETTING,
            enabled,
        }),
    }, {
        enabledKey: 'automatic_enabled',
        disabledKey: 'automatic_disabled',
    });
    const articleClick = new OptionsStore({
        readCurrent: () => sendMessage({
            type: BACKGROUND_REQUEST_TYPE.GET_ARTICLE_CLICK_SETTING,
        }),
        requestUpdate: (enabled) => sendMessage({
            type: BACKGROUND_REQUEST_TYPE.SET_ARTICLE_CLICK_SETTING,
            enabled,
        }),
    }, {
        enabledKey: 'article_click_open_enabled',
        disabledKey: 'article_click_open_disabled',
    });
    const sidePanelFollow = new OptionsStore({
        readCurrent: () => sendMessage({
            type: BACKGROUND_REQUEST_TYPE.GET_SIDE_PANEL_FOLLOW_SETTING,
        }),
        requestUpdate: (enabled) => sendMessage({
            type: BACKGROUND_REQUEST_TYPE.SET_SIDE_PANEL_FOLLOW_SETTING,
            enabled,
        }),
    }, {
        enabledKey: 'side_panel_follow_enabled',
        disabledKey: 'side_panel_follow_disabled',
    });
    return { articleClick, availability, sidePanelFollow };
}
