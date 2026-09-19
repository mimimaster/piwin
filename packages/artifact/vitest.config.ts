import { defineConfig } from 'vitest/config';

/**
 * Artifact tests are also run directly from this package. Keep that path
 * under the same bounded, isolated worker policy as the Desktop suite.
 */
export default defineConfig({
  test: {
    maxWorkers: 2,
    minWorkers: 1,
    pool: 'forks',
    poolOptions: {
      forks: {
        isolate: true,
        execArgv: ['--max-old-space-size=1536'],
      },
    },
  },
});
