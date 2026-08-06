/**
 * One artifact recorded in the provenance statement.
 */
export interface ProvenanceSubject {
    /**
     * Artifact file name.
     */
    name: string;

    /**
     * Hex SHA-256 digest of the artifact bytes.
     */
    sha256: string;
}

/**
 * GitHub Actions run identity captured from the workflow environment.
 */
export interface GithubRunContext {
    /**
     * Server origin such as https://github.com.
     */
    serverUrl: string;

    /**
     * owner/repository slug.
     */
    repository: string;

    /**
     * Fully qualified git ref that triggered the run.
     */
    ref: string;

    /**
     * Workflow file reference including the ref it ran at.
     */
    workflowRef: string;

    /**
     * Numeric run id.
     */
    runId: string;

    /**
     * Attempt counter within the run.
     */
    runAttempt: string;
}

/**
 * Marker recorded when packages are produced outside GitHub Actions.
 */
export const LOCAL_BUILDER_ID = 'local';

/**
 * Reads the GitHub Actions run identity from an environment map.
 *
 * @param environment Environment variables, normally process.env.
 * @returns The run context, or undefined outside GitHub Actions or when any
 * expected variable is missing.
 */
export function readGithubRunContext(
    environment: Record<string, string | undefined>,
): GithubRunContext | undefined {
    if (environment['GITHUB_ACTIONS'] !== 'true') {
        return undefined;
    }
    const serverUrl = environment['GITHUB_SERVER_URL'];
    const repository = environment['GITHUB_REPOSITORY'];
    const ref = environment['GITHUB_REF'];
    const workflowRef = environment['GITHUB_WORKFLOW_REF'];
    const runId = environment['GITHUB_RUN_ID'];
    const runAttempt = environment['GITHUB_RUN_ATTEMPT'];
    if (
        serverUrl === undefined
        || repository === undefined
        || ref === undefined
        || workflowRef === undefined
        || runId === undefined
        || runAttempt === undefined
    ) {
        return undefined;
    }
    return {
        serverUrl,
        repository,
        ref,
        workflowRef,
        runId,
        runAttempt,
    };
}

/**
 * Inputs for building a provenance statement.
 */
export interface ProvenanceInput {
    /**
     * Artifacts the statement attests to.
     */
    subjects: ProvenanceSubject[];

    /**
     * Commit the packages were built from.
     */
    gitCommit: string;

    /**
     * Moment the packaging run started; recorded verbatim, so the statement
     * itself is run metadata rather than a reproducible artifact.
     */
    startedOn: Date;

    /**
     * GitHub run identity, or undefined for local builds.
     */
    github: GithubRunContext | undefined;
}

/**
 * Builds an unsigned in-toto statement with a SLSA v1 provenance predicate
 * describing where the artifacts came from. On public repositories the
 * release workflow additionally produces a signed attestation via
 * actions/attest-build-provenance; this file stays useful as a free,
 * self-contained build record either way.
 *
 * @param input Artifact digests and build identity.
 * @returns A JSON-serializable statement object.
 */
export function buildProvenanceStatement(input: ProvenanceInput): Record<string, unknown> {
    const {
        subjects,
        gitCommit,
        startedOn,
        github,
    } = input;
    const repositoryUri = github === undefined
        ? LOCAL_BUILDER_ID
        : `${github.serverUrl}/${github.repository}`;
    return {
        _type: 'https://in-toto.io/Statement/v1',
        subject: subjects.map(({ name, sha256 }) => ({
            name,
            digest: { sha256 },
        })),
        predicateType: 'https://slsa.dev/provenance/v1',
        predicate: {
            buildDefinition: {
                buildType: github === undefined
                    ? LOCAL_BUILDER_ID
                    : `${github.serverUrl}/${github.workflowRef}`,
                externalParameters: {
                    repository: repositoryUri,
                    ref: github === undefined ? LOCAL_BUILDER_ID : github.ref,
                },
                resolvedDependencies: [
                    {
                        uri: github === undefined
                            ? LOCAL_BUILDER_ID
                            : `git+${repositoryUri}@${github.ref}`,
                        digest: { gitCommit },
                    },
                ],
            },
            runDetails: {
                builder: {
                    id: github === undefined
                        ? LOCAL_BUILDER_ID
                        : `${repositoryUri}/actions/runs/${github.runId}`,
                },
                metadata: {
                    invocationId: github === undefined
                        ? LOCAL_BUILDER_ID
                        : `${repositoryUri}/actions/runs/${github.runId}/attempts/${github.runAttempt}`,
                    startedOn: startedOn.toISOString(),
                },
            },
        },
    };
}
