import {
    Anchor,
    MantineProvider,
    Stack,
    Text,
} from '@mantine/core';
import { useEffect, useState } from 'react';

import { HN_ORIGIN, discussionUrl } from '../domain/hn';
import { t } from '../shared/i18n';
import { logWarning } from '../shared/logger';
import { cssVariablesResolver, theme } from '../shared/theme';
import {
    BACKGROUND_REQUEST_TYPE,
    SIDE_PANEL_PORT,
    SIDE_PANEL_READY,
    isSidePanelSelectionResponse,
} from '../shared/messages';

/**
 * Describes the side panel's asynchronous framing and selection state.
 */
interface SidePanelState {
    /**
     * Contains the selected Hacker News item identifier.
     */
    itemId: string | null;
    /**
     * Indicates whether the background worker confirmed the framing exception,
     * which must happen before the discussion frame is allowed to load.
     */
    ready: boolean;
}

/**
 * Reads the discussion the popup selected for this panel.
 */
async function readSelection(): Promise<string | null> {
    const response: unknown = await chrome.runtime.sendMessage({
        type: BACKGROUND_REQUEST_TYPE.GET_SIDE_PANEL_DISCUSSION,
    });
    if (!isSidePanelSelectionResponse(response) || !response.ok) {
        return null;
    }
    return response.result.itemId;
}

/**
 * Renders the Hacker News discussion inside the browser side panel.
 *
 * Hacker News refuses framing through `X-Frame-Options` and `frame-ancestors`,
 * so the background worker installs a narrow response-header exception while
 * this panel is open, and the frame is created only after that exception is
 * confirmed. The panel itself stays chrome-free; the mechanism is disclosed on
 * the options page and in `PRIVACY.md`.
 */
export function SidePanelApp(): React.JSX.Element {
    const [state, setState] = useState<SidePanelState>({ itemId: null, ready: false });

    useEffect(() => {
        const port = chrome.runtime.connect({ name: SIDE_PANEL_PORT });
        port.onMessage.addListener((message: { type?: string }) => {
            if (message.type === SIDE_PANEL_READY) {
                setState((current) => ({ ...current, ready: true }));
            }
        });
        return () => {
            port.disconnect();
        };
    }, []);

    useEffect(() => {
        let cancelled = false;
        const load = async (): Promise<void> => {
            try {
                const itemId = await readSelection();
                if (!cancelled) {
                    setState((current) => ({ ...current, itemId }));
                }
            } catch (error) {
                logWarning('reading the side panel selection failed.', error);
            }
        };
        void load();
        const onChanged = (): void => {
            void load();
        };
        chrome.storage.session.onChanged.addListener(onChanged);
        return () => {
            cancelled = true;
            chrome.storage.session.onChanged.removeListener(onChanged);
        };
    }, []);

    const target = state.itemId === null ? HN_ORIGIN : discussionUrl(state.itemId);

    return (
        <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} defaultColorScheme="auto">
            <Stack component="main" gap={0} h="100%">
                {state.itemId === null
                    ? (
                            <Stack gap="xs" p="md">
                                <Text c="dimmed" size="sm">{t('side_panel_empty')}</Text>
                                <Anchor href={HN_ORIGIN} target="_blank" rel="noreferrer" size="sm">
                                    {t('side_panel_open_on_hn')}
                                </Anchor>
                            </Stack>
                        )
                    : null}
                {state.itemId !== null && state.ready
                    ? (
                            <iframe
                                className="discussion-frame"
                                src={target}
                                title={t('popup_heading')}
                            />
                        )
                    : null}
            </Stack>
        </MantineProvider>
    );
}
