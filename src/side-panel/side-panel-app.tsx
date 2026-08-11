import {
    Alert,
    Anchor,
    Box,
    Button,
    MantineProvider,
    Stack,
    Text,
} from '@mantine/core';
import { useCallback, useEffect, useRef, useState } from 'react';

import { HN_LOOKUP_STATUS, HN_ORIGIN, discussionUrl } from '../domain/hn';
import { t } from '../shared/i18n';
import type { MessageKey } from '../shared/i18n';
import {
    FOLLOW_DIAGNOSTIC_CODE,
    FOLLOW_DIAGNOSTIC_EVENT,
    logDiagnostic,
    logDiagnosticWarning,
} from '../shared/logger';
import {
    BACKGROUND_REQUEST_TYPE,
    SIDE_PANEL_CONTEXT,
    SIDE_PANEL_DISCARD_TAB,
    SIDE_PANEL_KEEPALIVE,
    SIDE_PANEL_KEEPALIVE_INTERVAL_MS,
    SIDE_PANEL_PORT,
    SIDE_PANEL_READY,
    SIDE_PANEL_RECONNECT_DELAY_MS,
    SIDE_PANEL_RESET,
    SIDE_PANEL_TARGET,
    isSidePanelContentResponse,
    isSidePanelPortMessage,
} from '../shared/messages';
import { SIDE_PANEL_CONTENT_KIND } from '../shared/side-panel-content';
import type { SidePanelContent, SidePanelUnavailableReason } from '../shared/side-panel-content';
import {
    isSidePanelProjection,
    matchesReadyStamp,
} from '../shared/side-panel-projection';
import type {
    SidePanelProjection,
    SidePanelReadyStamp,
} from '../shared/side-panel-projection';
import { sidePanelContentKey } from '../shared/storage-keys';
import { cssVariablesResolver, theme } from '../shared/theme';
import {
    EMPTY_RETAINED_DISCUSSION_FRAMES,
    activateDiscussionFrame,
    discardDiscussionFramesForTab,
    discussionFrameKey,
} from './retained-discussion-frames';
import type { RetainedDiscussionFrameState } from './retained-discussion-frames';

const STATUS_ELEMENT_ID = 'side-panel-status';

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
 * Identifies a newer tab projection reserved by the background worker.
 */
interface SidePanelTarget {
    /**
     * Identifies the browser tab that must own the next visible projection.
     */
    tabId: number;
    /**
     * Sets the oldest projection revision allowed for the reserved tab.
     */
    minimumProjectionRevision: number;
}

/**
 * Names the trusted manual commands exposed by the side panel.
 */
type SidePanelActionType =
    | typeof BACKGROUND_REQUEST_TYPE.CHECK_ACTIVE_SIDE_PANEL_TAB
    | typeof BACKGROUND_REQUEST_TYPE.ENABLE_SIDE_PANEL_FOLLOW;

/**
 * Resolves the status line shown while no discussion frame can be displayed.
 * @param content - The current authoritative panel content.
 */
