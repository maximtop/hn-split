import { DIAGNOSTIC_FORMAT_VERSION } from './diagnostics';
import type { DiagnosticBuffer } from './diagnostics';

/**
 * Contains a local support file ready for an explicit download.
 */
export interface DiagnosticExport {
    /**
     * Deterministic UTC filename identifying export time and extension version.
     */
    filename: string;
    /**
     * Versioned JSON-lines text with one metadata header followed by entries.
     */
    text: string;
}

/**
 * Formats a validated snapshot without URLs, environment fingerprints or settings.
 * @param buffer - Snapshot returned by the background-owned collector.
 * @param version - Version from the extension's own generated manifest.
 * @param exportedAt - UTC export time, supplied explicitly for reproducible formatting.
 */
export function formatDiagnosticExport(buffer: DiagnosticBuffer, version: string, exportedAt: Date): DiagnosticExport {
    const timestamp = exportedAt.toISOString();
    const stamp = `${timestamp.slice(0, 10).replaceAll('-', '')}_${timestamp.slice(11, 19).replaceAll(':', '')}`;
    const header = { formatVersion: DIAGNOSTIC_FORMAT_VERSION, extensionVersion: version, exportedAt: timestamp };
    return {
        filename: `${stamp}_hn_split_v${version}.txt`,
        text: [JSON.stringify(header), ...buffer.entries.map((entry) => JSON.stringify(entry))].join('\n') + '\n',
    };
}
