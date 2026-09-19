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
4. Runs `pnpm verify:desktop-package` (sidecar, Host JS, LanceDB native, signature). Tauri deletes the `.app` after writing the DMG; verify then attaches the DMG read-only and inspects the nested bundle.
5. Uploads the DMG as a workflow artifact (14 days).
6. On `v*` tags, attaches the DMG to a **draft** GitHub Release.

If `APPLE_API_KEY` / `APPLE_API_ISSUER` / `APPLE_API_KEY_P8` are set, the job
submits the DMG to Apple notary and staples the ticket. SHA-256 is hashed
**after** stapling. Missing API secrets skip notarization (same as a local
`pnpm package:desktop`). Clean-machine smoke (ADR 0017 S5) is still required.

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

### Notarization

| Secret | Value |
|--------|--------|
| `APPLE_API_KEY` | App Store Connect Key ID (filename `AuthKey_<id>.p8`) |
| `APPLE_API_ISSUER` | Issuer UUID from Users and Access → Integrations |
| `APPLE_API_KEY_P8` | PEM contents of the `.p8`. Download is one-shot; keep a local copy. |

Local, after a signed `pnpm package:desktop`:

```bash
export APPLE_API_KEY=...
export APPLE_API_ISSUER=...
export APPLE_API_KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_${APPLE_API_KEY}.p8"
pnpm notarize:desktop
```

Apple will not notarize an ad-hoc build. GitHub-hosted signed+notarized
packages also need the Developer ID `.p12` secrets above.

Do **not** put empty `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` on the job `env:`. GitHub still sets those variables to `""`, and Tauri treats `Some("")` as “import this p12”, then `security import` dies with `SecKeychainItemImport: One or more parameters passed to a function were not valid.` The p12 is a step-only env for `import-apple-certificate.sh`; later steps only see `APPLE_SIGNING_IDENTITY`.

## Local check of a just-built app

```bash
pnpm verify:desktop-package
# fail on ad-hoc:
PIWIN_REQUIRE_DEVELOPER_ID=1 pnpm verify:desktop-package
```

If `apps/desktop/src-tauri/target` is a symlink or `CARGO_TARGET_DIR` is set, the script follows it. After a successful `pnpm package:desktop`, Tauri may have deleted `macos/*.app`; verify attaches the DMG instead.

## First-run checklist

1. Merge this workflow to `main`.
2. Actions → `package-macos` → Run workflow (runner `macos-14`, require Developer ID off).
3. If the job dies on disk space, re-run after confirming the Xcode cleanup logs, or use a self-hosted Mac.
4. Export the Developer ID p12 and set the three secrets.
5. Re-run with **require_developer_id**.
6. Set the three App Store Connect API secrets and confirm the Notarize step staples.
7. When a numbered build is needed: `git tag v0.1.0 && git push origin v0.1.0`, then publish the draft Release after a local install smoke.
