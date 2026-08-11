# Releasing

Store submissions are built by one deterministic pipeline: the same commit always produces byte-identical packages, artifacts carry checksums and provenance, and the GitHub release is created only from a signed tag. Nothing in the pipeline is paid or phones home, and no credentials exist in the repository.

## Artifacts

`pnpm package` writes everything to `build/artifacts`:

| File | Purpose |
| --- | --- |
| `hn-split-chrome-<version>.zip` | Chrome Web Store package |
| `hn-split-edge-<version>.zip` | Microsoft Edge Add-ons package; produced separately so its locale inventory and future store-specific changes do not depend on the Chrome archive |
| `hn-split-firefox-<version>.zip` | Firefox package for addons.mozilla.org with the transformed manifest (event-page background, `options_ui`, gecko id, no `sidePanel`) |
| `hn-split-source-<version>.zip` | Source archive for add-on review: every tracked file at the packaged commit |
| `SHA256SUMS` | Checksums in `shasum -a 256 --check` format |
| `provenance.json` | Unsigned in-toto/SLSA v1 statement recording artifact digests, the source commit, and the builder |

The unpacked per-browser builds live in `build/<target>` (`chrome`, `edge`, `firefox`).

Release packages contain the 40 release-reviewed languages named by
`SHIPPED_LOCALES` in `src/shared/locales.ts`. The Chrome archive uses 41 physical
`_locales` directories because Norwegian Bokmål ships as runtime `nb` plus a
byte-identical Web Store `no` alias; Edge and Firefox use the 40 reviewed source
directories directly. English is authored, Russian is hand-reviewed, and the
other 38 translations pass the independent multilingual semantic QA documented
in `docs/locales.md`. Packaging verifies the exact per-target inventory and the
Chrome alias bytes before creating each store archive.

The MVP runtime stays Chrome (see `AGENTS.md`): the Edge and Firefox packages exist so store submissions never depend on local untracked steps, while cross-browser runtime QA is tracked separately. The Firefox manifest requires Firefox 140 or newer and declares `data_collection_permissions.required: ["browsingActivity", "websiteContent"]`: current or navigated tab URLs, canonical link URLs, and user-selected link URLs can be sent to Algolia as required lookup candidates. No optional data collection or telemetry is declared.

## Reproducibility

A clean checkout of the same commit produces identical packages because every input is pinned:

- Node comes from `.node-version` and pnpm from the `packageManager` field; installs use the committed lockfile.
- Zips are built in pure JavaScript (`fflate`), with entries sorted byte-wise, pinned compression settings, and every entry stamped with the committer time of `HEAD` instead of the clock. `scripts/package.mjs` pins `TZ=UTC` because zip timestamps are timezone-sensitive.
- `provenance.json` is run metadata (it records when and where a build ran), so it is deliberately excluded from reproducibility comparisons.

Enforcement: the CI `package` job rebuilds and requires identical checksums on every change, and the release workflow packages twice from two separate clean checkouts and requires identical bytes before publishing.

To verify a published release independently:

```bash
git clone https://github.com/maximtop/hn-split && cd hn-split
git checkout vX.Y.Z
pnpm install --frozen-lockfile
pnpm package
shasum -a 256 --check <(curl -fsSL <release>/SHA256SUMS)
unzip -Z1 build/artifacts/hn-split-chrome-*.zip \
  | sed -n 's#^_locales/\([^/]*\)/messages.json$#\1#p' \
  | sort
```

The final command prints the 40 codes in `LOCALE_REGISTRY` plus the generated
Norwegian `no` alias (41 directories representing 40 languages).

## Versioning and changelog

- `version` in `package.json` is the single source of truth. Generated manifests receive it at build time; `public/manifest.json` intentionally has no `version` key.
- Versions are three dot-separated integers (store requirement). Bump with `pnpm version patch|minor|major --no-git-tag-version` in a normal PR.
- `CHANGELOG.md` follows Keep a Changelog: collect notes under `## [Unreleased]` during development, and move them into `## [X.Y.Z] - YYYY-MM-DD` in the release PR. The release workflow uses that section as the release body via `scripts/release-notes.mjs` and fails when it is missing.

## Cutting a release

1. Open a release PR: bump the version, move the Unreleased changelog notes into the new version section, merge to `master`.
2. Tag the release commit with a signed tag and push it:

   ```bash
   git tag -s vX.Y.Z -m "HN Split X.Y.Z"
   git push origin vX.Y.Z
   ```

