/**
 * Escapes a literal string for embedding inside a regular expression.
 *
 * @param value Literal text.
 * @returns The escaped pattern fragment.
 */
function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extracts one version's section from a Keep a Changelog document for use as
 * the GitHub release body.
 *
 * @param changelog Full CHANGELOG.md content.
 * @param version Bare version such as `0.1.0` (no leading `v`).
 * @returns The section body with link-reference definitions removed and a
 * trailing newline.
 */
export function extractReleaseNotes(changelog: string, version: string): string {
    const headingPattern = new RegExp(`^## \\[${escapeRegExp(version)}\\](?:\\s.*)?$`, 'm');
    const match = headingPattern.exec(changelog);
    if (match === null) {
        throw new Error(
            `CHANGELOG.md has no "## [${version}]" section; `
            + 'move the Unreleased notes into one before releasing.',
        );
    }
    const start = match.index + match[0].length;
    const nextHeading = changelog.indexOf('\n## ', start);
    const section = changelog.slice(start, nextHeading === -1 ? undefined : nextHeading);
    const notes = section
        .split('\n')
        .filter((line) => !/^\[[^\]]+\]:\s/.test(line))
        .join('\n')
        .trim();
    if (notes === '') {
        throw new Error(`The "## [${version}]" changelog section is empty.`);
    }
    return `${notes}\n`;
}
