import {
    Alert,
    Box,
    Button,
    Divider,
    MantineProvider,
    Stack,
    Text,
    Title,
    UnstyledButton,
} from '@mantine/core';
import { useEffect, useState } from 'react';

import { HN_LOOKUP_STATUS } from '../domain/hn';
import type { HnDiscussion, HnLookupResult } from '../domain/hn';
import { readPageContext } from '../page/context';
import { UserFacingError, messageKeyForBackgroundError, userFacingMessage } from '../shared/error-messages';
import { t } from '../shared/i18n';
import { logWarning } from '../shared/logger';
import { cssVariablesResolver, theme } from '../shared/theme';
import {
    BACKGROUND_REQUEST_TYPE,
    isLookupResponse,
    isOpenDiscussionResponse,
} from '../shared/messages';
import type { LookupRequest, OpenDiscussionRequest, SidePanelSelectRequest } from '../shared/messages';

/**
 * Stores the popup's asynchronous lookup and opening state.
 */
interface PopupState {
    /**
     * Identifies the article tab whose discussion will be opened.
     */
    articleTabId: number | null;
    /**
     * Contains the validated Hacker News lookup result.
     */
    result: HnLookupResult | null;
    /**
     * Contains the current user-facing error message.
     */
    error: string | null;
    /**
     * Indicates whether the initial lookup is still running.
     */
    loading: boolean;
    /**
     * Identifies the discussion currently being opened.
     */
    openingId: string | null;
}

/**
 * Describes a discussion action rendered in the popup.
 */
interface DiscussionButtonProps {
    /**
     * Contains the discussion metadata shown to the user.
     */
    discussion: HnDiscussion;
    /**
     * Indicates whether this is the primary ranked discussion.
     */
    primary: boolean;
    /**
     * Disables the action while another discussion is opening.
     */
    opening: boolean;
    /**
     * Opens the selected Hacker News discussion.
     */
    onOpen: () => void;
}

const initialState: PopupState = {
    articleTabId: null,
    result: null,
    error: null,
    loading: true,
    openingId: null,
};

/**
 * Sends a typed request to the extension background worker.
 * @param request - The typed background request to send.
 */
async function sendMessage(
    request: LookupRequest | OpenDiscussionRequest | SidePanelSelectRequest,
): Promise<unknown> {
    return chrome.runtime.sendMessage(request);
}

/**
 * Renders one primary or alternative Hacker News discussion action.
 * @param props - The discussion and interaction state to render.
 */
function DiscussionButton(props: DiscussionButtonProps): React.JSX.Element {
    const {
        discussion,
        primary,
        opening,
        onOpen,
    } = props;
    return (
        <UnstyledButton
            className="discussion"
            disabled={opening}
            onClick={onOpen}
            p="sm"
            style={(mantineTheme) => ({
                border: `1px solid ${mantineTheme.colors.gray[3]}`,
                borderRadius: mantineTheme.radius.md,
            })}
        >
            <Stack gap={4} align="flex-start">
                <Text c="brand.7" fw={700} size="xs">
                    {t(primary ? 'open_primary_discussion' : 'open_alternative')}
                </Text>
                <Text fw={700} size="sm">{discussion.title}</Text>
                <Text c="dimmed" size="xs">
                    {t('discussion_metrics', {
                        comments: String(discussion.comments),
                        points: String(discussion.points),
                    })}
                </Text>
            </Stack>
        </UnstyledButton>
    );
}

/**
 * Renders and coordinates the HN Split browser-action popup.
 */
