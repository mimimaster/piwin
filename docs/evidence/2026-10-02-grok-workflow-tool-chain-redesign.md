# Grok workflow in the initiating transcript call chain

Verified on 2026-10-02 against http://localhost:1420 and the development Host.
This supersedes the earlier standalone tray styled to resemble a chain.

## Change

- One session-level observation loop continues after the foreground prompt settles.
- Workflows render inside their initiating assistant article, not after the whole transcript.
- Explicit slash objective and start time identify the owner. Vendor replay that replaces
  message timestamps with reconnect time uses matching prompt order instead. Later questions
  and background completion reminders do not move the chain.
- Existing ToolBatchCapsule owns header, timeline, folding and height measurement;
  ActionMarquee and InkLineNode retain the existing activity and status vocabulary.
- Native active status opens the stage chain immediately. Successful workflows fold;
  failures remain visible, and explicit user folding is respected.
- Execution history is secondary detail. The report reuses Button, MarkdownView and
  CollapsibleContentBlock. This UI does not generate fake Pi tool events.
- Workflow CSS is reduced from the separate card implementation to 34 layout lines.

## Verification

78 relevant tests pass: 66 Desktop checks (workflow lifecycle, polling recovery,
session navigation, replay anchoring, actual ChatThread ownership, batch/tool-chain
regressions and transcript containment) and 12 contracts lifecycle checks.
The full workspace typecheck passed; the final Desktop edits passed tsc -b again.
Diff whitespace and production file size checks passed.

The real Test Query Session Initialization conversation was reopened at 1420.
DOM inspection confirmed a single workflow inside the assistant article belonging
exactly to the DeepSeek research prompt, including after a later backend reminder.
The native run was already interrupted at the report stage: the stored execution
history reports a coordinator channel closing and report synthesis falling back.
The UI displayed interrupted/worker failure states and successfully loaded the
persisted partial report in place. This is evidence of UI recovery and truthful
status, not a claim that the native research succeeded. No replacement paid
research prompt was launched for this verification.
