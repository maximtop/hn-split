import {
    Button, Group, Paper, Stack, Text, Title,
} from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import * as v from 'valibot';

import { formatDiagnosticExport } from '../shared/diagnostic-export';
import { DIAGNOSTIC_REQUEST, diagnosticResponseSchema } from '../shared/diagnostic-protocol';
import { t } from '../shared/i18n';

import type { DiagnosticExport } from '../shared/diagnostic-export';
import type { DiagnosticTransport } from '../shared/diagnostic-protocol';
import type { MessageKey } from '../shared/i18n';

const DOWNLOAD_URL_LIFETIME_MS = 60_000;

/**
 * Downloads only in response to an explicit export action, without a new tab.
 *
 * @param file - Validated text and deterministic filename to offer locally.
 */
export function downloadDiagnostics(file: DiagnosticExport): void {
    const url = URL.createObjectURL(new Blob([file.text], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    try {
        anchor.href = url;
        anchor.download = file.filename;
        document.body.append(anchor);
        anchor.click();
    } finally {
        anchor.remove();
        // Give the browser time to consume the Blob; document teardown also
        // releases URLs if the options tab closes before this timeout.
        setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_LIFETIME_MS);
    }
}

/**
 * Supplies the runtime and local-download boundaries for diagnostics controls.
 */
export interface DiagnosticsSectionProps {
    /**
     * Sends diagnostic requests to the background worker.
     */
    send?: DiagnosticTransport;

    /**
     * Saves an explicitly requested local support bundle.
     */
    download?: (file: DiagnosticExport) => void;
}

const sendRuntime: DiagnosticTransport = async (request) => {
    const response: unknown = await chrome.runtime.sendMessage(request);
    return response;
};

/**
 * Displays session-log state and explicit export/clear actions with live feedback.
 *
 * @param props - Runtime and download adapters; the browser owns both in production.
 * @param props.send - Runtime transport for the options document.
 * @param props.download - Explicit local file-saving callback.
 */
export function DiagnosticsSection(
    { send = sendRuntime, download = downloadDiagnostics }: DiagnosticsSectionProps,
): React.JSX.Element {
    const [count, setCount] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);
    const [feedback, setFeedback] = useState<MessageKey | null>(null);
    const generation = useRef(0);
    useEffect(() => {
        const { current } = generation;
        let active = true;
        void send({ type: DIAGNOSTIC_REQUEST.SNAPSHOT }).then((raw) => {
            const response = v.parse(diagnosticResponseSchema, raw);
            if (!response.ok || response.buffer === undefined) {
                throw new Error('Diagnostic snapshot unavailable');
            }
            if (active && current === generation.current) {
                setCount(response.buffer.entries.length);
            }
        }).catch(() => {
            if (active && current === generation.current) {
                setFeedback('diagnostics_failure');
            }
        });
        return () => {
            active = false;
        };
    }, [send]);

    const perform = async (clear: boolean): Promise<void> => {
        generation.current += 1;
        setBusy(true);
        setFeedback(null);
        try {
            const response = v.parse(diagnosticResponseSchema, await send({
                type: clear ? DIAGNOSTIC_REQUEST.CLEAR : DIAGNOSTIC_REQUEST.SNAPSHOT,
            }));
            if (!response.ok) {
                throw new Error('Diagnostic operation failed');
            }
            if (clear) {
                setCount(0);
                setFeedback('diagnostics_cleared');
            } else {
                if (response.buffer === undefined) {
                    throw new Error('Diagnostic snapshot missing');
                }
                download(formatDiagnosticExport(response.buffer, chrome.runtime.getManifest().version, new Date()));
                setCount(response.buffer.entries.length);
                setFeedback('diagnostics_exported');
            }
        } catch {
            setFeedback('diagnostics_failure');
        } finally {
            setBusy(false);
        }
    };

    let summary: string | null = null;
    if (count !== null) {
        summary = count === 0 ? t('diagnostics_empty') : t('diagnostics_count', { count });
    } else if (feedback === null) {
        summary = t('diagnostics_loading');
    }

    return (
        <Paper withBorder radius="lg" p="xl" shadow="sm">
            <Stack gap="sm">
                <Title order={2} size="h4">{t('diagnostics_title')}</Title>
                <Text c="dimmed">{t('diagnostics_description')}</Text>
                <Text role="status" aria-live="polite">
                    {summary}
                    {feedback === null ? null : ` ${t(feedback)}` }
                </Text>
                <Group>
                    <Button disabled={busy} onClick={() => {
                        void perform(false);
                    }}>{t('diagnostics_export')}</Button>
                    <Button variant="default" disabled={busy} onClick={() => {
                        void perform(true);
                    }}>{t('diagnostics_clear')}</Button>
                </Group>
            </Stack>
        </Paper>
    );
}
