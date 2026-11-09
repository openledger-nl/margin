import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // The git tests create real repositories; Windows antivirus can make that slow.
    testTimeout: 30_000,
  },
});
