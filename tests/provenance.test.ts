import { describe, expect, it } from 'vitest';

import {
    LOCAL_BUILDER_ID,
    buildProvenanceStatement,
    readGithubRunContext,
} from '../scripts/lib/provenance.ts';

const GITHUB_ENVIRONMENT = {
    GITHUB_ACTIONS: 'true',
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_REPOSITORY: 'maximtop/hn-split',
    GITHUB_REF: 'refs/tags/v1.0.0',
    GITHUB_WORKFLOW_REF: 'maximtop/hn-split/.github/workflows/release.yml@refs/tags/v1.0.0',
    GITHUB_RUN_ID: '42',
    GITHUB_RUN_ATTEMPT: '2',
};

describe('readGithubRunContext', () => {
    it('returns undefined outside GitHub Actions', () => {
        expect(readGithubRunContext({})).toBeUndefined();
        expect(readGithubRunContext({ GITHUB_ACTIONS: 'false' })).toBeUndefined();
    });

    it('returns undefined when a required variable is missing', () => {
        const { GITHUB_RUN_ID: omitted, ...incomplete } = GITHUB_ENVIRONMENT;

        expect(omitted).toBeDefined();
        expect(readGithubRunContext(incomplete)).toBeUndefined();
    });

    it('captures the full run identity inside GitHub Actions', () => {
        expect(readGithubRunContext(GITHUB_ENVIRONMENT)).toEqual({
            serverUrl: 'https://github.com',
            repository: 'maximtop/hn-split',
            ref: 'refs/tags/v1.0.0',
            workflowRef: 'maximtop/hn-split/.github/workflows/release.yml@refs/tags/v1.0.0',
            runId: '42',
            runAttempt: '2',
        });
    });
});

describe('buildProvenanceStatement', () => {
    const subjects = [{ name: 'hn-split-chrome-1.0.0.zip', sha256: 'ab'.repeat(32) }];
    const startedOn = new Date('2026-08-05T10:00:00Z');

    it('records artifact digests and the GitHub run identity', () => {
        const statement = buildProvenanceStatement({
            subjects,
            gitCommit: 'deadbeef',
            startedOn,
            github: readGithubRunContext(GITHUB_ENVIRONMENT),
        });

        expect(statement['subject']).toEqual([
            { name: 'hn-split-chrome-1.0.0.zip', digest: { sha256: 'ab'.repeat(32) } },
        ]);
        expect(statement['predicateType']).toBe('https://slsa.dev/provenance/v1');
        const predicate = statement['predicate'] as {
            buildDefinition: {
                buildType: string;
                resolvedDependencies: Array<{ uri: string; digest: { gitCommit: string } }>;
            };
            runDetails: {
                builder: { id: string };
                metadata: { invocationId: string; startedOn: string };
            };
        };
        expect(predicate.buildDefinition.buildType)
            .toBe('https://github.com/maximtop/hn-split/.github/workflows/release.yml@refs/tags/v1.0.0');
        expect(predicate.buildDefinition.resolvedDependencies).toEqual([
            {
                uri: 'git+https://github.com/maximtop/hn-split@refs/tags/v1.0.0',
                digest: { gitCommit: 'deadbeef' },
            },
        ]);
        expect(predicate.runDetails.builder.id).toBe('https://github.com/maximtop/hn-split/actions/runs/42');
        expect(predicate.runDetails.metadata.invocationId)
            .toBe('https://github.com/maximtop/hn-split/actions/runs/42/attempts/2');
        expect(predicate.runDetails.metadata.startedOn).toBe('2026-08-05T10:00:00.000Z');
    });

    it('marks local builds instead of fabricating a runner identity', () => {
        const statement = buildProvenanceStatement({
            subjects,
            gitCommit: 'deadbeef',
            startedOn,
            github: undefined,
        });

        const predicate = statement['predicate'] as {
            buildDefinition: { buildType: string };
            runDetails: { builder: { id: string } };
        };
        expect(predicate.buildDefinition.buildType).toBe(LOCAL_BUILDER_ID);
        expect(predicate.runDetails.builder.id).toBe(LOCAL_BUILDER_ID);
    });
});
