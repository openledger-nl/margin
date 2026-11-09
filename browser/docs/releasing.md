# Releasing: signing and stores

CI (`.github/workflows/ci.yml`) releases by itself on `main` when the version
changes (a `feat:` or `fix:` commit bumps it). It always makes the GitHub release.
The three jobs below join in once their keys are in GitHub. Without the keys they
are skipped with a notice in the run, nothing fails.

Where to put the keys: GitHub repo, **Settings**, **Secrets and variables**,
**Actions**. "Secret" means the **Secrets** tab, "variable" the **Variables** tab.

| Target | What users get | You need | One-time by hand |
|---|---|---|---|
| npm | `npx -y browser-review-mcp@latest` | npm account | publish the first version |
| Firefox | signed `.xpi` on the GitHub release, installs permanently | addons.mozilla.org account | nothing |
| Chrome Web Store | install from the store (Chrome, Brave, Edge) | Chrome Web Store developer account ($5 once), Google Cloud project | create the store listing |

## Why "signing" differs per browser

- **Firefox** only installs add-ons signed by Mozilla (except temporary ones in
  `about:debugging`). Mozilla signs without a public listing ("unlisted"): CI
  uploads the add-on, Mozilla's automatic review passes it in minutes, and you
  get a signed `.xpi`. Anyone can install that by opening it in Firefox.
- **Chrome, Brave, Edge** have no self-signing that works: they block extensions
  from outside their store (only **Load unpacked** in developer mode, or company
  policies). "Signed" there means published in the Chrome Web Store, which signs
  it. Brave installs from the Chrome Web Store too. Edge also has its own store
  (Microsoft Partner Center); not wired up.
- **npm** packages are not signed by you, but CI publishes with **provenance**:
  npm shows that the package was built from this repo by this workflow.

## npm

1. Make an account on [npmjs.com](https://www.npmjs.com/signup) and turn on 2FA
   (Account, Two-Factor Authentication).
2. Publish the first version by hand. npm can't set up trusted publishing for a
   package that does not exist yet. With the work committed:

   ```sh
   npm login
   pnpm publish:mcp
   ```

3. Let CI publish from now on, without a token: on npmjs.com open the package,
   **Settings**, **Trusted Publisher**, **GitHub Actions**, and fill in:
   - Organization or user: `andor00`
   - Repository: `browser-review-mcp`
   - Workflow filename: `ci.yml`
   - Environment: leave empty

   Then, under **Publishing access**, choose "Require two-factor authentication
   and disallow tokens" so only CI and you (with 2FA) can publish.

Instead of 2 and 3: a granular access token (npmjs.com, Access Tokens,
"Generate New Token", Granular, read and write for `browser-review-mcp` or for
all packages if it doesn't exist yet) as secret **`NPM_TOKEN`**. That also works
for the very first publish, but a token can leak; trusted publishing can't.

## Firefox (Mozilla signing)

1. Sign in on [addons.mozilla.org](https://addons.mozilla.org/developers/) with a
   Mozilla account and accept the developer agreement.
2. Open [API keys](https://addons.mozilla.org/developers/addon/api/key/) and
   generate credentials.
3. Add two secrets:
   - **`AMO_JWT_ISSUER`**: the "JWT issuer" (looks like `user:12345:67`)
   - **`AMO_JWT_SECRET`**: the "JWT secret"

Each release then gets `browser-review-<version>-firefox.xpi`. CI sends the
repo's source along (`git archive`), because the add-on is bundled and Mozilla
may review it against the source. Build steps for a reviewer: `pnpm install`,
`pnpm package` (Node 26, pnpm).

Notes:
- The add-on ID is `browser-review@andor00` (`extension/build.ts`). It is fixed
  on addons.mozilla.org after the first upload.
- Every upload needs a higher version. CI only signs new releases, so that holds.
- Self-distributed add-ons don't update by themselves: users install the new
  `.xpi` from the release. (Automatic updates need an `update_url`; can be added.)
- A public listing on addons.mozilla.org (searchable, auto-updates) is the
  `listed` channel instead; it needs a listing page and a human review.

## Chrome Web Store (Chrome, Brave, Edge users)

One-time, by hand:

1. Register at the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole)
   (one-time $5 fee). The Google account needs 2-step verification.
2. **New item**, upload `browser-review-<version>-chrome.zip` from a GitHub
   release, and fill in:
   - **Store listing**: description, category (Developer Tools), at least one
     screenshot (1280x800), the 128px icon is in the zip.
   - **Privacy**: single purpose ("review your own web app in development and send
     the comments to Claude Code"), and why each permission is needed:
     - `tabs`: find the tab of a comment's page, show where it can run
     - `storage`: remember overlay settings per site
     - `alarms`: reconnect to Claude Code when the browser wakes the extension
     - `sidePanel`: show the review threads in the browser's side panel, next to the page
     - `scripting`: load the overlay on the sites the user turns on
     - host access (all sites): `captureVisibleTab` screenshots need it, and
       the overlay runs on the user's dev sites: local addresses and dev domains
       by default, other sites only after the user turns them on (strict mode:
       localhost only)
     - data use: collects nothing, sends nothing off the machine
   - **Distribution**: Public, or Unlisted (only people with the link).
3. Submit for review. The first review can take days; broad host access means
   a closer look.
4. Note the **item ID** (32 letters, in the item's URL) and your **publisher ID**
   (dashboard, Account).

For CI uploads (Chrome Web Store API):

5. In [Google Cloud Console](https://console.cloud.google.com/), create a project,
   enable the **Chrome Web Store API**, set up the OAuth consent screen
   (External, add yourself as test user), and create an **OAuth client ID** of
   type **Desktop app**.
6. Get a refresh token for scope `https://www.googleapis.com/auth/chromewebstore`
   while signed in with the store's Google account, for example with the
   [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/)
   (gear icon: "Use your own OAuth credentials", fill in the client ID and
   secret; enter the scope by hand; "Exchange authorization code for tokens").
   Set the consent screen to "In production", or the refresh token stops
   working after 7 days.
7. Add secrets **`CWS_CLIENT_ID`**, **`CWS_CLIENT_SECRET`**, **`CWS_REFRESH_TOKEN`**,
   and variables **`CWS_PUBLISHER_ID`** and **`CWS_EXTENSION_ID`**.

Each release is then uploaded and submitted for review. It goes live when the
review passes (usually within a day for updates).

## Checking a release

The run page on GitHub (Actions, CI) shows each job. Skipped stores show a
notice saying which keys are missing. The release page lists the files:
`-chrome.zip`, `-firefox.zip`, `-firefox.xpi` (when signed) and the MCP `.tgz`.
