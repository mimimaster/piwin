# ADR 0042: Pause a session turn as a resumable checkpoint

- Status: accepted
- Date: 2026-08-10
- Updated: 2026-09-03
- Related: ADR 0012, ADR 0015, ADR 0040, `docs/specs/runtime-refactor.md`

## Context

Pi 0.80.10 exposes `prompt`, `steer`, `followUp`, and `abort` on
`AgentSession`, but it does not expose a native pause/resume operation. piwin
must not fork Pi or pretend that pausing Host egress pauses agent execution.

Host still needs a durable way to interrupt a long-running turn, keep partial
transcript, and optionally continue later. The existing RunRegistry already owns
admission, cancellation, joining, and terminality, while the session package
owns the durable transcript.

## Decision

### Host protocol (implementation)

Implement pause as a cooperative, resumable checkpoint:

1. `session/pause` closes Run admission, marks the Run `pausing`, and uses the
   existing abort path to reach the current operation's cancellation boundary.
2. Completed transcript rows, partial assistant output, and tool results remain
   durable. Tool and process side effects are not rolled back.
3. The old Run ends as `interrupted` with terminal code `paused`. A checkpoint
   containing only safe session/run/message references is persisted in the
   session transcript store.
4. `session/resume-run` creates a new foreground Run in the same product
   session. It uses the normal Host prompt pipeline with an internal
   continuation instruction, so runtime activation, permissions, tools, and
   SDK/RPC parity remain in one composition path.
5. `session/abort` cancels a **live** run. A paused checkpoint is not a live
   run. Abort must not throw the checkpoint away. Explicit resume consumes it;
   a new user prompt retires it when that turn is ready to reach the model.
6. `session/prompt` remains a new user message even when a checkpoint exists.
   Never rewrite its text or source into an internal continuation. Preserve its
   transcript row, attachments, context refs, model and permission selection.
   Rejecting admission or failing preparation preserves the checkpoint. Once
   ready, clear the exact superseded checkpoint, without deleting history or
   rolling back tool side effects.

Child Runs are not checkpointed. Pausing a foreground turn that still owns
active descendants (for example while it waits on subagents) cancels and joins
them on the terminal path, as Stop does and as ADR 0030 specifies, then saves
the parent checkpoint. The acknowledgement carries `reason:
'active-descendants'`. (The first version rejected this case, which left a turn
waiting on subagents with no usable composer control.)

- **Bounded join.** Every parent terminal (Stop, Pause, failure) cancels its
  descendants and joins them for at most
  `DEFAULT_DESCENDANT_CANCEL_TIMEOUT_MS` (10s). A child that never
  acknowledges is force-terminated as `cancelled` and logged as detached, so the
  parent always reaches its terminal; the child's late terminal call is a no-op.
- **Salvage on resume.** The Run registry records which `subagent-batch`
  children were still running when the pause was first requested. The
  checkpoint persists them as `interruptedSubagentRunIds`, and
  `session/resume-run` tells the model to read them with `piwin_subagent_wait`
  (status, summary, retained worktree) before redoing that work. A new user
  prompt that retires the checkpoint does not carry this hint.

### Product UI (shells)

Desktop exposes the checkpoint workflow without adding parallel composer chrome.
The composer action slot holds **exactly one circular button** in every state:

1. **Idle: Send.** After send, that same control becomes **Pause**. There is
   never an adjacent Send+Stop, Pause+Stop, or Continue+Discard pair.
2. Clicking Pause sends `session/pause` with the exact foreground `runId` and
   shows `pausing` until the Host publishes the terminal checkpoint.
3. Once paused, an empty composer shows **Continue** (`session/resume-run`).
   With text or attachments, the same slot shows **Send** (`session/prompt`):
   start a new turn in the same conversation, led by the new user message.
   Enter follows ordinary Send, never implicit resume. Even typed 「继续」 is
   a real user message, not a keyword that changes the transport command.
   A failed send retains the draft and attachments. No extra Stop / Discard
   button or confirmation is required.
   When the draft is a continue-utterance, Desktop may show a non-blocking
   hint with an explicit Resume-checkpoint action. That action clears the
   draft and calls `session/resume-run`. It must not change what Enter does.
4. While a run is **live**, the circular control is Pause, not Stop. Follow-up
   while live is Enter.

Do not add a second circular composer button and cite this ADR.

## Consequences

- Pause is not token-exact provider continuation. The resumed model must inspect
  the current transcript and tool state before continuing.
- A tool that has already changed the filesystem, network, or a process is not
  undone by pause.
- SDK and RPC backends share the Host coordinator and both use their existing
  abort/cancel mechanisms; no new Pi-native worker protocol is required.
- The paused Run remains terminal and immutable, which keeps late-event
  filtering, restart behavior, and multi-client projections deterministic.
- Desktop keeps one primary circular control: Send → Pause → empty Continue
  or nonempty Send. The checkpoint offers recovery; it must not capture all
  future input or force the user to finish an old task.

### Product correction (2026-09-01)

The 2026-08-31 rule equating all typed sends with continuation is superseded.
It routed new instructions through a Host-authored prompt, skipped durable user
message recording, and bypassed composer attachment handling. The owner requires
ordinary coding-agent interruption: pause stops work; the next user message may
redirect it. Implementation and regression scope:
[`paused-new-message-send.md`](../plans/2026-09-01-paused-new-message-send.md).

### Product addition (2026-09-23): pausing before any output retracts the prompt

The owner asked for Cursor's behavior: a prompt sent and stopped before the
model showed anything goes back to the composer instead of staying in the
transcript as a paused, unanswered turn.

- Host adds `session/retract-paused-prompt { sessionId, checkpointId }`. It
  requires the named checkpoint to be the active one, and refuses
  (`retract-has-output`) when any assistant row after the checkpoint's source
  prompt carries text, thinking, or tool calls, or the pause interrupted
  subagents. Resume/continuation/voice prompts and steers are
  `retract-not-retractable`. Otherwise it deletes the prompt subtree through
  the same path as `session/truncate-from`, then clears the checkpoint, and
  returns the original text, attachments, and context refs.
- Host owns the "nothing produced yet" decision from the durable transcript;
  the shell's own check only decides whether to ask. A refusal leaves an
  ordinary pause.
- Desktop records the candidate when the user presses Pause with no visible
  reply, and retracts once the paused terminal arrives. The prompt leads the
  composer; anything typed meanwhile follows it. If the user switched sessions,
  the prompt is parked in that session's composer snapshot.
- CLI keeps plain pause semantics (intentional degradation): it has no
  composer to restore into, and a new message already ends the pause.
- Remote shells do not expose the command yet; they fall back to a plain pause.

## Future replacement point

If Pi later adds native pause/resume, the Host command and checkpoint contract
remain stable. Only the agent-host backend operation and continuation policy
need to gain a native implementation; the RunRegistry and durable checkpoint
authority do not move into Pi. The primary shell control remains one Pause even
if its backend later becomes provider-native.
