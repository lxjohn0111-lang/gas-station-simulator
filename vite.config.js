import { defineConfig } from 'vite';

// Relative base so the build works from any folder (CrazyGames uploads a zip).
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
    target: 'es2020',
  },
  server: { host: true, port: 5173 },
});
