import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      // SWC uses lowercase targets; decorator settings come from tsconfig.json.
      jsc: { target: 'es2023' },
    }),
  ],
  test: {
    environment: 'node',
    globals: false,
    clearMocks: true,
    include: ['src/**/*.spec.ts'],
    exclude: ['test/**', 'node_modules/**', 'dist/**'],
  },
});
