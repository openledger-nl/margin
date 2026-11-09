import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // The extension's code imports `vscode`, which only exists inside VS Code; tests get a stand-in.
    alias: { vscode: fileURLToPath(new URL('./src/test/vscode.ts', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.ts'],
    // The git tests create real repositories; Windows antivirus can make that slow.
    testTimeout: 30_000,
  },
});
