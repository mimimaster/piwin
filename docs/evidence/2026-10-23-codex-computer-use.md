# Local Codex Computer Use verification

Date: 2026-10-23 (Asia/Shanghai).

## Local installation

- Installed `codex-computer-use-mcp@0.6.1` and its runtime dependencies under
  `~/.piwin/computer-use/server`, with lifecycle scripts disabled. The package
  lock pins the local installation; no repository dependency was added.
- Added the enabled `codex-computer-use` entry to `~/.piwin/mcp.json`, pointing
  directly to the installed JavaScript entry and a stable local Node binary.
- Set `CODEX_COMPUTER_USE_HOME=~/.piwin/computer-use` using an absolute path.
- Backed up the original config to
  `~/.piwin/backups/mcp-before-codex-computer-use-1792745705914.json`, mode 0600.
  Verified all eight existing server definitions and all existing pins were
  unchanged. No Computer Use tools were automatically pinned.
- The signed-component status reported `brokerVerified: true`, broker version
  `codex-cli 0.163.0-alpha.10.2`, and client build `1001501`.

## Real desktop check

Using piwin's MCP lifecycle manager, discovery returned eleven tools: the ten
official desktop methods and `computer_use_status`.

A `get_app_state` call against `com.apple.calculator` succeeded. A second check
went through the real Session Host execution port → `piwin_toolbox` → MCP →
signed native Computer Use components. The result at the Session Host boundary
contained 1,557 text characters and one JPEG screenshot (56,292 base64
characters). The screenshot data was absent from the text output. No app
content or screenshot data was printed to diagnostics or saved as evidence.
Only Calculator observation was exercised; arbitrary app actions were not
claimed as tested. Both verification-owned MCP managers were disposed.

## Source and checks

The old MCP formatter discarded screenshots accompanying text and serialized
image-only results as JSON. Regression tests first reproduced both failures
through toolbox and pinned execution. A shared result normalizer now keeps
images on the existing `ToolResult.images` channel. No contract or Pi version
change was required.

Passed:

- `pnpm typecheck`: all 33 selected workspace projects.
- `pnpm --filter @piwin/mcp test`: 33 tests.
- `pnpm --filter @piwin/host-runtime test`: 4,110 passed, one skipped.
- The final four screenshot regressions after strengthening the toolbox test
  to use the Session Host execution port.
- Agent-host native image projection and RPC tool proxy tests: 15 tests.
- `pnpm test:architecture` and `git diff --check`.
- `pnpm bundle:host`, including Codemode, native external, and Google auth
  smoke checks; updated runtime build is in `dist-host/`.

Touched production source files remain below 1,000 lines. Existing unrelated
Desktop/MCP-settings/update changes in the working tree were preserved.

## Running application boundary

The local MCP registration is installed. The source and generated Host build
include native screenshot forwarding. The already-installed, running
`/Applications/piwin.app` still has the older text-only MCP formatter: it was
not replaced or restarted during this work. A Desktop rebuild/install/relaunch
is required to load the screenshot fix there. Merely restarting the old app
does not change its bundled code. No claim is made that the running packaged
Desktop already contains the patch.

Usage and setup: [Codex Computer Use guide](../guides/codex-computer-use.md).
