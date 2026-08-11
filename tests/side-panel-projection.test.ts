import { describe, expect, it } from 'vitest';

import { SIDE_PANEL_CONTENT_KIND } from '../src/shared/side-panel-content';
import {
    isSidePanelProjection,
    matchesReadyStamp,
} from '../src/shared/side-panel-projection';

const TAB_ID = 7;

describe('side panel projection', () => {
    it('accepts a strict positive revision envelope', () => {
        expect(isSidePanelProjection({
            revision: 4,
            content: { kind: SIDE_PANEL_CONTENT_KIND.MANUAL_REQUIRED, tabId: TAB_ID },
        })).toBe(true);
        expect(isSidePanelProjection({
            revision: 0,
            content: { kind: SIDE_PANEL_CONTENT_KIND.MANUAL_REQUIRED, tabId: TAB_ID },
        })).toBe(false);
        expect(isSidePanelProjection({
            revision: 1.5,
            content: { kind: SIDE_PANEL_CONTENT_KIND.MANUAL_REQUIRED, tabId: TAB_ID },
        })).toBe(false);
        expect(isSidePanelProjection({
            revision: Number.MAX_SAFE_INTEGER + 1,
            content: { kind: SIDE_PANEL_CONTENT_KIND.MANUAL_REQUIRED, tabId: TAB_ID },
        })).toBe(false);
        expect(isSidePanelProjection({
            revision: 4,
            content: { kind: SIDE_PANEL_CONTENT_KIND.MANUAL_REQUIRED, tabId: TAB_ID },
            rawUrl: 'https://example.com/story',
        })).toBe(false);
    });

    it('requires the exact ready tab and projection revision', () => {
        const projection = {
            revision: 4,
            content: { kind: SIDE_PANEL_CONTENT_KIND.MANUAL_REQUIRED, tabId: TAB_ID },
        } as const;

        expect(matchesReadyStamp(projection, {
            tabId: TAB_ID,
            projectionRevision: 4,
        })).toBe(true);
        expect(matchesReadyStamp(projection, {
            tabId: TAB_ID,
            projectionRevision: 3,
        })).toBe(false);
        expect(matchesReadyStamp(projection, {
            tabId: 8,
            projectionRevision: 4,
        })).toBe(false);
        expect(matchesReadyStamp(null, {
            tabId: TAB_ID,
            projectionRevision: 4,
        })).toBe(false);
        expect(matchesReadyStamp(projection, null)).toBe(false);
    });
});
