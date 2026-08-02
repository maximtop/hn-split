import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { OptionsApp } from './OptionsApp';
import './styles.css';

const root = document.querySelector('#root');
if (root === null) {
    throw new Error('Options root element is missing');
}

createRoot(root).render(
    <StrictMode>
        <OptionsApp />
    </StrictMode>,
);