function statusMessage(content: SidePanelContent): string | null {
    if (content.kind === SIDE_PANEL_CONTENT_KIND.MANUAL_REQUIRED) {
        return t('side_panel_manual_required');
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
 * Determines whether one projection satisfies the latest reserved panel tab.
 * @param candidate - The projection being considered for display.
 * @param target - The reserved tab and minimum revision, when present.
 */
function projectionMatchesTarget(
    candidate: SidePanelProjection | null,
    target: SidePanelTarget | null,
): boolean {
    return target === null
        ? candidate !== null
        : candidate !== null
            && candidate.content.tabId === target.tabId
            && candidate.revision >= target.minimumProjectionRevision;
}

/**
 * Resolves the sole frame key authorized by current framing and target state.
 * @param candidate - The authoritative projection being considered.
 * @param framingReady - Whether the current framing session is ready.
 * @param target - The latest reserved tab and revision boundary.
 */
function visibleDiscussionFrameKey(
    candidate: SidePanelProjection | null,
    framingReady: boolean,
    target: SidePanelTarget | null,
): string | null {
    return framingReady
        && projectionMatchesTarget(candidate, target)
        && candidate?.content.kind === SIDE_PANEL_CONTENT_KIND.DISCUSSION
        ? discussionFrameKey(candidate.content)
        : null;
}

/**
 * Removes focus from the opaque retained document without inspecting it.
 */
function blurActiveFrame(): void {
    if (document.activeElement instanceof HTMLIFrameElement) {
        document.activeElement.blur();
    }
}

/**
 * Renders one window-bound Hacker News discussion session inside the browser
 * side panel without reading or restoring cross-origin document state.
 */
export function SidePanelApp(): React.JSX.Element {
    const [windowId, setWindowId] = useState<number | null>(null);
    const [projection, setProjection] = useState<SidePanelProjection | null>(null);
    const [framingReady, setFramingReady] = useState(false);
    const [target, setTarget] = useState<SidePanelTarget | null>(null);
    const [frameState, setFrameState] = useState<RetainedDiscussionFrameState>(
        EMPTY_RETAINED_DISCUSSION_FRAMES,
    );
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const projectionRef = useRef<SidePanelProjection | null>(null);
    const readyStampRef = useRef<SidePanelReadyStamp | null>(null);
    const framingReadyRef = useRef(false);
    const targetRef = useRef<SidePanelTarget | null>(null);
    const visibleFrameKeyRef = useRef<string | null>(null);
    const actionGeneration = useRef(0);
    const actionBusy = useRef(false);

    const applyProjection = useCallback((candidate: unknown): void => {
        if (!isSidePanelProjection(candidate)
            || candidate.revision <= (projectionRef.current?.revision ?? 0)) {
            return;
        }
        actionGeneration.current += 1;
        actionBusy.current = false;
        setBusy(false);
        setActionError(null);
        projectionRef.current = candidate;
        const becomesReady = !framingReadyRef.current
            && matchesReadyStamp(candidate, readyStampRef.current);
        if (becomesReady) {
            framingReadyRef.current = true;
            setFramingReady(true);
            logDiagnostic('side panel framing ready.', {
                tabId: candidate.content.tabId,
                revision: candidate.revision,
            });
        }
        const nextFrameKey = visibleDiscussionFrameKey(
            candidate,
            framingReadyRef.current || becomesReady,
            targetRef.current,
        );
        if (visibleFrameKeyRef.current !== nextFrameKey) {
            blurActiveFrame();
        }
        visibleFrameKeyRef.current = nextFrameKey;
        if (nextFrameKey !== null
            && candidate.content.kind === SIDE_PANEL_CONTENT_KIND.DISCUSSION) {
            const discussion = candidate.content;
            setFrameState((current) => activateDiscussionFrame(current, discussion));
        }
        setProjection(candidate);
        logDiagnostic('side panel projection loaded.', {
            revision: candidate.revision,
            tabId: candidate.content.tabId,
            kind: candidate.content.kind,
            ...(candidate.content.kind === SIDE_PANEL_CONTENT_KIND.UNAVAILABLE
                ? { reason: candidate.content.reason }
                : {}),
        });
    }, []);

    const resetLocalSession = useCallback((): void => {
        actionGeneration.current += 1;
        actionBusy.current = false;
        blurActiveFrame();
        readyStampRef.current = null;
        framingReadyRef.current = false;
        targetRef.current = null;
        visibleFrameKeyRef.current = null;
        setBusy(false);
        setActionError(null);
        setFramingReady(false);
        setTarget(null);
        setFrameState(EMPTY_RETAINED_DISCUSSION_FRAMES);
    }, []);

    useEffect(() => {
        let cancelled = false;
        let resolvedWindowId: number | null = null;

        /**
         * Applies a projection written directly to this window's session key.
         * @param changes - The session-storage changes delivered by Chrome.
         */
        function onChanged(changes: Record<string, chrome.storage.StorageChange>): void {
            if (resolvedWindowId === null) {
                return;
            }
            const change = changes[sidePanelContentKey(resolvedWindowId)];
            if (change !== undefined) {
                applyProjection(change.newValue);
            }
        }

        chrome.storage.session.onChanged.addListener(onChanged);
        void (async () => {
            let currentWindowId: number;
            try {
                const current = await chrome.windows.getCurrent();
                if (cancelled || current.id === undefined) {
                    return;
                }
                currentWindowId = current.id;
                resolvedWindowId = currentWindowId;
            } catch {
                if (!cancelled) {
                    logDiagnosticWarning(FOLLOW_DIAGNOSTIC_EVENT.INITIALIZATION_FAILED, {
                        code: FOLLOW_DIAGNOSTIC_CODE.INITIALIZATION_FAILED,
                    });
                }
                return;
            }

            try {
                const key = sidePanelContentKey(currentWindowId);
                const stored = await chrome.storage.session.get(key);
                if (!cancelled) {
                    applyProjection(stored[key]);
                }
            } catch {
                if (!cancelled) {
                    logDiagnosticWarning(FOLLOW_DIAGNOSTIC_EVENT.INITIALIZATION_FAILED, {
                        code: FOLLOW_DIAGNOSTIC_CODE.INITIALIZATION_FAILED,
                        windowId: currentWindowId,
                    });
                }
            } finally {
                if (!cancelled) {
                    setWindowId(currentWindowId);
                }
            }
        })();

        return () => {
            cancelled = true;
            chrome.storage.session.onChanged.removeListener(onChanged);
        };
    }, [applyProjection]);

    useEffect(() => {
        if (windowId === null) {
            return undefined;
        }
        const panelWindowId = windowId;
        let mounted = true;
        let activePort: chrome.runtime.Port | null = null;
        let keepAliveTimer: number | null = null;
        let reconnectTimer: number | null = null;

        /**
         * Stops heartbeats belonging to the current port, when present.
         */
        function clearKeepAliveTimer(): void {
            if (keepAliveTimer !== null) {
                window.clearInterval(keepAliveTimer);
                keepAliveTimer = null;
            }
        }

        /**
         * Stops a pending reconnect attempt, when present.
         */
        function clearReconnectTimer(): void {
            if (reconnectTimer !== null) {
                window.clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
        }

        /**
         * Schedules one bounded reconnect attempt while the panel is mounted.
         */
        function scheduleReconnect(): void {
            if (!mounted || reconnectTimer !== null) {
                return;
            }
            reconnectTimer = window.setTimeout(() => {
                reconnectTimer = null;
                connectPort();
            }, SIDE_PANEL_RECONNECT_DELAY_MS);
        }

        /**
         * Discards local framing state and schedules a replacement port.
         * @param port - The disconnected port to retire.
         */
        function handleDisconnect(port: chrome.runtime.Port): void {
            if (activePort !== port) {
                return;
            }
            activePort = null;
            clearKeepAliveTimer();
            if (!mounted) {
                return;
            }
            resetLocalSession();
            scheduleReconnect();
        }

        /**
         * Retires a port after a send failure so no framing owner is orphaned.
         * @param port - The port whose transport failed.
         */
        function disconnectAfterSendFailure(port: chrome.runtime.Port): void {
            handleDisconnect(port);
            try {
                port.disconnect();
            } catch {
                logDiagnosticWarning(FOLLOW_DIAGNOSTIC_EVENT.DISCONNECT_FAILED, {
                    code: FOLLOW_DIAGNOSTIC_CODE.DISCONNECT_FAILED,
                    windowId: panelWindowId,
                });
            }
        }

        /**
         * Sends one keepalive over the current port or retires that port.
         * @param port - The port whose worker lifetime is being extended.
         */
        function keepAlive(port: chrome.runtime.Port): void {
            if (!mounted || activePort !== port) {
                return;
            }
            try {
                port.postMessage({ type: SIDE_PANEL_KEEPALIVE });
            } catch {
                logDiagnosticWarning(FOLLOW_DIAGNOSTIC_EVENT.DISCONNECT_FAILED, {
                    code: FOLLOW_DIAGNOSTIC_CODE.DISCONNECT_FAILED,
                    windowId: panelWindowId,
                });
                disconnectAfterSendFailure(port);
            }
        }

        /**
         * Applies one strict lifecycle message from the current background port.
         * @param port - The port that delivered the message.
         * @param value - The unknown runtime value to validate.
         */
        function handlePortMessage(port: chrome.runtime.Port, value: unknown): void {
            if (activePort !== port || !isSidePanelPortMessage(value)) {
                return;
            }
            if (value.type === SIDE_PANEL_READY) {
                const stamp = {
                    tabId: value.tabId,
                    projectionRevision: value.projectionRevision,
                };
                readyStampRef.current = stamp;
                const candidate = projectionRef.current;
                if (!framingReadyRef.current && matchesReadyStamp(candidate, stamp)) {
                    framingReadyRef.current = true;
                    setFramingReady(true);
                    logDiagnostic('side panel framing ready.', {
                        tabId: stamp.tabId,
                        revision: stamp.projectionRevision,
                    });
                    const nextFrameKey = visibleDiscussionFrameKey(
                        candidate,
                        framingReadyRef.current,
                        targetRef.current,
                    );
                    if (visibleFrameKeyRef.current !== nextFrameKey) {
                        blurActiveFrame();
                    }
                    visibleFrameKeyRef.current = nextFrameKey;
                    if (nextFrameKey !== null
                        && candidate?.content.kind === SIDE_PANEL_CONTENT_KIND.DISCUSSION) {
                        const discussion = candidate.content;
                        setFrameState((current) => activateDiscussionFrame(
                            current,
                            discussion,
                        ));
                    }
                }
                return;
            }
            if (value.type === SIDE_PANEL_TARGET) {
                actionGeneration.current += 1;
                actionBusy.current = false;
                const nextTarget = {
                    tabId: value.tabId,
                    minimumProjectionRevision: value.minimumProjectionRevision,
                };
                const nextFrameKey = visibleDiscussionFrameKey(
                    projectionRef.current,
                    framingReadyRef.current,
                    nextTarget,
                );
                if (visibleFrameKeyRef.current !== nextFrameKey) {
                    blurActiveFrame();
                }
                visibleFrameKeyRef.current = nextFrameKey;
                targetRef.current = nextTarget;
                const candidate = projectionRef.current;
                if (nextFrameKey !== null
                    && candidate?.content.kind === SIDE_PANEL_CONTENT_KIND.DISCUSSION) {
                    const discussion = candidate.content;
                    setFrameState((current) => activateDiscussionFrame(current, discussion));
                }
                setBusy(false);
                setActionError(null);
                setTarget(targetRef.current);
                return;
            }
            if (value.type === SIDE_PANEL_DISCARD_TAB) {
                const currentContent = projectionRef.current?.content;
                if (currentContent?.kind === SIDE_PANEL_CONTENT_KIND.DISCUSSION
                    && currentContent.tabId === value.tabId) {
                    blurActiveFrame();
                    visibleFrameKeyRef.current = null;
                }
                setFrameState((current) => discardDiscussionFramesForTab(current, value.tabId));
                return;
            }
            if (value.type === SIDE_PANEL_RESET) {
                resetLocalSession();
            }
        }

        /**
         * Connects a fresh window-bound port and starts its heartbeat lifecycle.
         */
        function connectPort(): void {
            if (!mounted) {
                return;
            }
            resetLocalSession();
            let port: chrome.runtime.Port;
            try {
                port = chrome.runtime.connect({ name: SIDE_PANEL_PORT });
            } catch {
                logDiagnosticWarning(FOLLOW_DIAGNOSTIC_EVENT.INITIALIZATION_FAILED, {
                    code: FOLLOW_DIAGNOSTIC_CODE.INITIALIZATION_FAILED,
                    windowId: panelWindowId,
                });
                scheduleReconnect();
                return;
            }
            activePort = port;
            port.onMessage.addListener((value: unknown) => {
                handlePortMessage(port, value);
            });
            port.onDisconnect.addListener(() => {
                handleDisconnect(port);
            });
            try {
                port.postMessage({ type: SIDE_PANEL_CONTEXT, windowId: panelWindowId });
            } catch {
                logDiagnosticWarning(FOLLOW_DIAGNOSTIC_EVENT.INITIALIZATION_FAILED, {
                    code: FOLLOW_DIAGNOSTIC_CODE.INITIALIZATION_FAILED,
                    windowId: panelWindowId,
                });
                disconnectAfterSendFailure(port);
                return;
            }
            // Chrome 114+ no longer keeps an extension worker active merely
            // because a Port is open. Messages on that Port reset its idle
            // deadline while the framed panel stays connected.
            keepAlive(port);
            if (activePort === port) {
                keepAliveTimer = window.setInterval(() => {
                    keepAlive(port);
                }, SIDE_PANEL_KEEPALIVE_INTERVAL_MS);
            }
        }

        connectPort();
        return () => {
            mounted = false;
            actionGeneration.current += 1;
            actionBusy.current = false;
            clearKeepAliveTimer();
            clearReconnectTimer();
            const port = activePort;
            activePort = null;
            port?.disconnect();
        };
    }, [resetLocalSession, windowId]);

    const targetMatches = projectionMatchesTarget(projection, target);
    const initialized = framingReady && targetMatches;
    const visibleContent = initialized ? projection?.content ?? null : null;
    const desiredFrameKey = visibleContent?.kind === SIDE_PANEL_CONTENT_KIND.DISCUSSION
        ? discussionFrameKey(visibleContent)
        : null;

    const runPanelAction = useCallback(async (type: SidePanelActionType): Promise<void> => {
        if (windowId === null || actionBusy.current) {
            return;
        }
        actionBusy.current = true;
        const generation = actionGeneration.current + 1;
        actionGeneration.current = generation;
        setBusy(true);
        setActionError(null);
        try {
            const response: unknown = await chrome.runtime.sendMessage({ type, windowId });
            if (!isSidePanelContentResponse(response) || !response.ok) {
                throw new Error('Side panel action failed');
            }
        } catch {
            if (actionGeneration.current === generation) {
                logDiagnosticWarning(FOLLOW_DIAGNOSTIC_EVENT.ACTION_FAILED, {
                    code: FOLLOW_DIAGNOSTIC_CODE.ACTION_FAILED,
                    windowId,
                });
                setActionError(t('side_panel_action_failed'));
            }
        } finally {
            if (actionGeneration.current === generation) {
                actionBusy.current = false;
                setBusy(false);
            }
        }
    }, [windowId]);

    const status = visibleContent === null ? null : statusMessage(visibleContent);
    const activeFrameKey = desiredFrameKey !== null
        && frameState.frames.some((frame) => frame.key === desiredFrameKey)
        ? desiredFrameKey
        : null;

    return (
        <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} defaultColorScheme="auto">
            <Stack component="main" gap={0} h="100%">
                <Box
                    aria-atomic="true"
                    aria-live="polite"
                    id={STATUS_ELEMENT_ID}
                    role="status"
                >
                    {status === null
                        ? null
                        : (
                                <Stack gap="xs" p="md">
                                    <Text c="dimmed" size="sm">{status}</Text>
                                </Stack>
                            )}
                </Box>
                {visibleContent?.kind === SIDE_PANEL_CONTENT_KIND.MANUAL_REQUIRED
                    ? (
                            <Stack gap="xs" p="md">
                                <Button
                                    aria-describedby={STATUS_ELEMENT_ID}
                                    disabled={busy}
                                    fullWidth
                                    onClick={() => void runPanelAction(
                                        BACKGROUND_REQUEST_TYPE.CHECK_ACTIVE_SIDE_PANEL_TAB,
                                    )}
                                >
                                    {t('side_panel_check_this_tab')}
                                </Button>
                                <Button
                                    aria-describedby={STATUS_ELEMENT_ID}
                                    disabled={busy}
                                    fullWidth
                                    variant="default"
                                    onClick={() => void runPanelAction(
                                        BACKGROUND_REQUEST_TYPE.ENABLE_SIDE_PANEL_FOLLOW,
                                    )}
                                >
                                    {t('side_panel_follow_tabs_automatically')}
                                </Button>
                            </Stack>
                        )
                    : null}
                {visibleContent?.kind === SIDE_PANEL_CONTENT_KIND.UNAVAILABLE
                    && visibleContent.reason === HN_LOOKUP_STATUS.ERROR
                    ? (
                            <Box p="md">
                                <Button
                                    aria-describedby={STATUS_ELEMENT_ID}
                                    disabled={busy}
                                    fullWidth
                                    onClick={() => void runPanelAction(
                                        BACKGROUND_REQUEST_TYPE.CHECK_ACTIVE_SIDE_PANEL_TAB,
                                    )}
                                >
                                    {t('side_panel_retry')}
                                </Button>
                            </Box>
                        )
                    : null}
                {status === null
                    ? null
                    : (
                            <Box px="md" pb="md">
                                <Anchor
                                    c="brand.7"
                                    href={HN_ORIGIN}
                                    target="_blank"
                                    rel="noreferrer"
                                    size="sm"
                                >
                                    {t('side_panel_open_on_hn')}
                                </Anchor>
                            </Box>
                        )}
                <Box className="discussion-frame-stack">
                    {frameState.frames.map((frame) => {
                        const active = frame.key === activeFrameKey;
                        return (
                            <iframe
                                key={frame.key}
                                aria-hidden={!active}
                                className="discussion-frame"
                                hidden={!active}
                                inert={!active}
                                src={discussionUrl(frame.itemId)}
                                tabIndex={active ? 0 : -1}
                                title={t('popup_heading')}
                            />
                        );
                    })}
                </Box>
                {actionError === null
                    ? null
                    : (
                            <Alert color="red" m="md" role="alert">
                                {actionError}
                            </Alert>
                        )}
            </Stack>
        </MantineProvider>
    );
}
