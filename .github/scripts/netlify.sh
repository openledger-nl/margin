#!/bin/sh
# Asks Netlify to rebuild the website, which downloads the newest extension files. Needs NETLIFY_BUILD_HOOK.
if [ -z "${NETLIFY_BUILD_HOOK:-}" ]; then
  echo "::notice::Website not rebuilt. Add the NETLIFY_BUILD_HOOK secret (a build hook from Netlify) to do that after each release."
  exit 0
fi
curl -sS --fail-with-body -X POST -d '{}' "$NETLIFY_BUILD_HOOK" >/dev/null && echo "Netlify rebuild requested."
