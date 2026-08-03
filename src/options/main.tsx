import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { OptionsApp } from './options-app';
import { OptionsStore } from './options-store';
import { applyDocumentLocale, t } from '../shared/i18n';
import { BACKGROUND_REQUEST_TYPE } from '../shared/messages';
import '@mantine/core/styles.css';
import './styles.css';

const root = document.querySelector('#root');
if (root === null) {
    throw new Error('Options root element is missing');
}

applyDocumentLocale();
document.title = t('options_document_title');

const availabilityStore = new OptionsStore({
    async readCurrent() {
        const response: unknown = await chrome.runtime.sendMessage({
            type: BACKGROUND_REQUEST_TYPE.GET_AVAILABILITY_SETTING,
        });
        return response;
    },
    async requestUpdate(enabled) {
        const response: unknown = await chrome.runtime.sendMessage({
            type: BACKGROUND_REQUEST_TYPE.SET_AVAILABILITY_SETTING,
            enabled,
        });
        return response;
    },
}, {
    enabledKey: 'automatic_enabled',
    disabledKey: 'automatic_disabled',
});
void availabilityStore.load();

const articleClickStore = new OptionsStore({
    async readCurrent() {
        const response: unknown = await chrome.runtime.sendMessage({
            type: BACKGROUND_REQUEST_TYPE.GET_ARTICLE_CLICK_SETTING,
        });
        return response;
    },
    async requestUpdate(enabled) {
        const response: unknown = await chrome.runtime.sendMessage({
            type: BACKGROUND_REQUEST_TYPE.SET_ARTICLE_CLICK_SETTING,
            enabled,
        });
        return response;
    },
}, {
    enabledKey: 'article_click_open_enabled',
    disabledKey: 'article_click_open_disabled',
});
void articleClickStore.load();

createRoot(root).render(
    <StrictMode>
        <OptionsApp availability={availabilityStore} articleClick={articleClickStore} />
    </StrictMode>,
);
