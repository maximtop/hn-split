import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { applyDocumentLocale, t } from '../shared/i18n';
import { SidePanelApp } from './side-panel-app';
import '@mantine/core/styles.css';
import './styles.css';

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
