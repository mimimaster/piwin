# LanceDB desktop sidecar spike

| Field | Value |
|-------|-------|
| Date | 2026-08-16 |
| Isolated dir | `/tmp/lancedb-sidecar-spike-51054` (not in repo) |
| Package | `@lancedb/lancedb@0.37.1` |
| Sidecar Node | v24.11.1 |
| Host | darwin arm64 |

## What ran

1. `npm install @lancedb/lancedb` in an isolated directory (not workspace `package.json`).
2. Create table, FTS index, vector search, hybrid (`fullTextSearch` + `nearestTo`).
3. CJK queries: `间隔重复`, `遗忘`.

## Native

- Required: yes. Optional dep `@lancedb/lancedb-darwin-arm64`.
- Binary: `lancedb.darwin-arm64.node` ≈ **216 MiB** (226_754_448 bytes).
- Published optional packages (not all installed here):

  - `@lancedb/lancedb-darwin-arm64`
  - `@lancedb/lancedb-linux-x64-gnu`
  - `@lancedb/lancedb-linux-arm64-gnu`
  - `@lancedb/lancedb-linux-x64-musl`
  - `@lancedb/lancedb-linux-arm64-musl`
  - `@lancedb/lancedb-win32-x64-msvc`
  - `@lancedb/lancedb-win32-arm64-msvc`

No darwin-x64 optional package listed in 0.37.1 `optionalDependencies`. Intel Mac would need a follow-up check before we claim three-platform desktop.

## Search results

| Query | Default FTS (`simple` / English) | FTS `baseTokenizer: "icu"` |
|-------|----------------------------------|----------------------------|
| `spaced repetition` | hit c1 | hit c1 |
| `间隔重复` | **empty** | hit c2 |
| `遗忘` | **empty** | hit c2 |
| vector `[0.1,0.2,0.3,0.4]` | c1, c3 | — |
| hybrid English + vector | c1, c3, c2 | — |

`Index.fts({ language: "Chinese" })` **panics** the native addon (`unknown variant Chinese`). Use ICU tokenizer with `stem: false` and `removeStopWords: false`.

## Decision

**A** — accept LanceDB native in the desktop sidecar.

Conditions for P3:

- Depend on `@lancedb/lancedb` only after this appendix exists.
- Ship **one** platform `.node` per sidecar build, not every optional package.
- FTS must use `Index.fts({ baseTokenizer: "icu", stem: false, removeStopWords: false })`. Default English tokenizer is not acceptable for CJK.
- ~216 MiB native binary is a packaging cost, not an A-failure. Record it in the sidecar bundling checklist.

B/C not needed unless Intel Mac or a target platform lacks a prebuild.
