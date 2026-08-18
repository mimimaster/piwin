# ADR 0056: Provider models are the only writable catalog

## Status

Accepted (2026-08-18)

## Context

Model identity lived on `config.providers[].models`, but Image, Video, and ASR
settings pages also wrote capabilities, routes, labels, and even new model
rows onto that list. Combined with mixed-gateway `/v1/models` dumps, a Grok
image id could land on an Anthropic-protocol CPA channel, then get retagged
from a different tab. The channel list and the capability form disagreed
because display heuristics and persisted fields were different writers.

## Decision

1. `config.providers[].models[]` is the only writable model catalog.
2. Catalog identity (add / fetch-import / enable / delete / retag) is written
   only under Channels & chat, onto **that** provider.
3. Image and video pages list already-tagged models. They may write that
   model's `routes['image-generation']` / `routes['video-generation']` and the
   default-model refs. They do not add, delete, retag, or move models.
   Speech still writes only `speech.asr.defaultModel` (+ language).
4. Fetch/import never copies a model onto a different provider. If a mixed
   gateway lists image and chat ids together, they are imported only onto the
   provider the user fetched.

## Consequences

- Custom image/video routes stay on the model entry. They can be edited on
  the capability page or in the channel model editor; both write the same
  `model.routes` fields.
- Capability tabs fail empty until the user tags 生图 / 视频 / ASR on a
  channel model.
- A model appearing under Anthropic CPA means it was imported or saved on that
  channel, not that Image settings moved it there.

## References

- ADR 0034 (video adapters; default remains a `ModelRef`)
- `docs/architecture.md` §5 image generation
