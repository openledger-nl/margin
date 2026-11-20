#!/bin/sh
# Refreshes an extension's rolling release (never "Latest"), which the website downloads from by fixed names.
#   latest.sh <tag> <title> <version> <file=published-name>...
# The tag moves to this commit; the signed .xpi of the previous version is removed until the new one is signed.
set -eu
. "$(dirname "$0")/retry.sh"
tag=$1 title=$2 version=$3
shift 3
notes="The newest $title, version $version, under file names that don't change. Every version also has its own release."
if gh release view "$tag" >/dev/null 2>&1; then
  retry gh api -X PATCH "repos/$GITHUB_REPOSITORY/git/refs/tags/$tag" -f sha="$GITHUB_SHA" -F force=true >/dev/null
  retry gh release edit "$tag" --title "$title (newest: $version)" --notes "$notes" --latest=false
else
  retry gh release create "$tag" --target "$GITHUB_SHA" --title "$title (newest: $version)" --notes "$notes" --latest=false
fi
for xpi in $(gh release view "$tag" --json assets --jq '.assets[].name | select(endswith(".xpi"))'); do
  gh release delete-asset "$tag" "$xpi" --yes
done
dir=$(mktemp -d)
for pair in "$@"; do
  cp "${pair%%=*}" "$dir/${pair#*=}"
done
retry gh release upload "$tag" "$dir"/* --clobber
