import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  // relative asset paths so the build works from file://, app:// (Electron) and any sub-path (GitHub Pages)
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  worker: { format: 'es' },
  // format decoders (HEIC wasm ≈2 MB) are lazy-loaded chunks, so a larger limit is fine
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2500 },
  test: { include: ['tests/**/*.test.ts'] },
});
