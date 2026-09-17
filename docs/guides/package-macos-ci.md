# macOS all-in-one package CI

| Field | Value |
|-------|-------|
| Status | Active |
| Related | [`docs/release-desktop.md`](../release-desktop.md), [ADR 0017](../adr/0017-host-sidecar-bundling.md) |

GitHub Actions workflow: [`.github/workflows/package-macos.yml`](../../.github/workflows/package-macos.yml).

This is **not** the default `ci.yml` job. Linux CI stays typecheck / test / host smoke. Packaging is a separate, macOS-only pipeline that runs the same command as a local release:

```bash
pnpm package:desktop
```

Do not switch the builder to `tauri-apps/tauri-action`. That action calls `tauri build` and would skip `bundle:host`, `fetch:node-runtime`, and `sign:host-macho`.

## What it produces

One arm64 all-in-one DMG (`piwinwin_<version>_aarch64.dmg`) plus a SHA-256 sidecar. Intel Mac / universal builds are out of scope: LanceDB 0.37.1 has no `darwin-x64` prebuild.

The job:

1. Optionally imports a Developer ID `.p12` (GitHub-hosted only).
2. Runs `pnpm package:desktop`.
3. Runs `pnpm test:bundle` (Host JSONL mock smoke, no GUI).
4. Runs `pnpm verify:desktop-package` (sidecar, Host JS, LanceDB native, signature).
5. Uploads the DMG as a workflow artifact (14 days).
6. On `v*` tags, attaches the DMG to a **draft** GitHub Release.

It does **not** notarize (residual D-ENG-03b) and does **not** replace ADR 0017 S5 clean-machine smoke.

## Triggers

| Trigger | Result |
|---------|--------|
| Actions → `package-macos` → Run workflow | Artifact only. Optional version / Developer ID gate. |
| `git tag v0.1.0 && git push origin v0.1.0` | Same build; `tauri.conf.json` version becomes `0.1.0`; draft Release. |

Never on pull requests. macOS minutes and a ~275 MB DMG do not belong on every push.

## Runners

Default is GitHub-hosted `macos-14` (Apple Silicon). This repository is public, so those minutes are free. Disk is still tight (~14 GB image): the workflow deletes extra Xcode copies and prunes the pnpm store.

`self-hosted` is an explicit dispatch option. Use it only on a dedicated Mac that already packages this repo. GitHub [recommends against self-hosted runners on public repositories](https://docs.github.com/en/actions/hosting-your-own-runners/managing-self-hosted-runners/about-self-hosted-runners#self-hosted-runner-security) — a compromised workflow would execute on that machine.

Self-hosted labels must include `self-hosted`, `macOS`, and `ARM64` (the default runner app adds these).

## Signing

Ad-hoc packages work for a private smoke, but every build is a new code identity. macOS then forgets Desktop / removable-volume grants.

For a stable Developer ID:

1. In Keychain Access, export **Developer ID Application** as a `.p12`.
2. Encode and store GitHub Actions secrets (repo Settings → Secrets and variables → Actions):

```bash
base64 -i developer-id.p12 | pbcopy   # APPLE_CERTIFICATE
security find-identity -v -p codesigning | grep "Developer ID Application"
```

| Secret | Value |
|--------|--------|
| `APPLE_CERTIFICATE` | base64 of the `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | password used when exporting |
| `APPLE_SIGNING_IDENTITY` | optional if the p12 contains exactly one `Developer ID Application` identity. Otherwise the full name, e.g. `Developer ID Application: Example Co. (TEAMID)`. |

`sign-host-macho` runs **before** `tauri build`, so the workflow imports the p12 into a temporary keychain itself. Tauri's built-in `APPLE_CERTIFICATE` import is not enough for Host natives (`lancedb` / `sharp` / `esbuild`).

Tag builds set `PIWIN_REQUIRE_DEVELOPER_ID=1` and fail if the `.app` is still ad-hoc. Manual dispatch defaults to allowing ad-hoc so the pipeline can be proven before secrets exist; tick **require_developer_id** once the cert is in place.

Notarization (`APPLE_API_KEY` / `notarytool` / stapler) is a follow-up, not part of this workflow.

## Local check of a just-built app

```bash
pnpm verify:desktop-package
# fail on ad-hoc:
PIWIN_REQUIRE_DEVELOPER_ID=1 pnpm verify:desktop-package
```

If `apps/desktop/src-tauri/target` is a symlink or `CARGO_TARGET_DIR` is set, the script follows it.

## First-run checklist

1. Merge this workflow to `main`.
2. Actions → `package-macos` → Run workflow (runner `macos-14`, require Developer ID off).
3. If the job dies on disk space, re-run after confirming the Xcode cleanup logs, or use a self-hosted Mac.
4. Export the Developer ID p12 and set the three secrets.
5. Re-run with **require_developer_id**.
6. When a numbered build is needed: `git tag v0.1.0 && git push origin v0.1.0`, then publish the draft Release after a local install smoke.
