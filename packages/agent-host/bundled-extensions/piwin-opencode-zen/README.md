# OpenCode Zen

Built-in public model provider for piwin. Vendored from
`mimimaster/piwin-opencode-zen` commit `16a9c2654d53e03d3135c5bbf10082fd9e5fb293`
(version 0.2.0), derived from `ZhiAo1120/pi-opencode-zen` under MIT.
The original license is preserved in LICENSE. Local version 0.3.0 changes
branding and adds the availability notice; provider transport is unchanged.

The Host installs an immutable revision using the existing marketplace ID,
`piwin-mimimaster-opencode-zen`, preserving prior enablement. Fresh installs
are enabled automatically. No sign-in or private API key is required.

Models are fetched on first activation and on manual refresh from the live
Zen catalog intersected with explicit free, compatible models.dev metadata.
No model IDs or token limits are bundled. Failed discovery publishes an empty
catalog, including the stored snapshot used by subsequent sessions.

Availability depends on official IP restrictions and the network environment.
The notice in piwin.json is displayed in model settings.
