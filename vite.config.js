import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2020',
    sourcemap: true,
  },
  server: {
    host: true,
    port: 5173,
  },
});
