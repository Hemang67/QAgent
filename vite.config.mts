import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The window's UI. Loaded from files (base "./") in the built app.
export default defineConfig({
  root: 'src/ui',
  base: './',
  plugins: [react()],
  build: { outDir: '../../dist/ui', emptyOutDir: true, target: 'chrome130' },
  server: { port: 5199, strictPort: true },
});
