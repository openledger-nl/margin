#!/bin/sh
# Signs a Firefox build with Mozilla (unlisted: no public listing, installs in one click from a download).
#   sign-firefox.sh <firefox.zip> <out.xpi>     needs WEB_EXT_API_KEY, WEB_EXT_API_SECRET and ./source.zip
set -eu
work=$(mktemp -d)
mkdir "$work/firefox" "$work/signed"
unzip -q "$1" -d "$work/firefox"
npx --yes web-ext sign \
  --channel=unlisted \
  --source-dir "$work/firefox" \
  --artifacts-dir "$work/signed" \
  --upload-source-code source.zip \
  --approval-timeout 2400000
mv "$work"/signed/*.xpi "$2"
