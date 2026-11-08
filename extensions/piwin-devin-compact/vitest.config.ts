import { defineConfig } from 'vitest/config';

export default defineConfig({
  cacheDir: '../../node_modules/.cache/piwin-devin-compact',
  test: {
    include: ['compact.test.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
