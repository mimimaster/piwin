# Model configuration workspace v2

## Status

Implemented by the accompanying Desktop settings change.

## Problem

The Models page currently exposes three horizontal management tabs while speech
defaults live below them as a separate section. Each child surface has its own
heading and card hierarchy, but the page does not answer the four questions a
user needs before editing anything:

1. Which provider channels are active?
2. How many usable models exist for each capability?
3. Which model is the default for chat, image, video, and speech?
4. Is the current setup ready, or does it need attention?

This makes a technically shared provider configuration feel like several
unrelated settings pages.

## Design goals

- Present one model workspace backed by the existing `config.providers` source
  of truth.
- Separate navigation by user intent: Channels & chat, Images, Video, Speech.
- Make status and defaults visible before the user opens an editor.
- Keep existing provider/model dialogs and Host contracts; this is an
  information-architecture and presentation redesign, not a second config path.
- Reuse `@piwin/ui-kit` tabs and status badges. Custom CSS is limited to the
  Models workspace layout.
- Remain usable in a narrow Settings panel without horizontal page scrolling.

## Information architecture

```text
Model workspace
├── health badge
├── overview strip
│   ├── active channels / total channels
│   ├── enabled models / total models
│   ├── ready defaults / applicable defaults
│   └── ASR state
└── workspace
    ├── capability navigation
    │   ├── Channels & chat — count + current chat default
    │   ├── Images — count + current image default
    │   ├── Video — count + current video default
    │   └── Speech — count + current ASR default
    └── active capability panel
        └── existing focused editor surface
```

The desktop uses accessible `Tabs` for the navigation. On wide layouts the tab
list is a sticky vertical rail. Below 920px it becomes a two-column navigation
grid above the content; below 560px it becomes one column.

## Status semantics

- Only enabled providers and enabled models contribute to capability counts.
- A route-only image/video model remains visible as a legacy-capable model.
- Chat readiness requires a valid enabled chat default.
- Image/video readiness is required only when at least one enabled model for
  that capability exists.
- Speech is optional. A configured but invalid ASR default is an issue; an
  entirely unconfigured speech capability is not.
- The page health badge reports either Ready or the number of actionable setup
  issues. It never performs network requests by itself.

## Interaction decisions

- Provider creation, credentials, discovery, and chat-model testing remain in
  Channels & chat.
- Image and video panels continue to reference those channels; they do not own
  provider credentials.
- Speech becomes a first-class workspace destination instead of a detached
  footer section.
- Existing test ids for text/image/video tabs are preserved. Speech adds
  `model-config-tab-speech` and `model-config-panel-speech`.

## Acceptance checks

- The page exposes all four destinations in one navigation component.
- Overview counts and default labels are derived from the live config.
- Switching destinations renders exactly one focused panel.
- Existing provider, image, video, and speech controls remain functional.
- Layout adapts at 920px and 560px without clipping.
- Summary logic has unit coverage; existing Settings interaction tests pass.
- Desktop typecheck passes and the local page is visually inspected.

## Verification record

- `pnpm typecheck`: passed across the workspace.
- Model workspace tests: 3 files and 12 tests passed.
- Desktop visual smoke test: provider, image, and speech destinations checked
  at desktop, 860 px, and 540 px widths with no horizontal overflow or console
  errors.
- Architecture boundary test: passed.
- Full Desktop suite: the model workspace tests passed; 5 unrelated existing
  failures remain in resource-style and transcript parsing tests.
