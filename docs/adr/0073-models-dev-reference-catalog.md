# ADR 0073: models.dev is the Host reference catalog

- Status: accepted
- Date: 2026-09-21
- Related: [0056-provider-models-single-catalog.md](./0056-provider-models-single-catalog.md),
  [docs/specs/model-catalog-integration.md](../specs/model-catalog-integration.md)

## Context

Add-model autocomplete, Discover enrich, session `contextWindow` fallback, and
image-generation tagging all read a **reference** catalog. That catalog was a
process-lifetime projection of `@earendil-works/pi-ai` builtins (themselves a
build-time snapshot of models.dev, filtered to tool-calling models).

The writable catalog is still `config.providers[].models` (ADR 0056). The
confusion was several read-only tables (Pi chat, Pi images, video registry,
heuristics) being consulted at different times.

## Decision

1. **Writable catalog is unchanged**: `providers[].models`. Image/Video/Speech
   pages still do not add rows.

2. **Reference catalog is a Host snapshot of `https://models.dev/api.json`**,
   cached at `~/.piwin/model-catalog.json` (`getPiwinModelCatalogPath`).

3. **Sync is manual only.** IPC:
   - `models/catalog/search` — query the in-memory snapshot
   - `models/catalog/status` — `{ source, catalogVersion, fetchedAt?, entryCount, imageEntryCount }`
   - `models/catalog/sync` — GET models.dev, map, atomic write, `installModelCatalogSnapshot`
   Remote shells are allowed to call status/sync; they mutate the Host cache.

4. **No auto-fetch on boot or Settings open.** Boot loads the disk snapshot if
   valid; otherwise Pi builtins remain as **offline bootstrap**
   (`source: 'pi-bootstrap'`). A failed sync leaves the previous snapshot
   (or bootstrap) untouched.

5. **One in-memory table.** `searchPiCatalog` / `lookupCatalogByModelId` /
   `enrichFromCatalog` / `searchPiImagesCatalog` / `resolvePiModelLimits` all
   read the active snapshot. Image rows are models whose
   `modalities.output` includes `image`.

6. **Video wire defaults stay in** `VIDEO_GENERATION_MODEL_REGISTRY`.
   models.dev has no `apiStyle` / path for piwin adapters.

7. **Discover still live-fetches the provider** `/models`. Catalog only fills
   missing limits and tags.

## Consequences

- Settings → Models shows 「同步模型目录」 and last-synced status.
- First launch before any sync still autocompletes from Pi builtins.
- Catalog freshness is user-controlled, not tied to `@earendil-works/pi-ai`
  upgrades.
