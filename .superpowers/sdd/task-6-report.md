# Task 6 implementation report

## Scope

Implemented Task 6 only: Desktop video model discovery projection, recognized/suggested selector groups, route prefill, manual model entry, localized selector copy, and focused Desktop coverage. The existing Host `discoverProviderModels` callback and Task 5 normalized `videoGenerationSuggestion` contract are consumed as-is. No Svelte code or dependency was added.

## Changes

- `apps/desktop/src/video-model-discovery.ts`
  - Added pure `sortVideoDiscoveryModels()`.
  - Filters discovery rows without `videoGenerationSuggestion`, ranks models with the `video-generation` capability before heuristic-only suggestions, and sorts each rank by model ID.
  - Added pure `applyVideoDiscoverySuggestion()` for ID/API style/path/label form projection. It preserves an existing label and an existing non-empty path when the suggestion does not provide route metadata; it never writes config.
- `apps/desktop/src/video-model-discovery.test.ts`
  - Covers recognized-before-heuristic ranking, filtering, deterministic ordering, recognized route/label prefill, and explicit label/manual path preservation.
- `apps/desktop/src/video-model-suggest.tsx`
  - Added a controlled text input/combobox consuming `discoverProviderModels`.
  - Performs one discovery attempt per provider ID, caches successful/no-match/error outcomes, filters to normalized video suggestions, and supports arbitrary typed IDs.
  - Renders `Recognized` / `自动识别` before `Suggested` / `建议` groups. Recognized rows expose API style and route metadata; heuristic rows explain that selecting them adds a video model.
  - Selection returns a `DiscoveredModel`; it does not call `saveConfig`.
- `apps/desktop/src/video-model-suggest.test.tsx`
  - Covers one-call-per-provider discovery, ordering/grouping, metadata, exclusion of `video-understanding`, Sora and Veo prefill, heuristic selection before submit, manual custom IDs, and existing set-default/remove behavior.
- `apps/desktop/src/VideoGenerationModelForm.tsx`
  - Replaced only the video model ID input with `VideoModelSuggest` while retaining a controlled plain text entry path and existing form controls/save button.
- `apps/desktop/src/VideoGenerationSettings.tsx`
  - Obtains `discoverProviderModels`/`setError` from `useSettings()`.
  - Applies selector results through `applyVideoDiscoverySuggestion()` and keeps `buildVideoModelEntry()` as the only add/update config entry construction path. Existing set-default/remove/runtime handling is unchanged.
- `apps/desktop/src/desktop-locale.ts`
  - Added localized recognized/suggested group labels, heuristic-selection explanation, placeholder, loading, and empty-state copy in English and Simplified Chinese.
- `apps/desktop/src/styles/region-settings-models.css`
  - Added scoped selector/dropdown/group/option layout styles using existing Desktop semantic tokens.

`VideoGenerationModelList.tsx`, `video-generation-model-config.ts`, and `ImageGenerationSettings.test.tsx` required no Task 6 changes. The configured-model list remains persisted-config-only and does not claim Host recognition provenance.

## Validation

Passed:

```text
pnpm --filter @piwin/desktop test -- src/video-model-discovery.test.ts src/video-model-suggest.test.tsx src/ImageGenerationSettings.test.tsx
  3 test files passed; 19 tests passed

pnpm --filter @piwin/desktop typecheck
  passed

git diff --cached --check && git diff --check
  passed
```

## Staging and unrelated worktree changes

Only these Task 6 files/hunks are staged for the implementation commit:

- `apps/desktop/src/VideoGenerationModelForm.tsx`
- `apps/desktop/src/VideoGenerationSettings.tsx`
- `apps/desktop/src/desktop-locale.ts`
- `apps/desktop/src/styles/region-settings-models.css`
- `apps/desktop/src/video-model-discovery.ts`
- `apps/desktop/src/video-model-discovery.test.ts`
- `apps/desktop/src/video-model-suggest.tsx`
- `apps/desktop/src/video-model-suggest.test.tsx`

The following pre-existing changes in touched files were deliberately left unstaged:

- `apps/desktop/src/VideoGenerationSettings.tsx`: the unrelated empty-provider copy change from “Text models” to “Channels & chat”.
- `apps/desktop/src/desktop-locale.ts`: unrelated completion-attention, sidebar collapse, and prompt-history copy/type additions.
- `apps/desktop/src/styles/region-settings-models.css`: the unrelated unified model-workspace stylesheet addition at the beginning of the file.

The broad unrelated Desktop/Host/contracts/media/documentation changes elsewhere in the worktree were not reset, cleaned, staged, or modified by Task 6.

## Commit

The implementation commit is created after this report is staged; the parent task report should record the resulting commit hash.
