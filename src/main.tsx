import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './popup/App';
import './popup/styles.css';

const root = document.querySelector('#root');
if (root === null) {
    throw new Error('Popup root element is missing');
}

createRoot(root).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
