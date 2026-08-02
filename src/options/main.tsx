import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { OptionsApp } from './options-app';
import { OptionsStore } from './options-store';
import { t } from '../shared/i18n';
import { BACKGROUND_REQUEST_TYPE } from '../shared/messages';
import '@mantine/core/styles.css';
import './styles.css';

const root = document.querySelector('#root');
if (root === null) {
    throw new Error('Options root element is missing');
}

document.title = t('options_document_title');

const store = new OptionsStore({
    async readCurrent() {
        return chrome.runtime.sendMessage({
            type: BACKGROUND_REQUEST_TYPE.GET_AVAILABILITY_SETTING,
        });
    },
    async notifyChanged(enabled) {
        return chrome.runtime.sendMessage({
            type: BACKGROUND_REQUEST_TYPE.SET_AVAILABILITY_SETTING,
            enabled,
        });
    },
});
void store.load();

createRoot(root).render(
    <StrictMode>
        <OptionsApp store={store} />
    </StrictMode>,
);
