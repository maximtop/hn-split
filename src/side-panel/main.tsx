/**
 * @file Entry point of the side panel: installs the diagnostic transport, applies the document locale and mounts
 * the side panel app.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { installDiagnosticTransport } from '../shared/diagnostic-protocol';
import { applyDocumentLocale, t } from '../shared/i18n';

import { SidePanelApp } from './side-panel-app';
import '@mantine/core/styles.css';
import './styles.css';

installDiagnosticTransport(async (request) => {
    const response: unknown = await chrome.runtime.sendMessage(request);
    return response;
});

const root = document.querySelector('#root');
if (root === null) {
    throw new Error('Side panel root element is missing');
}

applyDocumentLocale();
document.title = t('popup_heading');

createRoot(root).render(
    <StrictMode>
        <SidePanelApp />
    </StrictMode>,
);
