#!/usr/bin/env bash
# Verifies that a release tag is an annotated tag whose signature matches a
# signing key registered on the repository owner's GitHub account. The
# release workflow runs this before building anything, so an unsigned or
# foreign-signed tag never produces artifacts. Requires git, gh
# (authenticated through GH_TOKEN), and gpg for PGP signatures.
set -euo pipefail

TAG="${1:?usage: verify-signed-tag.sh <tag> <owner>}"
OWNER="${2:?usage: verify-signed-tag.sh <tag> <owner>}"

fail() {
    echo "error: $*" >&2
    exit 1
}

TAG_TYPE="$(git cat-file -t "refs/tags/${TAG}" 2>/dev/null)" || fail "tag ${TAG} was not fetched"
[ "${TAG_TYPE}" = "tag" ] || fail "tag ${TAG} is lightweight; create release tags with 'git tag -s'"

TAG_BODY="$(git cat-file tag "refs/tags/${TAG}")"

if printf '%s' "${TAG_BODY}" | grep -q -- '-----BEGIN SSH SIGNATURE-----'; then
    # git matches the allowed-signers principal against the tagger email, so
    # bind the principal to the email recorded in the tag itself; trust comes
    # from the key list, which is fetched from the owner's GitHub account.
    PRINCIPAL="$(printf '%s' "${TAG_BODY}" | sed -n 's/^tagger .*<\(.*\)>.*/\1/p' | head -n 1)"
    [ -n "${PRINCIPAL}" ] || fail "could not read the tagger email from tag ${TAG}"
    SIGNERS_FILE="$(mktemp)"
    trap 'rm -f "${SIGNERS_FILE}"' EXIT
    gh api --paginate "users/${OWNER}/ssh_signing_keys" --jq '.[].key' \
        | while IFS= read -r key; do
            printf '%s %s\n' "${PRINCIPAL}" "${key}"
        done > "${SIGNERS_FILE}"
    [ -s "${SIGNERS_FILE}" ] \
        || fail "github.com/${OWNER} has no SSH signing keys registered (Settings → SSH and GPG keys → New SSH key, type: Signing Key)"
    git -c gpg.ssh.allowedSignersFile="${SIGNERS_FILE}" verify-tag "${TAG}" \
        || fail "the SSH signature on ${TAG} does not match any signing key registered on github.com/${OWNER}"
elif printf '%s' "${TAG_BODY}" | grep -q -- '-----BEGIN PGP SIGNATURE-----'; then
    KEYRING_DIR="$(mktemp -d)"
    trap 'rm -rf "${KEYRING_DIR}"' EXIT
    curl -fsSL "https://github.com/${OWNER}.gpg" | GNUPGHOME="${KEYRING_DIR}" gpg --quiet --import \
        || fail "could not import GPG keys registered on github.com/${OWNER}"
    GNUPGHOME="${KEYRING_DIR}" git verify-tag "${TAG}" \
        || fail "the PGP signature on ${TAG} does not match any GPG key registered on github.com/${OWNER}"
else
    fail "tag ${TAG} is not signed; create release tags with 'git tag -s'"
fi

echo "Tag ${TAG} carries a valid signature from a key registered on github.com/${OWNER}."
