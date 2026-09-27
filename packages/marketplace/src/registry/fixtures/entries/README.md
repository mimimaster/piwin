# Entry fixtures

- `valid/` — accepted by the CI (`scripts/lib/entry.mjs`) **and** by piwin's
  client parser (`packages/marketplace/src/registry/parse-registry-index.ts`).
- `invalid/` — rejected by both. One rule per file; `expectations.json` names
  the rule each file breaks. The shared rules: id format, owners, `https://github.com`
  repository, subdir inside the repository, full 40-hex commit, version format,
  and a fork that does not name itself.
- `invalid-strict/` — rejected by the CI only. piwin's parser normalizes these
  (lowercases owners, strips `.git`, ignores unknown keys) instead of dropping
  them, so what the CI admits is always a subset of what piwin reads.

piwin keeps a copy under `packages/marketplace/src/registry/fixtures/entries/`
and its test asserts the same accept/reject split. Update both together.
