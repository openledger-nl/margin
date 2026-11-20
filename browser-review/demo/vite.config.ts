import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * `pnpm demo:hub` (vite --mode hub): the demo as a staging site with the margin
 * review hub, like hub/README.md describes. The hub runs in Docker on port 4780
 * (docker-compose.yml here, its data in demo/.margin/):
 *
 *   docker compose -f demo/docker-compose.yml up -d --build
 *
 * /__margin/ goes to the hub (the nginx rule), and the page loads margin.js from it.
 */
function marginScript(): Plugin {
  return {
    name: 'margin-script',
    transformIndexHtml: () => [{ tag: 'script', attrs: { src: '/__margin/margin.js', defer: true }, injectTo: 'head' }],
  };
}

export default defineConfig(({ mode }) => {
  const hub = mode === 'hub';
  return {
    plugins: [react(), ...(hub ? [marginScript()] : [])],
    server: {
      host: 'localhost',
      port: 5173,
      open: false,
      // The hub's test data (docker-compose.yml) changes while you test: not part of the app.
      watch: { ignored: ['**/.margin/**'] },
      proxy: hub
        ? { '/__margin': { target: 'http://127.0.0.1:4780', rewrite: (path) => path.replace(/^\/__margin/, '') } }
        : undefined,
    },
  };
});
