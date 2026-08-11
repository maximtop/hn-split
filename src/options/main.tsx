import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { OptionsApp } from './options-app';
import { createOptionsStores } from './options-stores';
import { applyDocumentLocale, t } from '../shared/i18n';
import '@mantine/core/styles.css';
import './styles.css';

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
void articleClick.load();
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
