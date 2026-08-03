import { EXTENSION_BRAND } from './brand';

/**
 * Logs a recoverable failure with the brand prefix so extension entries stay
 * attributable in consoles shared with page scripts.
 * @param message - The human-readable failure description.
 * @param details - Optional error or context values appended to the entry.
 */
export function logWarning(message: string, ...details: unknown[]): void {
    console.warn(`${EXTENSION_BRAND}:`, message, ...details);
}
