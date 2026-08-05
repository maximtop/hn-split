import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';

import { collectDirectoryEntries, createDeterministicZip } from '../scripts/lib/deterministic-zip.ts';
import type { ZipEntry } from '../scripts/lib/deterministic-zip.ts';

const MTIME = new Date('2026-08-01T12:00:00Z');

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

const entry = (path: string, text: string): ZipEntry => ({ path, data: encode(text) });

describe('createDeterministicZip', () => {
    it('produces identical bytes regardless of entry order', () => {
        const first = createDeterministicZip(
            [entry('b.txt', 'beta'), entry('a/a.txt', 'alpha')],
            MTIME,
        );
        const second = createDeterministicZip(
            [entry('a/a.txt', 'alpha'), entry('b.txt', 'beta')],
            MTIME,
        );

        expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
    });

    it('applies the supplied timestamp: different mtimes change the bytes', () => {
        const entries = [entry('a.txt', 'alpha')];

        const first = createDeterministicZip(entries, MTIME);
        const second = createDeterministicZip(entries, new Date('2027-02-03T04:05:06Z'));

        // If fflate ever stopped honoring the per-entry mtime it would fall
        // back to the wall clock, and reproducibility would silently break.
        expect(Buffer.from(first).equals(Buffer.from(second))).toBe(false);
    });

    it('round-trips paths and contents', () => {
        const zipped = createDeterministicZip(
            [entry('nested/dir/file.js', 'code'), entry('manifest.json', '{}')],
            MTIME,
        );

        const unzipped = unzipSync(zipped);
        expect(Object.keys(unzipped).sort()).toEqual(['manifest.json', 'nested/dir/file.js']);
        expect(new TextDecoder().decode(unzipped['nested/dir/file.js'])).toBe('code');
    });

    it('rejects duplicate archive paths', () => {
        expect(() => createDeterministicZip(
            [entry('a.txt', 'one'), entry('a.txt', 'two')],
            MTIME,
        )).toThrow(/Duplicate archive path/);
    });
});

describe('collectDirectoryEntries', () => {
    let directory: string;

    afterEach(async () => {
        await rm(directory, { force: true, recursive: true });
    });

    it('collects nested files with forward-slash paths and ignores filesystem mtimes', async () => {
        directory = await mkdtemp(join(tmpdir(), 'hn-split-zip-test-'));
        await mkdir(resolve(directory, 'assets'), { recursive: true });
        await writeFile(resolve(directory, 'manifest.json'), '{}');
        await writeFile(resolve(directory, 'assets/app.js'), 'js');

        const first = createDeterministicZip(await collectDirectoryEntries(directory), MTIME);
        // A later checkout writes different filesystem timestamps; the
        // archive must not care.
        await utimes(resolve(directory, 'manifest.json'), new Date(), new Date());
        const second = createDeterministicZip(await collectDirectoryEntries(directory), MTIME);

        expect(Object.keys(unzipSync(first)).sort()).toEqual(['assets/app.js', 'manifest.json']);
        expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
    });
});
