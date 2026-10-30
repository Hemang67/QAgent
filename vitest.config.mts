import { defineConfig } from 'vitest/config';

// Unit tests live in test/; vite.config.mts is only for the window's UI
export default defineConfig({ test: { root: '.', include: ['test/**/*.test.ts'] } });
