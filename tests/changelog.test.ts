import { describe, expect, it } from 'vitest';

import { extractReleaseNotes } from '../scripts/lib/changelog.ts';

const CHANGELOG = `# Changelog

Intro text.

## [Unreleased]

### Added

- Something in progress.

## [1.2.0] - 2026-08-01

### Added

- Side panel improvements.

### Fixed

- Badge cleanup on disable.

## [1.1.0] - 2026-07-01

### Added

- First automatic badge.

[1.2.0]: https://example.invalid/compare/v1.1.0...v1.2.0
[1.1.0]: https://example.invalid/compare/v1.0.0...v1.1.0
`;

describe('extractReleaseNotes', () => {
    it('extracts exactly one version section with a trailing newline', () => {
        const notes = extractReleaseNotes(CHANGELOG, '1.2.0');

        expect(notes).toBe(
            '### Added\n\n- Side panel improvements.\n\n### Fixed\n\n- Badge cleanup on disable.\n',
        );
    });

    it('extracts the final section and strips link-reference definitions', () => {
        const notes = extractReleaseNotes(CHANGELOG, '1.1.0');

        expect(notes).toBe('### Added\n\n- First automatic badge.\n');
        expect(notes).not.toContain('example.invalid');
    });

    it('fails when the version has no section yet', () => {
        expect(() => extractReleaseNotes(CHANGELOG, '2.0.0'))
            .toThrow(/no "## \[2\.0\.0\]" section/);
    });

    it('fails when the section exists but is empty', () => {
        const changelog = '# Changelog\n\n## [3.0.0] - 2026-01-01\n\n## [2.9.0] - 2025-12-01\n\n- Entry.\n';

        expect(() => extractReleaseNotes(changelog, '3.0.0')).toThrow(/section is empty/);
    });
});
