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

const store = new OptionsStore({
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
});
void store.load();

createRoot(root).render(
    <StrictMode>
        <OptionsApp store={store} />
    </StrictMode>,
);
