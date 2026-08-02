import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { OptionsApp } from './options-app';
import { t } from '../shared/i18n';
import '@mantine/core/styles.css';
import './styles.css';

const root = document.querySelector('#root');
if (root === null) {
    throw new Error('Options root element is missing');
}

document.title = t('options_document_title');

createRoot(root).render(
    <StrictMode>
        <OptionsApp />
    </StrictMode>,
);
