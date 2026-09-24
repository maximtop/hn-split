/**
 * @file Entry point of the options page: installs the diagnostic transport, builds and loads the settings stores,
 * and mounts the options view.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { SUPPORTS_ARTICLE_CLICK } from '../shared/browser-target';
import { installDiagnosticTransport } from '../shared/diagnostic-protocol';
import { applyDocumentLocale, t } from '../shared/i18n';

import { OptionsApp } from './options-app';
import { createOptionsStores } from './options-stores';

import '@mantine/core/styles.css';
import './styles.css';

installDiagnosticTransport(async (request) => {
    const response: unknown = await chrome.runtime.sendMessage(request);
    return response;
});

const root = document.querySelector('#root');
if (root === null) {
    throw new Error('Options root element is missing');
}

applyDocumentLocale();
document.title = t('options_document_title');

const {
    articleClick,
    availability,
    sidePanelFollow,
} = createOptionsStores(async (request) => {
    const response: unknown = await chrome.runtime.sendMessage(request);
    return response;
});
void availability.load();
if (SUPPORTS_ARTICLE_CLICK) {
    void articleClick.load();
}
void sidePanelFollow.load();

createRoot(root).render(
    <StrictMode>
        <OptionsApp
            availability={availability}
            articleClick={articleClick}
            sidePanelFollow={sidePanelFollow}
        />
    </StrictMode>,
);
