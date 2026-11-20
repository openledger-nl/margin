import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fromStack } from './react-source.ts';

describe('fromStack', () => {
  it('skips React and Vite deps and returns the app file with line', () => {
    const stack = [
      'Error: react-stack-top-frame',
      '    at exports.jsxDEV (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=1a2b3c:250:30)',
      '    at CaseToolbar (http://localhost:5173/src/features/case/CaseToolbar.tsx?t=1730000000000:42:7)',
      '    at Object.react_stack_bottom_frame (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=1a2b3c:17424:20)',
    ].join('\n');
    assert.equal(fromStack(stack), 'src/features/case/CaseToolbar.tsx:42');
  });

  it('handles frames without a function name', () => {
    const stack = 'Error\n    at http://localhost:5173/src/App.tsx:12:3';
    assert.equal(fromStack(stack), 'src/App.tsx:12');
  });

  it('returns null when there is no app frame', () => {
    assert.equal(fromStack('Error\n    at x (http://localhost:5173/node_modules/.vite/deps/react.js:1:1)'), null);
    assert.equal(fromStack(undefined), null);
  });
});
