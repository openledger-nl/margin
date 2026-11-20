// The overview page customers open from their toolbar: /__margin/overview on the
// staging site, so overview.js reads their review token from the site's localStorage.
export const OVERVIEW_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Feedback overview</title>
  </head>
  <body>
    <div id="root"><p style="font: 15px system-ui, sans-serif; padding: 24px">Loading the feedback overview…</p></div>
    <script src="overview.js"></script>
  </body>
</html>
`;
