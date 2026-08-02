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
    createTheme,
} from '@mantine/core';
import { useEffect, useState } from 'react';

import type { HnDiscussion, HnLookupResult } from '../domain/hn';
import { readPageContext } from '../page/context';
import { t } from '../shared/i18n';
import { isLookupResponse, isOpenDiscussionResponse } from '../shared/messages';
import type { LookupRequest, OpenDiscussionRequest } from '../shared/messages';

/** Stores the popup's asynchronous lookup and opening state. */
interface PopupState {
    /** Identifies the article tab whose discussion will be opened. */
    articleTabId: number | null;
    /** Contains the validated Hacker News lookup result. */
    result: HnLookupResult | null;
    /** Contains the current user-facing error message. */
    error: string | null;
    /** Indicates whether the initial lookup is still running. */
    loading: boolean;
    /** Identifies the discussion currently being opened. */
    openingId: string | null;
}

/** Describes a discussion action rendered in the popup. */
interface DiscussionButtonProps {
    /** Contains the discussion metadata shown to the user. */
    discussion: HnDiscussion;
    /** Indicates whether this is the primary ranked discussion. */
    primary: boolean;
    /** Disables the action while another discussion is opening. */
    opening: boolean;
    /** Opens the selected Hacker News discussion. */
    onOpen: () => void;
}

const initialState: PopupState = {
    articleTabId: null,
    result: null,
    error: null,
    loading: true,
    openingId: null,
};

const theme = createTheme({
    primaryColor: 'orange',
});

/** Sends a typed request to the extension background worker. */
async function sendMessage(request: LookupRequest | OpenDiscussionRequest): Promise<unknown> {
    return chrome.runtime.sendMessage(request);
}

/** Renders one primary or alternative Hacker News discussion action. */
function DiscussionButton({
    discussion,
    primary,
    opening,
    onOpen,
}: DiscussionButtonProps): React.JSX.Element {
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
                <Text c="orange.7" fw={700} size="xs">
                    {t(primary ? 'open_discussion' : 'open_alternative')}
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

/** Renders and coordinates the HN Split browser-action popup. */
export function App(): React.JSX.Element {
    const [state, setState] = useState<PopupState>(initialState);

    useEffect(() => {
        let cancelled = false;
        const load = async (): Promise<void> => {
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tab?.id === undefined) {
                    throw new Error(t('no_active_tab'));
                }
                const injections = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: readPageContext,
                });
                const result = injections[0]?.result;
                if (result === undefined) {
                    throw new Error(t('page_not_inspectable'));
                }
                const response = await sendMessage({ type: 'lookup', context: result });
                if (!isLookupResponse(response)) {
                    throw new Error(t('invalid_extension_response'));
                }
                if (!response.ok) {
                    throw new Error(response.error);
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
                if (!cancelled) {
                    setState({
                        articleTabId: null,
                        result: null,
                        error: error instanceof Error ? error.message : t('unable_to_inspect'),
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
                type: 'open_discussion',
                articleTabId: state.articleTabId,
                itemId,
            });
            if (!isOpenDiscussionResponse(response)) {
                throw new Error(t('invalid_extension_response'));
            }
            setState((current) => ({
                ...current,
                openingId: null,
                error: response.ok ? null : response.error,
            }));
        } catch (error) {
            const reason = error instanceof Error ? error.message : t('extension_no_response');
            setState((current) => ({
                ...current,
                openingId: null,
                error: t('unable_to_open_discussion', { reason }),
            }));
        }
    };

    const found = state.result?.status === 'found' ? state.result : null;

    return (
        <MantineProvider theme={theme} defaultColorScheme="auto">
            <Box component="main" p="md" w={380}>
                <Stack gap="md">
                    <Box component="header">
                        <Text c="orange.7" fw={800} size="xs" tt="uppercase">HN Split</Text>
                        <Title order={1} size="h3">{t('popup_heading')}</Title>
                    </Box>

                    {state.loading && <Text className="status" c="dimmed">{t('checking_article')}</Text>}
                    {state.error !== null && (
                        <Alert className="status status--error" color="red">{state.error}</Alert>
                    )}
                    {state.result?.status === 'restricted' && (
                        <Text className="status" c="dimmed">{t('restricted_page')}</Text>
                    )}
                    {state.result?.status === 'not_found' && (
                        <Text className="status" c="dimmed">{t('discussion_not_found')}</Text>
                    )}
                    {state.result?.status === 'error' && (
                        <Alert className="status status--error" color="red">{t('lookup_failed')}</Alert>
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