3. The `Release` workflow then, in order: verifies the tag is annotated and signed by a key registered on the repository owner's GitHub account (`scripts/verify-signed-tag.sh`), requires the tag to match `package.json`, extracts the changelog section, runs `pnpm check`, packages everything, repeats the packaging from a second clean checkout and requires identical bytes, uploads the artifacts, attests provenance (public repositories only — GitHub does not sign attestations for private repositories on the free plan; the unsigned `provenance.json` is always produced), and publishes the GitHub release with the artifacts and notes.
4. When Chrome auto-deployment is enabled, the release workflow calls `Deploy Chrome Web Store`. It downloads the just-published Chrome ZIP and checksums, verifies the exact checksum and manifest version, uploads that version, and submits it for review. Chrome publishes it automatically after approval; review itself remains asynchronous.

### One-time signing setup

The workflow accepts SSH or PGP tag signatures. SSH is the least ceremony — reuse an existing SSH key:

```bash
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global tag.gpgSign true
```

Then add that public key on GitHub under **Settings → SSH and GPG keys → New SSH key** with key type **Signing Key** (the same key can be registered for both authentication and signing; verification uses the signing-key list only).

## Dry run

Run the workflow manually (**Actions → Release → Run workflow**, or `gh workflow run Release`). A manual run is always a dry run: it executes the full pipeline — checks, packaging, and the two-checkout reproducibility comparison — and uploads the `hn-split-packages` workflow artifact, but verifies no tag, creates no release, and attests nothing. A missing changelog section only warns in dry runs.

Local packaging (`pnpm package`) is the same build; it warns when tracked files have uncommitted changes, and the workflows pass `--require-clean` to turn that into an error.

## Chrome Web Store deployment

Chrome deployment is automated by `.github/workflows/deploy-chrome-store.yml`. A signed full release invokes it directly after GitHub Release creation, avoiding the GitHub limitation that events created with the workflow token do not start another workflow. The deploy workflow can also be run manually with an already-published `vX.Y.Z` tag, which is the retry path for an upload that was still processing or a release created before the automation existed.

The public listing is [Split for Hacker News](https://chromewebstore.google.com/detail/split-for-hacker-news/jmocibcalpebojmljmhlkeackggnkhfm). To deploy an existing release from the command line:

```bash
gh workflow run deploy-chrome-store.yml -f tag=v0.1.1
```

Before enabling automatic deployment, configure these GitHub Actions secrets:

- `CHROME_CLIENT_ID`
- `CHROME_CLIENT_SECRET`
- `CHROME_REFRESH_TOKEN`
- `CHROME_PUBLISHER_ID`

Configure these repository variables:

- `CHROME_APP_ID` — the public Chrome Web Store item ID.
- `CHROME_AUTO_DEPLOY_ENABLED=true` — lets signed tag releases invoke the deploy workflow. Leave it unset while credentials are being prepared; manual deploy runs remain available for validation.

The refresh token must authorize a Google account with access to the publisher. Its Google Cloud project must have the Chrome Web Store API enabled, and the OAuth grant must include the `https://www.googleapis.com/auth/chromewebstore` scope. Keep the consent screen in **In production**: refresh tokens issued while it is in **Testing** expire after seven days. Store values only in GitHub Actions secrets or an ignored local `.env`; never commit them or print them in workflow output.

The deploy workflow installs the pinned `go-webext` version, uses Chrome Web Store API v2, and fails closed unless upload output confirms both `Upload State: SUCCEEDED` and the exact release version. It calls publish without staged publishing, so approval makes the version public without a later dashboard click. Do not use the expedited-review option for ordinary feature releases.

Failure recovery:

- `invalid_grant`, `deleted_client`, or an authentication error means the OAuth client or refresh token must be renewed before retrying; no package is submitted.
- An upload that has not reached `SUCCEEDED` is not submitted. Wait for Chrome processing, then manually rerun `Deploy Chrome Web Store` with the same release tag.
- A review rejection requires addressing the store feedback and normally shipping a new version; a green workflow only proves successful submission, not approval.

## Other store submissions

Edge and Firefox submission remain manual, free steps using the artifacts produced by the release:

- **Edge Add-ons:** upload `hn-split-edge-<version>.zip` in Partner Center.
- **addons.mozilla.org:** upload `hn-split-firefox-<version>.zip`, attach `hn-split-source-<version>.zip` as the source archive, and point reviewers at `docs/development.md` (install and build need only `pnpm install --frozen-lockfile` and `pnpm package`).

## Secrets policy

Workflows reference secrets by name only, and no secret values are ever committed. Chrome deployment uses the four `CHROME_*` GitHub Actions secrets listed above; the public item ID and enable flag are repository variables. Any later Edge or Firefox automation must follow the same pattern, with credentials stored in Actions secrets and documentation containing names or `[REDACTED]` placeholders only.
