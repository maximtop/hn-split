import { installDiagnosticTransport } from '../shared/diagnostic-protocol';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './popup-app';
import { applyDocumentLocale, t } from '../shared/i18n';
import '@mantine/core/styles.css';
import './styles.css';

installDiagnosticTransport(async (request) => {
    const response: unknown = await chrome.runtime.sendMessage(request);
    return response;
});

const root = document.querySelector('#root');
if (root === null) {
    throw new Error('Popup root element is missing');
}

applyDocumentLocale();
document.title = t('extension_name');

createRoot(root).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
