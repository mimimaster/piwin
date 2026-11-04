# Screen Recording grant rejected after an ad-hoc local install

Date: 2026-11-03 (Asia/Shanghai).

## Symptom and cause

The Screen & System Audio Recording switch for piwin was on, but the installed
app repeatedly reported missing Screen Recording permission, even after
relaunching. The running executable was
`/Applications/piwin.app/Contents/MacOS/piwin-desktop`, not a development
terminal or another running piwin copy.

Inspection of the installed bundle found:

```text
Identifier=piwin_desktop-ff3fd75264866f93
Signature=adhoc
Info.plist=not bound
TeamIdentifier=not set
Sealed Resources=none
designated => cdhash H"02d7bd4692d7872888d26842e0071de0da3d18d2"
```

`codesign --verify --deep --strict --verbose=2 /Applications/piwin.app` failed:

```text
code has no resources but signature indicates they must be present
```

At 14:26:34 and 14:26:37, `tccd` explicitly reported:

```text
Failed to match existing code requirement for subject app.piwinwin.desktop and service kTCCServiceScreenCapture
```

The stored requirement expected the Developer ID Application identity with
team `F47G63A8DM`. The installed local build only supplied a linker-generated
ad-hoc signature. The displayed app name and bundle id were insufficient to
match the existing grant. The same mismatch also appeared for microphone
access before repair.

Apple DTS explains why ad-hoc identities cause TCC problems in
[this signing discussion](https://developer.apple.com/forums/thread/751658).

## Local repair

1. Copied the installed app to a staging directory.
2. Signed the complete staged bundle with the existing Developer ID Application
   certificate for team `F47G63A8DM`, bundle identifier
   `app.piwinwin.desktop`, hardened runtime, timestamp, and the repository's
   `apps/desktop/src-tauri/Entitlements.plist`.
3. Verified the staged bundle with `codesign --verify --deep --strict`.
4. Quit piwin normally, retained the original bundle under
   `~/.piwin/diagnostics/signature-repair-20261103-142924/original/piwin.app`,
   and installed the verified copy at `/Applications/piwin.app`.
5. Verified the installed bundle and reopened it.

No TCC reset or permission toggle was needed. No application source code was
changed for this repair.

## Verification

After repair:

```text
Identifier=app.piwinwin.desktop
Authority=Developer ID Application: Shanghai Hailebei Trading Co., Ltd. (F47G63A8DM)
TeamIdentifier=F47G63A8DM
Info.plist entries=17
Sealed Resources version=2 rules=13 files=6694
/Applications/piwin.app: valid on disk
/Applications/piwin.app: satisfies its Designated Requirement
```

- The relaunched Desktop and local Host both started normally.
- The screenshot shortcut opened the native screenshot overlay, passing the
  frontend authorization check and native capture preflight.
- A screenshot completed and appeared in the composer as
  `Preview screenshot-20261103-143215.png`. The test attachment was removed;
  no chat message was sent.
- This verifies Screen Recording recovery. Microphone capture was not tested.
- Repository changes are limited to this evidence and the screenshot/packaging
  guides, so no application build or unit-test run was required.

For future installed local builds, use `pnpm package:desktop` and enforce
`PIWIN_REQUIRE_DEVELOPER_ID=1 pnpm verify:desktop-package` before installation.
Installing another ad-hoc build over the repaired app can recreate the issue.
