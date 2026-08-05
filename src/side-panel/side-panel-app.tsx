import {
    Anchor,
    Box,
    MantineProvider,
    Stack,
    Text,
} from '@mantine/core';
import { useEffect, useState } from 'react';

import { HN_LOOKUP_STATUS, HN_ORIGIN, discussionUrl } from '../domain/hn';
import { t } from '../shared/i18n';
import type { MessageKey } from '../shared/i18n';
import { logWarning } from '../shared/logger';
import { cssVariablesResolver, theme } from '../shared/theme';
import { SIDE_PANEL_CONTENT_KIND } from '../shared/side-panel-content';
import type { SidePanelContent, SidePanelUnavailableReason } from '../shared/side-panel-content';
import { sidePanelContentKey } from '../shared/storage-keys';
import {
    BACKGROUND_REQUEST_TYPE,
    SIDE_PANEL_PORT,
    SIDE_PANEL_READY,
    isSidePanelContentResponse,
} from '../shared/messages';

/**
 * Maps each reason a discussion cannot be shown onto the message the popup
 * already uses for the same lookup outcome.
 */
const UNAVAILABLE_MESSAGE_KEY: Record<SidePanelUnavailableReason, MessageKey> = {
    [HN_LOOKUP_STATUS.NOT_FOUND]: 'discussion_not_found',
    [HN_LOOKUP_STATUS.RESTRICTED]: 'restricted_page',
    [HN_LOOKUP_STATUS.ERROR]: 'lookup_error',
};

/**
 * Describes the side panel's asynchronous framing and content state.
 */
interface SidePanelState {
    /**
     * Contains what the panel was asked to display, or null when nothing has
     * been selected in this browser session.
     */
    content: SidePanelContent | null;
    /**
     * Indicates whether the background worker confirmed the framing exception,
     * which must happen before the discussion frame is allowed to load.
     */
    ready: boolean;
}

/**
 * Reads what the background worker asks this window's panel to display.
 * @param windowId - The browser window this panel belongs to.
 */
async function readContent(windowId: number): Promise<SidePanelContent | null> {
    const response: unknown = await chrome.runtime.sendMessage({
        type: BACKGROUND_REQUEST_TYPE.GET_SIDE_PANEL_DISCUSSION,
        windowId,
    });
    if (!isSidePanelContentResponse(response) || !response.ok) {
        return null;
    }
    return response.result.content;
}

/**
 * Resolves the status line shown while no discussion frame can be displayed.
 * @param content - The current panel content.
 */
function statusMessage(content: SidePanelContent | null): string | null {
    if (content === null) {
        return t('side_panel_empty');
    }
    if (content.kind === SIDE_PANEL_CONTENT_KIND.PENDING) {
        return t('side_panel_pending');
    }
    if (content.kind === SIDE_PANEL_CONTENT_KIND.UNAVAILABLE) {
        return t(UNAVAILABLE_MESSAGE_KEY[content.reason]);
    }
    return null;
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
    const [state, setState] = useState<SidePanelState>({ content: null, ready: false });

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
        let windowId: number | null = null;
        const load = async (): Promise<void> => {
            if (windowId === null) {
                return;
            }
            try {
                const content = await readContent(windowId);
                if (!cancelled) {
                    setState((current) => ({ ...current, content }));
                }
            } catch (error) {
                logWarning('reading the side panel content failed.', error);
            }
        };
        const onChanged = (changes: Record<string, chrome.storage.StorageChange>): void => {
            if (windowId !== null && sidePanelContentKey(windowId) in changes) {
                void load();
            }
        };
        // Registered before the window is known: the listener no-ops until
        // then, and registering late could miss the selection this panel was
        // opened for.
        chrome.storage.session.onChanged.addListener(onChanged);
        void (async () => {
            try {
                const current = await chrome.windows.getCurrent();
                if (cancelled || current.id === undefined) {
                    return;
                }
                windowId = current.id;
                await load();
            } catch (error) {
                logWarning('resolving the panel window failed.', error);
            }
        })();
        return () => {
            cancelled = true;
            chrome.storage.session.onChanged.removeListener(onChanged);
        };
    }, []);

    const status = statusMessage(state.content);
    const showFrame = state.content?.kind === SIDE_PANEL_CONTENT_KIND.DISCUSSION && state.ready;

    return (
        <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} defaultColorScheme="auto">
            <Stack component="main" gap={0} h="100%">
                {/* Persistent live region: the lookup resolves after the panel
                    is already open, and only an existing container announces
                    that change reliably. */}
                <Box role="status">
                    {status !== null
                        ? (
                                <Stack gap="xs" p="md">
                                    <Text c="dimmed" size="sm">{status}</Text>
                                    <Anchor href={HN_ORIGIN} target="_blank" rel="noreferrer" size="sm">
                                        {t('side_panel_open_on_hn')}
                                    </Anchor>
                                </Stack>
                            )
                        : null}
                </Box>
                {showFrame && state.content?.kind === SIDE_PANEL_CONTENT_KIND.DISCUSSION
                    ? (
                            <iframe
                                className="discussion-frame"
                                src={discussionUrl(state.content.itemId)}
                                title={t('popup_heading')}
                            />
                        )
                    : null}
            </Stack>
        </MantineProvider>
    );
}
