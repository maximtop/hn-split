import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import { zipSync } from 'fflate';
import type { Zippable } from 'fflate';

/**
 * One file to place into an archive.
 */
export interface ZipEntry {
    /**
     * Forward-slash archive path relative to the archive root.
     */
    path: string;

    /**
     * File content.
     */
    data: Uint8Array;
}

/**
 * Zip compression settings pinned so archives never vary with library
 * defaults: maximum deflate level and a fixed memory tier.
 */
const ZIP_COMPRESSION = { level: 9, mem: 8 } as const;

/**
 * Reads every file below a directory as archive entries.
 *
 * @param directory Directory whose contents become the archive root.
 * @returns Entries with forward-slash relative paths; order is not
 * significant because archiving sorts.
 */
export async function collectDirectoryEntries(directory: string): Promise<ZipEntry[]> {
    const dirents = await readdir(directory, { recursive: true, withFileTypes: true });
    const entries: ZipEntry[] = [];
    for (const dirent of dirents) {
        if (!dirent.isFile()) {
            continue;
        }
        const absolutePath = join(dirent.parentPath, dirent.name);
        entries.push({
            path: relative(directory, absolutePath).split(sep).join('/'),
            data: new Uint8Array(await readFile(absolutePath)),
        });
    }
    return entries;
}

/**
 * Builds a byte-reproducible zip: entries are sorted byte-wise, every entry
 * carries the same caller-supplied timestamp instead of the current time,
 * and compression settings are pinned. fflate compresses in pure JavaScript,
 * so the bytes do not depend on a system zlib version, but it stores
 * timestamps in local time — packaging sets TZ=UTC before zipping so the
 * stored fields are machine-independent.
 *
 * @param entries Files to archive.
 * @param mtime Timestamp recorded for every entry, normally the committer
 * time of the packaged commit.
 * @returns The zip file bytes.
 */
export function createDeterministicZip(entries: ZipEntry[], mtime: Date): Uint8Array {
    const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : 1));
    const files: Zippable = {};
    for (const [index, entry] of sorted.entries()) {
        if (index > 0 && sorted[index - 1]?.path === entry.path) {
            throw new Error(`Duplicate archive path: ${entry.path}`);
        }
        files[entry.path] = [entry.data, { ...ZIP_COMPRESSION, mtime }];
    }
    return zipSync(files);
}
