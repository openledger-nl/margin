// /help: a short page for customers who open it from the feedback toolbar, in the
// company's own name and colors (brand.json) when it has them.
import { brandTokens } from '@brm/shared';

export const MARGIN_REPO = 'https://github.com/openledger-nl/margin';

export interface HelpBrand {
  name: string | null;
  color: string | null;
  logo: string | null;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function helpHtml(brand: HelpBrand): string {
  const t = brandTokens({ color: brand.color, toolbar: null });
  const accent = t['accent-text'] ?? '#23805a';
  const team = brand.name ? esc(brand.name) : 'the team';
  const logo = brand.logo ? `<img class="logo" src="${esc(brand.logo)}" alt="">` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Giving feedback${brand.name ? ` · ${esc(brand.name)}` : ''}</title>
<style>
  :root { --fg: #0e1016; --muted: #565c68; --bg: #f4f1ea; --card: #fff; --line: #e4e0d6; --accent: ${accent}; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.55 system-ui, sans-serif; }
  main { max-width: 640px; margin: 0 auto; padding: 40px 16px 64px; }
  header { display: flex; align-items: center; gap: 14px; margin-bottom: 8px; }
  .logo { width: 44px; height: 44px; object-fit: contain; }
  h1 { font-size: 1.6rem; margin: 0; }
  h2 { font-size: 1.1rem; margin: 28px 0 6px; }
  p, li { color: var(--muted); }
  strong { color: var(--fg); }
  ol { padding-left: 1.2rem; }
  li { margin-bottom: 6px; }
  kbd { font: 13px ui-monospace, monospace; padding: 1px 6px; border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 5px; background: var(--card); color: var(--fg); }
  .note { border-top: 1px solid var(--line); margin-top: 32px; padding-top: 16px; font-size: .9rem; }
  footer { margin-top: 32px; font-size: .8rem; color: var(--muted); }
  a { color: var(--accent); }
</style>
</head>
<body>
<main>
  <header>${logo}<h1>Giving feedback on this site</h1></header>
  <p>You opened this site with a personal review link. The toolbar on the page sends your feedback straight to ${team}.</p>
  <h2>Leave feedback</h2>
  <ol>
    <li><strong>On one part of the page:</strong> <strong>Pick element</strong> (<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>), click the text, button or image you mean, and type what should change. Or choose <strong>Remove</strong> if it should go.</li>
    <li><strong>On the whole page:</strong> <strong>Page comment</strong> (<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd>).</li>
    <li>A screenshot of what you saw goes along, so ${team} sees exactly what you mean.</li>
  </ol>
  <h2>Follow up</h2>
  <p><strong>Comments</strong> (<kbd>Alt</kbd>+<kbd>C</kbd>) shows each comment with the replies and its status. <strong>In progress</strong> means someone is working on it. <strong>Review ready</strong> means it was fixed: check the page, then accept it, or reopen it and say what is still wrong.</p>
  <p>The <strong>map</strong> button in the toolbar opens the overview: every page you looked at with what you said there (click one to go there; the ones from this session are marked), the pages ${team} asked you to look at, and <strong>Export PDF</strong>. Open it on a second screen: it updates by itself while you browse.</p>
  <p>If ${team} lets you see other reviewers' feedback, you still start with your own: <strong>Show all other feedback</strong> in the comments and the overview adds theirs.</p>
  <p class="note">Your name comes from your review link and is shown with your comments. Your feedback is stored by ${team}, the people who sent you the link, not by a third party. Lost the link, or want access removed? Ask them.</p>
  <footer>Powered by <a href="${MARGIN_REPO}" target="_blank" rel="noopener">Margin</a></footer>
</main>
</body>
</html>
`;
}
