import { defineConfig } from 'vitest/config';
import unitConfig from './vitest.config.js';

export default defineConfig({
  ...unitConfig,
  test: {
    ...unitConfig.test,
    include: ['test/database.integration.spec.ts'],
    exclude: [],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 30000,
    hookTimeout: 10000,
  },
});
