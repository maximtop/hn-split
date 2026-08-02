import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './popup-app';
import { t } from '../shared/i18n';
import '@mantine/core/styles.css';
import './styles.css';

const root = document.querySelector('#root');
if (root === null) {
    throw new Error('Popup root element is missing');
}

document.title = t('extension_name');

createRoot(root).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
