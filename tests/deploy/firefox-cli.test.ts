// @vitest-environment node

/**
 * @file Verify Firefox preflight and status orchestration with simulated AMO responses.
 */

import { createHash } from 'node:crypto';
import {
    appendFileSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
} from 'node:fs';
import path from 'node:path';

import AdmZip from 'adm-zip';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import { GECKO_ID, STORE_UPLOAD_DIRECTORY } from '../../scripts/deploy/constants';
import { AMO_STATUS } from '../../scripts/deploy/firefox';
import { AMO_OPERATION, run } from '../../scripts/deploy/firefox-cli';

vi.mock('node:fs', async (original) => ({
    ...await original<Record<string, unknown>>(),
    appendFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
}));
const env = {
    FIREFOX_CLIENT_ID: 'fixture-issuer',
    FIREFOX_CLIENT_SECRET: 'fixture-secret',
    FIREFOX_AMO_ID: 'fixture',
    VERSION: '1.2.3',
    GITHUB_OUTPUT: 'fixture-output',
    GITHUB_STEP_SUMMARY: 'fixture-summary',
};
const addon = {
    guid: GECKO_ID,
    slug: 'fixture',
    status: AMO_STATUS.Unreviewed,
    categories: ['appearance'],
};
const pending = {
    id: 123,
    version: '1.2.3',
    channel: 'listed',
    source: 'https://example.test/source.zip',
    file: { status: AMO_STATUS.Unreviewed },
};
const request = vi.fn<typeof fetch>();
const json = (value: unknown): Response => {
    return new Response(JSON.stringify(value));
};

/**
 * Build a minimal, genuinely Mozilla-signed-shaped XPI: a real zip with a matching manifest and a
 * signature envelope entry, the same fixture style `firefox.test.ts` uses for `verifySignedXpi`.
 *
 * @param version Version embedded in the fixture manifest.
 *
 * @returns Zip bytes accepted by `verifySignedXpi` as validly signed.
 */
const buildSignedXpi = (version: string): Buffer => {
    const zip = new AdmZip();
    zip.addFile('manifest.json', Buffer.from(JSON.stringify({
        manifest_version: 3,
        version,
        browser_specific_settings: { gecko: { id: GECKO_ID } },
        background: { scripts: ['background.js'] },
    })));
    zip.addFile('META-INF/mozilla.rsa', Buffer.from('synthetic signature envelope'));
    return zip.toBuffer();
};

/**
 * Hash fixture bytes in the format returned by AMO.
 *
 * @param bytes Fixture package bytes.
 *
 * @returns SHA-256 label and hexadecimal digest.
 */
const sha256 = (bytes: Buffer): string => {
    return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
};

beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', request);
    vi.mocked(readFileSync).mockReturnValue('Reproduce with pnpm install; pnpm release firefox');
    request.mockResolvedValueOnce(json(addon));
});
afterEach(() => {
    vi.unstubAllGlobals();
});

