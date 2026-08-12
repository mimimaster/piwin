# Model-turn tool timeline

> **Superseded (2026-08-12).** The Run-level process card and nested Run
> Inspector described below must not be used in the main transcript. The
> replacement is the append-only causal stream in
> [`../plans/2026-08-12-causal-agent-event-stream.md`](../plans/2026-08-12-causal-agent-event-stream.md).
> This historical document is retained only to explain the discarded design.

> Status: Implemented
>
> Date: 2026-08-11
>
> Scope: Desktop transcript presentation of one Agent Run and its model/tool loop

## 1. Decision

The transcript must stop presenting every tool execution in one Run as one flat
"activity" batch.

`runId` remains the ownership boundary for one user-requested Agent Run, but the
expanded presentation preserves every Assistant lifecycle message as a separate
model-response step. Tools may be grouped only when they belong to the same
Assistant message. A single response may contain multiple tool calls; sequential
calls from later responses must never be made to look like one batch.

The compact transcript row remains one line. Opening it expands a bounded Run
Inspector directly below that row. The inline Inspector has a strict maximum
height and owns its scrolling instead of inserting an unbounded tool list above
the composer.

User interaction is authoritative: after a user opens or closes the Inspector or
a step, later stream events must not reverse that choice.

## 2. Why the current display is false

Pi already emits one Assistant lifecycle message for each model/tool-loop
segment. `@piwin/agent-host` normalizes those boundaries as
`message/start ... message/end`, and the transcript recorders attach the
subsequent tool execution to the most recent Assistant message.

Desktop then removes that structure:

1. `projectTranscriptTurnWorkDetails()` groups every Assistant message sharing a
   `runId`.
2. It copies every nested tool into one `toolsById` map.
3. Earlier Assistant lifecycle rows are hidden.
4. `TurnToolGroup` renders the flattened array as `N actions`.

The resulting row is a Run total, not one model response or one tool batch, but
its visual grammar makes it look like one call chain entry.

### 2.1 Field observation

A 2026-08-11 local Run matching the reported transcript was inspected in both
the piwin SQLite transcript and Pi JSONL history. It contained:

| Fact | Count |
| --- | ---: |
| Assistant lifecycle/model-response segments | 68 |
| Segments containing tool calls | 67 |
| Tool executions/results | 70 |
| Single-tool response segments | 65 |
| Two-tool response segments | 1 |
| Three-tool response segments | 1 |
| Maximum calls in one response segment | 3 |

The screenshot showing `41 actions` was therefore a partial Run total. It was
not evidence that one provider response returned 41 calls.

## 3. Protocol facts

Client-side function calling is an Agent loop:

```text
model request
  -> Assistant response: zero, one, or several tool calls
  -> client executes those calls
  -> client sends tool results in another model request
  -> next Assistant response: more calls or final text
```

- OpenAI explicitly documents this multi-step loop and allows multiple calls in
  one turn. Setting `parallel_tool_calls: false` constrains a turn to zero or one
  call.
- Anthropic responses may contain one or more `tool_use` blocks. The client
  returns matching `tool_result` blocks in the next message;
  `disable_parallel_tool_use: true` constrains the response to at most one call
  with automatic tool choice.
- Gemini distinguishes independent parallel function calls from sequential or
  compositional calls whose next arguments depend on earlier results.

Sources:

