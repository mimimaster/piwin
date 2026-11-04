# External link single-open regression (2026-11-04)

## Diagnosis

The Desktop installs `installExternalLinkGuard` on document capture. It opens
external HTTP(S) anchors through `openExternalUrl` and cancels default navigation.
The original guard was added in `d110fdd4e` to keep external navigation from
replacing the Tauri webview with a blank window.

The Desktop also registers `tauri_plugin_shell::init()`. The locked Rust crate
`tauri-plugin-shell` 2.3.5 injects `src/init-iife.js`, whose body click delegate
automatically opens HTTP(S), mailto and tel anchors with `target="_blank"`.
That delegate does not check `event.defaultPrevented`. Cancelling navigation
therefore leaves two explicit opens for one click: document capture and body
bubbling. Conversation Markdown and search citation cards use `_blank` anchors.

The earlier guard tests only mounted anchors with the guard; they did not include
the native shell's injected delegate. Ordinary browser runs also omit that
delegate. Passing those tests did not cover the packaged Desktop behavior.

## Fix

The existing document guard owns intercepted external HTTP(S) activations. It
now cancels navigation and stops propagation before opening the URL, so the
shell delegate and component openers cannot process that activation again.
URL classification stays intact; internal links still reach their handlers.
Each deliberate click opens once, with no URL timers or cross-click suppression.

The change belongs entirely to the Desktop shell. Host contracts, Pi adapters,
and the shell plugin registration do not change.

## Validation

- **Regression reproduced before the fix:** existing guard unit tests passed,
  while 8 of 9 new integration cases failed with two opens per click (four for
  two deliberate clicks). The middle-click case already passed.
- **Focused verification:** 123 tests passed across the guard integration/unit
  suites, external URL opener, ordinary/enhanced Markdown, footnotes and local
  Markdown links. Coverage includes streaming and settled conversation links,
  review documents, search citations, nested labels, Ctrl/Cmd-click, keyboard
  click activation, middle-click and repeated deliberate clicks.
- **Original native initialization script:** an additional DOM smoke loaded
  `tauri-plugin-shell` 2.3.5's actual `src/init-iife.js` from the local Cargo
  registry, with native invocations mocked. The guard from `HEAD` invoked
  `plugin:shell|open` twice; the fixed guard invoked it once. This confirms that
  the portable integration fixture reproduces the injected delegate's behavior.
- **Desktop suite:** `pnpm --dir apps/desktop test` finished with 6,699 passed
  and 3 failed tests (910 passed / 3 failed files). The failures concern the
  Kimi provider's fetch-models button, the tray quota CSS blur whitelist and a
  tray quota synchronization timeout; these belong to other work in the tree.
- **Static checks:** ESLint passed for all three changed TypeScript files;
  the production file is 63 lines and whitespace checks passed.
- **Typechecking:** `pnpm typecheck` is blocked by the existing missing `topic`
  entry in `packages/contracts/src/flashcard-study-tool-input.ts:41`. Desktop
  typechecking additionally reports explicit `undefined` optional properties
  in the in-progress `src/knowledge/wiki-page-draft.ts:72`.

The installed application needs a rebuilt package to receive this source fix.
Packaged-app acceptance remains pending that build; the DOM smoke verifies
event routing and native invocation counts.