describe('Firefox deployment orchestration', () => {
    it.each(['', 'prefligth'])(
        'rejects invalid operation %j before contacting AMO',
        async (operation) => {
            await expect(run({ ...env, AMO_OPERATION: operation })).rejects
                .toThrow('Invalid AMO_OPERATION');
            expect(request).not.toHaveBeenCalled();
            expect(appendFileSync).not.toHaveBeenCalled();
            expect(writeFileSync).not.toHaveBeenCalled();
        },
    );
    it('permits one new version only when source reviewer notes are ready', async () => {
        request.mockResolvedValueOnce(new Response(null, { status: 404 }));
        await run({ ...env, AMO_OPERATION: AMO_OPERATION.Preflight });
        expect(appendFileSync).toHaveBeenCalledWith('fixture-output', 'submit=true\n');
        expect(request).toHaveBeenCalledTimes(2);
    });
    it('refuses new submission without reviewer notes', async () => {
        request.mockResolvedValueOnce(new Response(null, { status: 404 }));
        vi.mocked(readFileSync).mockReturnValue('');
        await expect(run({ ...env, AMO_OPERATION: AMO_OPERATION.Preflight })).rejects
            .toThrow('AMO_REVIEW.md');
        expect(appendFileSync).not.toHaveBeenCalled();
    });
    it('skips an existing historical version without requiring new source notes', async () => {
        request.mockResolvedValueOnce(json(pending));
        await run({ ...env, AMO_OPERATION: AMO_OPERATION.Preflight });
        expect(readFileSync).not.toHaveBeenCalled();
        expect(appendFileSync).toHaveBeenCalledWith('fixture-output', 'submit=false\n');
    });
    it.each([undefined, AMO_OPERATION.Status])(
        'reports pending review in status mode %j',
        async (operation) => {
            request.mockResolvedValueOnce(json(pending));
            await run({ ...env, AMO_OPERATION: operation });
            expect(request).toHaveBeenCalledTimes(2);
            expect(writeFileSync).not.toHaveBeenCalled();
            expect(appendFileSync).toHaveBeenCalledWith(
                'fixture-summary',
                expect.stringContaining('awaiting Mozilla'),
            );
        },
    );
    it('never treats a status outage as permission to upload', async () => {
        request.mockResolvedValueOnce(new Response(null, { status: 503 }));
        await expect(run({ ...env, AMO_OPERATION: AMO_OPERATION.Preflight })).rejects
            .toThrow('HTTP 503');
        expect(appendFileSync).not.toHaveBeenCalled();
    });
    it('rejects an unexpected listing identity before looking up versions', async () => {
        request.mockReset().mockResolvedValueOnce(json({ ...addon, guid: 'wrong@test' }));
        await expect(run({ ...env, AMO_OPERATION: AMO_OPERATION.Preflight })).rejects
            .toThrow('Gecko ID mismatch');
        expect(request).toHaveBeenCalledTimes(1);
    });
    it('downloads, verifies and persists a publicly signed artifact', async () => {
        const bytes = buildSignedXpi(env.VERSION);
        const hash = sha256(bytes);
        const url = 'https://addons.mozilla.org/firefox/downloads/file/123/fixture.xpi';
        request.mockResolvedValueOnce(json({
            ...pending,
            file: { status: AMO_STATUS.Public, url, hash },
        }));
        request.mockResolvedValueOnce(new Response(new Uint8Array(bytes)));
        await run(env);
        expect(request).toHaveBeenCalledTimes(3);
        expect((request.mock.calls[2]?.[0] as URL).href).toBe(url);
        const output = path.join(STORE_UPLOAD_DIRECTORY, 'signed');
        expect(mkdirSync).toHaveBeenCalledWith(output, { recursive: true });
        expect(writeFileSync).toHaveBeenCalledWith(
            path.join(output, `firefox-${env.VERSION}.xpi`),
            bytes,
        );
        expect(writeFileSync).toHaveBeenCalledWith(
            path.join(output, 'SHA256SUMS.txt'),
            `${hash.slice('sha256:'.length)}  firefox-${env.VERSION}.xpi\n`,
        );
        expect(appendFileSync).toHaveBeenCalledWith('fixture-output', 'signed=true\n');
        expect(appendFileSync).toHaveBeenCalledWith(
            'fixture-summary',
            expect.stringContaining('Signed XPI verified'),
        );
    });
    it('rejects a signed artifact URL that is not https', async () => {
        request.mockResolvedValueOnce(json({
            ...pending,
            file: {
                status: AMO_STATUS.Public,
                url: 'http://addons.mozilla.org/firefox/downloads/file/123/fixture.xpi',
                hash: sha256(Buffer.from('irrelevant')),
            },
        }));
        await expect(run(env)).rejects.toThrow('Unexpected AMO download URL');
        expect(request).toHaveBeenCalledTimes(2);
        expect(mkdirSync).not.toHaveBeenCalled();
        expect(writeFileSync).not.toHaveBeenCalled();
    });
    it('rejects a signed artifact URL on an unexpected host', async () => {
        request.mockResolvedValueOnce(json({
            ...pending,
            file: {
                status: AMO_STATUS.Public,
                url: 'https://evil.example.com/firefox/downloads/file/123/fixture.xpi',
                hash: sha256(Buffer.from('irrelevant')),
            },
        }));
        await expect(run(env)).rejects.toThrow('Unexpected AMO download URL');
        expect(request).toHaveBeenCalledTimes(2);
        expect(mkdirSync).not.toHaveBeenCalled();
        expect(writeFileSync).not.toHaveBeenCalled();
    });
});