export function App(): React.JSX.Element {
    const [state, setState] = useState<PopupState>(initialState);

    useEffect(() => {
        let cancelled = false;
        const load = async (): Promise<void> => {
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tab?.id === undefined) {
                    throw new UserFacingError(t('no_active_tab'));
                }
                const injections = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: readPageContext,
                });
                const result = injections[0]?.result;
                if (result === undefined) {
                    throw new UserFacingError(t('page_not_inspectable'));
                }
                const response = await sendMessage({
                    type: BACKGROUND_REQUEST_TYPE.LOOKUP,
                    context: result,
                });
                if (!isLookupResponse(response)) {
                    throw new UserFacingError(t('invalid_extension_response'));
                }
                if (!response.ok) {
                    throw new UserFacingError(t(messageKeyForBackgroundError(response.error)));
                }
                if (!cancelled) {
                    setState({
                        articleTabId: tab.id,
                        result: response.result,
                        error: null,
                        loading: false,
                        openingId: null,
                    });
                }
            } catch (error) {
                logWarning('popup lookup failed.', error);
                if (!cancelled) {
                    setState({
                        articleTabId: null,
                        result: null,
                        error: userFacingMessage(error, 'unable_to_inspect'),
                        loading: false,
                        openingId: null,
                    });
                }
            }
        };
        void load();
        return () => {
            cancelled = true;
        };
    }, []);

    const open = async (itemId: string): Promise<void> => {
        if (state.articleTabId === null) {
            return;
        }
        setState((current) => ({ ...current, openingId: itemId, error: null }));
        try {
            const response = await sendMessage({
                type: BACKGROUND_REQUEST_TYPE.OPEN_DISCUSSION,
                articleTabId: state.articleTabId,
                itemId,
            });
            if (!isOpenDiscussionResponse(response)) {
                throw new UserFacingError(t('invalid_extension_response'));
            }
            setState((current) => ({
                ...current,
                openingId: null,
                error: response.ok ? null : t(messageKeyForBackgroundError(response.error)),
            }));
        } catch (error) {
            logWarning('opening the discussion failed.', error);
            const reason = userFacingMessage(error, 'extension_no_response');
            setState((current) => ({
                ...current,
                openingId: null,
                error: t('unable_to_open_discussion', { reason }),
            }));
        }
    };

    const openInSidePanel = (itemId: string): void => {
        if (state.articleTabId === null) {
            return;
        }
        // chrome.sidePanel.open must run inside the click gesture, so the panel
        // is opened first and the selection is recorded right after; the panel
        // reads it once its own page loads.
        void chrome.sidePanel.open({ tabId: state.articleTabId });
        void (async () => {
            // The popup lives in the same window as the article tab it inspected.
            const { id: windowId } = await chrome.windows.getCurrent();
            if (windowId === undefined) {
                return;
            }
            await sendMessage({
                type: BACKGROUND_REQUEST_TYPE.SELECT_SIDE_PANEL_DISCUSSION,
                itemId,
                windowId,
            });
        })().catch((error: unknown) => {
            logWarning('selecting the side panel discussion failed.', error);
        });
    };

    const found = state.result?.status === HN_LOOKUP_STATUS.FOUND ? state.result : null;

    return (
        <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} defaultColorScheme="auto">
            <Box component="main" p="md" w={380}>
                <Stack gap="md">
                    <Box component="header">
                        <Text c="brand.7" fw={800} size="xs" tt="uppercase">{t('extension_name')}</Text>
                        <Title order={1} size="h3">{t('popup_heading')}</Title>
                    </Box>

                    {/* Persistent live region: async status changes are announced
                        reliably only when the container already exists. */}
                    <Box role="status">
                        {state.loading && <Text className="status" c="dimmed">{t('checking_article')}</Text>}
                        {state.result?.status === HN_LOOKUP_STATUS.RESTRICTED && (
                            <Text className="status" c="dimmed">{t('restricted_page')}</Text>
                        )}
                        {state.result?.status === HN_LOOKUP_STATUS.NOT_FOUND && (
                            <Text className="status" c="dimmed">{t('discussion_not_found')}</Text>
                        )}
                    </Box>
                    {state.error !== null && (
                        <Alert className="status status--error" color="red" role="alert">{state.error}</Alert>
                    )}
                    {state.result?.status === HN_LOOKUP_STATUS.ERROR && (
                        <Alert className="status status--error" color="red" role="alert">
                            {t('lookup_error')}
                        </Alert>
                    )}

                    {found !== null && (
                        <Stack component="section" gap="xs" aria-label={t('discussion_results')}>
                            <DiscussionButton
                                discussion={found.primary}
                                opening={state.openingId !== null}
                                primary
                                onOpen={() => { void open(found.primary.id); }}
                            />
                            {found.alternatives.map((discussion) => (
                                <DiscussionButton
                                    discussion={discussion}
                                    key={discussion.id}
                                    opening={state.openingId !== null}
                                    primary={false}
                                    onOpen={() => { void open(discussion.id); }}
                                />
                            ))}
                            {/* The default variant keeps WCAG AA contrast in
                                both schemes; the brand-tinted light variant
                                does not. */}
                            <Button
                                variant="default"
                                size="compact-sm"
                                onClick={() => { openInSidePanel(found.primary.id); }}
                            >
                                {t('open_in_side_panel')}
                            </Button>
                        </Stack>
                    )}

                    <Divider />
                    <Box component="footer">
                        <Text c="dimmed" size="xs" mb="xs">{t('split_view_help')}</Text>
                        <Button
                            className="settings-link"
                            variant="subtle"
                            size="compact-sm"
                            px={0}
                            onClick={() => { void chrome.runtime.openOptionsPage(); }}
                        >
                            {t('availability_settings')}
                        </Button>
                    </Box>
                </Stack>
            </Box>
        </MantineProvider>
    );
}