- [OpenAI Function calling](https://developers.openai.com/api/docs/guides/function-calling)
- [Anthropic Implement tool use](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use)
- [Gemini Function calling](https://ai.google.dev/gemini-api/docs/function-calling)

Multiple calls in one response are legitimate. That does not justify flattening
calls from multiple responses. Nor does it prove that the client executed
same-response calls concurrently. The UI may say `3 calls in this response`;
it may say `parallel` only when adapter metadata or overlapping execution times
prove concurrency.

The useful competitive pattern is progressive disclosure rather than one
ever-growing inline list. Claude Code Desktop, for example, separates Normal
(tool calls collapsed into summaries), Verbose (every tool call, file read, and
intermediate step), and Summary (final responses and changes) transcript views.
Piwin does not need to copy those modes verbatim, but the Run Inspector should
serve the same audit/debug role while the main transcript stays compact.

- [Claude Code Desktop transcript view modes](https://code.claude.com/docs/en/desktop)

## 4. Product vocabulary

| Layer | Stable identity | Meaning |
| --- | --- | --- |
| User turn | transcript turn | One user message and the following activity |
| Agent Run | `runId` | One accepted product task, possibly many model requests |
| Model-response step | Assistant `messageId` | One Pi Assistant lifecycle/model-tool-loop segment |
| Same-response call set | Assistant `messageId` + ordered tools | Zero or more calls emitted by that response |
| Tool execution | `toolCallId` | One concrete execution and result |

Do not label an Agent Run as an API call. Do not label a same-response call set
as parallel without evidence.

## 5. Recommended interaction

### 5.1 Compact transcript surface

Completed Run:

```text
过程 · 68 轮模型响应 · 70 次工具执行 · 1 失败                    ›
```

Active Run:

```text
正在处理 · 第 42 轮 · 读取 permissions.md                       ›
```

The row reports separate response and execution counts. It does not mount all
historical cards. A failure remains visible in the compact row.

### 5.2 Run Inspector

Clicking the compact row expands a bounded Inspector in place. It must not open
a modal, dim the application, or take over a global side panel. The composer
remains fixed; after the inline height cap, the Inspector owns its scrolling.
The Inspector uses a virtualized model-step timeline:

```text
第 1 轮
  可见说明：Let's read.
  本轮 3 个调用
    浏览目录
    搜索 A
    搜索 B

第 2 轮
  读取 index.ts

第 3 轮
  搜索 VisionDelegationSettings
```

Rules:

1. One Assistant message produces one step.
2. One tool call renders directly in the step.
3. Two or more tool calls in the same Assistant message render under
   `本轮 N 个调用`.
4. Tools from different Assistant messages are never merged, even when they
   have the same name, target, or adjacent timestamps.
5. A provider-exposed reasoning summary or visible Assistant narration may be
   shown above that step. The UI must not fabricate or expose unavailable raw
   chain-of-thought.
6. Failures are expanded and focused by default when the Inspector first opens.
7. Historical output stays collapsed inside each tool card until explicitly
   opened.

### 5.3 Stable disclosure state

Disclosure state has two sources:

```ts
type DisclosureIntent = 'automatic' | 'user-open' | 'user-closed';
```

- `automatic` is allowed only before the first user interaction.
- A new tool may update the active-step content and optionally scroll an
  untouched Inspector to the live edge.
- A new tool must not close an Inspector or step in `user-open` state.
- A new tool must not reopen a step in `user-closed` state.
- State is keyed by stable `runId` / `messageId`, never by array index or the
  identity of a newly rendered tool object.

The current `useEffect(...latestRunningTool.toolCallId)` reset violates this
rule and must be removed. The thinking disclosure reset in `TurnWorkDetails`
must follow the same ownership rule.

## 6. Data projection

### 6.1 Immediate correction: no protocol migration required

The required boundary already survives into `ChatMessageUi`:

- every Assistant lifecycle message has its own `id`;
- its tools remain nested on that message;
- all messages in the Run retain the same `runId`.

Replace the lossy aggregated `ChatMessageUi` projection with a Run projection
that preserves the members:

```ts
type RunWorkDetailsProjection = {
  runId: string | null;
  ownerMessageId: string;
  modelSteps: Array<{
    messageId: string;
    text: string;
    thinking: string;
    tools: ToolCardUi[];
    status: ChatMessageUi['status'];
  }>;
};
```

`projectTranscriptTurnWorkDetails()` may still select one visible answer owner
and carry a summary-only tool list for changed-file/count surfaces, but that
flat list must never be used as the detailed timeline or as the basis for
response grouping. `modelSteps[].tools` is the only source for Inspector detail.

### 6.2 Contract hardening

Current tool events are correlated to the latest Assistant message by event
order. That is sufficient for the present single-foreground-Run loop, but it is
not an ideal cross-adapter contract.

A follow-up contracts-first change should add an optional normalized parent
identity to `tool/start`, `tool/update`, and `tool/end`, for example:

```ts
responseMessageId?: string;
```

Both `PiSdkAdapter` and `PiRpcAdapter` must populate the same field when Pi
exposes or can deterministically correlate it. Persistence retains it on the
tool card. When a backend cannot prove the association, the field remains
absent and the product marks the legacy/inferred group instead of inventing an
exact response boundary.

This hardening is implemented: Pi event mapping carries the optional identity
through normalized events, both transcript recorders persist it on tool cards,
and Desktop prefers it when applying live updates. Older adapters and imported
transcripts remain valid because the field is optional.

### 6.3 Delivered implementation

- `TranscriptModelStep` preserves one ordered entry per Assistant message.
- `TurnToolGroup` is a compact Run summary; `RunInspector` is a bounded,
  virtualized inline response-step list.
- Same-response tools stay nested under their Assistant step; tools from later
  responses remain separate.
- Inline thinking shows the latest available public model note; the Inspector
  retains the complete ordered notes without fabricating hidden chain of
  thought.
- Tool cards and thinking disclosures keep a user's explicit open/closed choice
  while streaming updates arrive.
- Empty lifecycle rows are suppressed from the transcript, preventing activity
  from accumulating in front of the composer.

## 7. Legacy and incomplete data

- Existing transcripts already nest tools under Assistant messages and can use
  those message boundaries.
- Imported legacy rows that contain only a flat tool list render as
  `旧记录 · N 次工具执行（模型轮次不可恢复）`.
- Never reconstruct response batches from tool names, fixed time windows, or
  adjacent list position.
- Exact concurrency is unknown unless explicitly recorded; use
  `同一轮 N 个调用`, not `并行 N 个调用`.

## 8. Rejected alternatives

### Flat Run rollup

Compact, but erases the model/tool loop and makes dozens of sequential calls
look like one provider response.

### Expand every tool inline

Truthful only at the execution level, but an active long Run displaces the
answer and composer and creates an oversized transcript layout region.

### Automatically close history when a new tool starts

Moves content while the user is inspecting it and reverses an explicit user
action.

### Merge by tool kind, target, or timing

Useful for statistics but not a protocol boundary. It can combine dependent
calls from different model responses and therefore fabricates causality.

### Disable all multi-call responses

Provider flags such as `parallel_tool_calls: false` can force one call per
response, but changing execution semantics to compensate for a misleading UI
throws away legitimate independent concurrency and does not solve historical
presentation.

### Display raw hidden reasoning

It is not consistently available across providers and is not required to show
truthful response boundaries. Show visible narration or provider-supported
reasoning summaries only.

## 9. Implementation sequence

1. Add projection tests proving that multiple Assistant messages sharing a
   `runId` remain separate model steps.
2. Replace the flat `toolsById` projection with ordered `modelSteps`.
3. Change the compact row counts to model responses plus tool executions.
4. Add the bounded, virtualized inline Run Inspector and keep the composer fixed.
5. Remove effects that overwrite user disclosure state.
6. Add tests for one-call, same-response multi-call, sequential multi-response,
   failure focus, ongoing streaming, hydration, and legacy unknown-boundary
   cases.
7. Add optional `responseMessageId` to contracts and both Pi adapters as a
   separate hardening slice.

## 10. Acceptance criteria

- The observed 68-response/70-tool fixture renders `68 轮模型响应 · 70 次工具执行`,
  not one `70 actions` batch.
- The two- and three-call Assistant messages each form exactly one
  same-response group; the other 65 tool-bearing messages remain separate.
- Opening the Inspector never opens a global overlay or moves the composer; its
  inline growth is capped and overflow scrolls internally.
- Once the user opens a step, later tool starts do not close it.
- The compact row mounts O(1) detail content; the Inspector virtualizes long
  histories.
- No UI label claims parallelism or exposes hidden reasoning without evidence.
