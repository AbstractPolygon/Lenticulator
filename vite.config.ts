import { defineConfig } from 'vite';

export default defineConfig({
  // relative asset paths so the build works from file://, app:// (Electron) and any sub-path (GitHub Pages)
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true },
  test: { include: ['tests/**/*.test.ts'] },
});
