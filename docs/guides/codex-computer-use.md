# Codex Computer Use in piwin

piwin can use the macOS Computer Use components installed by ChatGPT through
the independent [codex-computer-use-mcp](https://github.com/tmustier/codex-computer-use-mcp)
server. This is a local MCP integration: the current piwin model chooses the
actions, and no nested Codex model runs. The Pi extension's newer Pi version
requirement does not apply to the standalone MCP server.

## Requirements

- macOS with an unlocked desktop session and Node.js 22 or newer.
- ChatGPT installed locally with its Computer Use component enabled.
- Screen Recording and Accessibility permissions for the installed native
  component. Complete the normal setup in ChatGPT; see the
  [official Computer Use guide](https://learn.chatgpt.com/docs/computer-use).
- A vision-capable piwin model to inspect returned screenshots.

The adapter uses experimental internal interfaces. Updating ChatGPT may require
an adapter update. Pin the adapter version and verify it after updates.

## Install and configure

Install the standalone server outside the repository, without package lifecycle
scripts. Keep its package lock for reproducible updates:

```sh
npm install --prefix "$HOME/.piwin/computer-use/server" \
  --ignore-scripts --omit=dev --save-exact codex-computer-use-mcp@0.6.1
```

Merge this entry into `~/.piwin/mcp.json` using absolute paths for this Host.
Replace the examples below with the actual Node binary and home directory.
Preserve the existing servers and `pinnedSelectors`.

```json
{
  "mcpServers": {
    "codex-computer-use": {
      "command": "/absolute/path/to/node",
      "args": [
        "/absolute/home/.piwin/computer-use/server/node_modules/codex-computer-use-mcp/dist/mcp-server.js"
      ],
      "env": {
        "CODEX_COMPUTER_USE_HOME": "/absolute/home/.piwin/computer-use"
      }
    }
  }
}
```

Using an installed entry point avoids an npm download on each launch. The
explicit state directory keeps adapter state under piwin's config root. This
entry belongs on the Mac that owns the desktop; a remote Linux Host cannot use
the client's Mac apps through this configuration.

Open Settings → Extensions → MCP tools and refresh tools for
`codex-computer-use`. It exposes ten desktop methods plus `computer_use_status`.
Existing Host operations refresh the MCP config; discovery does not require
quitting other sessions. Unpinned tools remain available through
`piwin_toolbox`; pinning is optional.

## Use

Ask piwin to use Computer Use to open Calculator, calculate 4 + 5, and verify
the result. The normal sequence is inspect → act → inspect and verify. Tool
selectors include `codex-computer-use.get_app_state`,
`codex-computer-use.click`, and `codex-computer-use.type_text`. Do not use
piwin's read-only Codemode for desktop mutations; call through the toolbox or
pinned tools.

MCP text remains readable text. Screenshots are forwarded through the existing
`ToolResult.images` contract as native image content in both SDK and RPC modes,
for toolbox and pinned calls. Image-only results never dump base64 into text.
The existing backend size limits still apply.

A packaged piwin app must be rebuilt and relaunched to receive this image
forwarding fix. Registering the MCP entry alone does not replace a running
Host's code.

## Diagnose and remove

Run the configured command with `--status`. `brokerVerified: true` confirms
that the required installed binaries pass the adapter's signature checks.
Then refresh tools and try `get_app_state` against Calculator. Signature
checks alone do not prove OS permissions or screenshots work.

MCP servers run with the Host user's permissions, outside piwin's permission
engine (ADR 0033). This adapter uses Codex Full access and adds no wrapper
permission prompts; native OS restrictions still apply. Scope desktop work to
the user's request.

To disable access, disable `codex-computer-use` in MCP settings. To remove it,
remove only its config entry and any pins beginning with
`codex-computer-use.`. The local installation lives under
`~/.piwin/computer-use/server`; preserve the backup of `mcp.json` until the
integration has been verified.
