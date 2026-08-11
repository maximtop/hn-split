#!/usr/bin/env bash
set -euo pipefail

readonly RELEASE_TAG_PATTERN='^v[0-9]+\.[0-9]+\.[0-9]+$'

fail() {
    printf '%s\n' "$1" >&2
    exit 1
}

write_output() {
    printf '%s=%s\n' "$1" "$2" >> "$GITHUB_OUTPUT"
}

release_tag=${RELEASE_TAG:?RELEASE_TAG is required}
repository=${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"

if [[ ! "$release_tag" =~ $RELEASE_TAG_PATTERN ]]; then
    fail "Release tag must match vX.Y.Z: $release_tag"
fi

release_json=$(gh release view "$release_tag" \
    --repo "$repository" --json isDraft,isPrerelease)
if [[ $(jq -r '.isDraft' <<< "$release_json") != false ]]; then
    fail "Release $release_tag is a draft; publish it before deploying to the store"
fi
if [[ $(jq -r '.isPrerelease' <<< "$release_json") != false ]]; then
    fail "Release $release_tag is a pre-release; store deployment ships full releases only"
fi

write_output tag "$release_tag"
write_output version "${release_tag#v}"
write_output asset "hn-split-chrome-${release_tag#v}.zip"
