import { defineConfig } from 'vitest/config';

// agent-host tests create real HostRuntime instances with mock sessions that
// schedule async operations (title generation, transcript recording, event
// forwarding). When test files run in parallel, the increased event-loop
// contention causes timing-sensitive assertions in session-chat-ops.test.ts
// to race. Running files in a single fork eliminates the contention without
// slowing down the common case.
export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
