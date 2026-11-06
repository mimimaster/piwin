# Context overflow research probes

Date: 2026-11-06. This directory contains diagnostic research artifacts, not a production fix.

- `probe.mjs`: real Pi SDK sessions using an in-memory synthetic credential store, an empty resource loader, and a replaced local model stream. It never requests an actual model completion or reads a real conversation.
- `pi-probe-results.json`: 12 recorded runs across 0.84.2, 0.84.4, 0.86.0 and 1.5.0.
- `omp-tests.txt`: final successful output of 32 original Oh My Pi 18.17.0 tests.

## Pi reproduction

Supply one or more absolute **package roots**, each containing `package.json` and `dist/index.js`:

```sh
node docs/research/agent-context-overflow/probe.mjs \
  --runtime 0.84.2=/absolute/path/to/pi-coding-agent \
  --runtime 1.5.0=/absolute/path/to/another/pi-coding-agent \
  --output /tmp/pi-context-overflow-results.json
```

Each root's package version must match its supplied label. The script also handles dependencies nested by npm shrinkwrap. For an isolated comparison installation, install a specific public version under a separate temporary prefix with install scripts disabled; do not change the project's lockfile just to run this probe.

The mock server rejects `ceil(JSON.stringify(messages).length / 4 + legacy system-prompt length / 4)` above its configured window. This is **not an actual tokenizer**, and generated usage numbers are synthetic. It measures sequencing/recovery under a deterministic size rule. Do not infer real model token counts from repeated strings.

Modes:

1. `threshold-burst`: a result fits after earlier history is summarized.
2. `oversized-retained-batch`: nine 120,000-character results can remain over budget after ordinary compaction.
3. `oversized-summary`: large user messages make the manual summarizer input too large.

Use the last `assistantStops` event to assess a conversational run. The active context can omit a failed attempt, so its last assistant message alone can conceal the final provider error.

## Oh My Pi test reproduction

The following matching versions were used: source tag `v18.17.0`, npm package `@oh-my-pi/pi-agent-core@18.17.0`, Bun 1.4.4. Only the core package and dependencies were installed in an isolated temporary prefix, with install scripts disabled.

Copy these original test files from that tag to a temporary test directory, preserving them unchanged:

- `packages/agent/test/compaction-oversized-input.test.ts`
- `packages/agent/test/shake.test.ts`
- `packages/agent/test/compaction-cut-point.test.ts`
- `packages/agent/test/helpers.ts`

Resolve `@oh-my-pi/*` to the matching published packages and the tests' relative `../src` to the published core's `src` directory. Then run:

```sh
bun test test/compaction-oversized-input.test.ts test/shake.test.ts test/compaction-cut-point.test.ts
```

The retained log is the final successful run after supplying the original `helpers.ts`. No upstream test body or core implementation was changed. No claim is made about the full OMP CLI/session-maintenance suite or piwin's SDK/worker/package integration.
