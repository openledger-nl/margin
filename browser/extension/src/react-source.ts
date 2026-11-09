// Finds the app's own source file in a React 19 dev stack (fiber._debugStack).
// Kept free of DOM globals so it can be unit tested in Node.

/** Frames from React itself, Vite internals and pre-bundled dependencies. */
const SKIP_FRAME = /\/node_modules\/|\/\.vite\/deps\/|\/@react-refresh|\/@vite\/|react-dom|react_jsx|jsx-dev-runtime|chunk-[A-Z0-9]+\.js/i;

export function fromStack(stack: string | undefined): string | null {
  if (!stack) return null;
  for (const line of stack.split('\n').slice(1)) {
    const m = /(https?:\/\/[^\s)]+?):(\d+):\d+\)?\s*$/.exec(line.trim());
    if (!m?.[1] || SKIP_FRAME.test(m[1])) continue;
    try {
      const u = new URL(m[1]);
      return `${u.pathname.replace(/^\//, '')}:${m[2]}`;
    } catch {
      continue;
    }
  }
  return null;
}

