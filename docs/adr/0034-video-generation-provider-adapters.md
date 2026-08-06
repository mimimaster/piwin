# ADR 0034: Video generation provider adapters and settings

## Status

Accepted (2026-08-06)

## Context

Video generation APIs are generally asynchronous, but they do not share one
wire format:

- OpenAI Sora creates a video job with `POST /videos`, exposes status/progress
  through `GET /videos/{id}`, and serves the finished content from a separate
  content endpoint.
- Google Veo starts a long-running operation and requires operation polling
  before the generated video can be downloaded.
- Runway, Luma, and MiniMax each expose their own task/generation identifiers,
  status values, and result-file fields.

The product therefore needs a provider-neutral model registry without
pretending that all video vendors are OpenAI-compatible. The Desktop also
needs one place where image and video model configuration can be switched
without duplicating provider credentials.

## Decision

1. Extend `ModelCapability` with `video-generation`.
2. Add `PiwinConfig.videoGeneration.defaultModel`, independent from the chat
   and image-generation defaults.
3. Store the provider wire format on the model's
   `routes['video-generation']` entry as `apiStyle`, together with the create
   path, job timeout, and polling interval. Supported styles are:
   `openai-videos`, `google-veo`, `runway-tasks`, `luma-generations`,
   `minimax-tasks`, and `custom`.
4. The Host `video_gen` tool uses a normalized adapter port:

   ```text
   create → task id → poll or callback → normalized progress/status
          → download result → save under ~/.piwin/media/<session>/
   ```

   Provider-native request and response parsing remains inside adapters. The
   UI and transcript consume normalized media contracts. The current Desktop
   shows an indeterminate animated running card while the Host polls; a later
   HostPush extension may expose provider progress percentages where available.
5. Put image and video configuration in Tabs on the existing Image Generation
   settings page. Both tabs use the same `config.providers` list and provider
   credentials. The runtime tool is composed by Host and is filtered by the
   `video-generation` family in the session blueprint.
   The `custom` style follows a small convention (`POST` creates `{id}`;
   polling returns a terminal status plus `video_url`, `url`, `output.url`,
   or `content.url`) so simple async vendors can be integrated without a code
   change; vendor-specific shapes should use a native adapter.
6. Keep one-off video results in the conversation transcript as media
   attachments. A later Media Studio/library may provide batch history,
   presets, retry, and asset management without splitting the originating
   conversation context.

## Consequences

- Adding a vendor does not require changing the settings page or faking an
  OpenAI response shape; it adds an adapter and its mapping tests.
- Provider result URLs are treated as temporary transport details. Completed
  videos must be downloaded into the local media store before the UI relies on
  them.
- Progress is optional and provider-dependent. The UI must support queued,
  running, completed, and failed states without requiring a smooth percentage.
- The current settings UI can configure multiple vendors. A configured model
  enables the Host tool; a missing or disabled model fails closed and does not
  advertise `video_gen` to the agent.

## References

- [OpenAI Videos API](https://developers.openai.com/api/reference/resources/videos)
- [Google Veo API guide](https://ai.google.dev/gemini-api/docs/veo)
- [Runway API reference](https://docs.dev.runwayml.com/api/)
- [Luma Create Generation](https://docs.lumalabs.ai/reference/creategeneration)
- [MiniMax video generation guide](https://platform.minimax.io/docs/guides/video-generation)
