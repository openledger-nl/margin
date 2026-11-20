// /help: a short page for customers who open it from the feedback toolbar.
export const HELP_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Giving feedback</title>
<style>
  :root { color-scheme: light dark; --fg: #1b1b1f; --muted: #5d5d66; --bg: #fbfbfc; --line: #e3e3e8; }
  @media (prefers-color-scheme: dark) { :root { --fg: #ececf1; --muted: #a2a2ad; --bg: #141418; --line: #2c2c33; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.55 system-ui, sans-serif; }
  main { max-width: 640px; margin: 0 auto; padding: 40px 16px 64px; }
  h1 { font-size: 1.6rem; margin: 0 0 8px; }
  h2 { font-size: 1.1rem; margin: 28px 0 6px; }
  p, li { color: var(--muted); }
  strong { color: var(--fg); }
  ol { padding-left: 1.2rem; }
  .note { border-top: 1px solid var(--line); margin-top: 32px; padding-top: 16px; font-size: .9rem; }
</style>
</head>
<body>
<main>
  <h1>Giving feedback on this site</h1>
  <p>You opened this site with a personal review link. The toolbar on the page sends your feedback straight to the team that builds it.</p>
  <h2>Leave feedback</h2>
  <ol>
    <li><strong>On one part of the page:</strong> click the pick button, then the text, button or image you mean, and type what should change.</li>
    <li><strong>On the whole page:</strong> use the page comment button.</li>
    <li>A screenshot of what you saw goes along, so the team sees exactly what you mean.</li>
  </ol>
  <h2>Follow up</h2>
  <p>Open the threads in the toolbar to see each comment's status. <strong>In progress</strong> means someone is working on it. <strong>Review ready</strong> means it was fixed: check the page, then accept it, or reopen it and say what is still wrong.</p>
  <p class="note">Your name comes from your review link and is shown with your comments. Your feedback is stored by the team that sent you the link, not by a third party. Lost the link, or want access removed? Ask that team.</p>
</main>
</body>
</html>
`;
