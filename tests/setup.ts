import { vi } from 'vitest';

// Deploy tests run in the node environment (see tests/deploy), which has no window.
if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: vi.fn((query: string): MediaQueryList => ({
            matches: false,
            media: query,
            onchange: null,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn(() => false),
        })),
    });
}
