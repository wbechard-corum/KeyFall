import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));

// Where the songs API + mirror relay lives during development.
const BACKEND = process.env.KEYFALL_BACKEND || 'http://127.0.0.1:8081';

export default defineConfig({
  root: '.',
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
    sourcemap: true,
  },
  server: {
    host: true,
    port: 5173,
    // Without these, `npm run dev` serves the app but every /api call 404s
    // against Vite itself — the Songs tab and sheet-music view look broken
    // until you realise the backend is a separate process. Start it with
    // `npm run dev:server` (or `npm run dev:all` for both).
    proxy: {
      '/api': { target: BACKEND, changeOrigin: true },
      '/mirror/ws': { target: BACKEND, ws: true, changeOrigin: true },
    },
  },
});
