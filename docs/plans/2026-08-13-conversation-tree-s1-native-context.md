# Conversation Tree S1 — 原生上下文副本 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> (或 subagent-driven-development) 按任务执行本计划。步骤用 `- [ ]` 勾选跟踪。

**Goal:** fork / 编辑重发 / 冷激活后，新 Pi 会话按"原生消息重放"恢复模型上下文
（含 ToolCall、工具输出、thinking signature），替代现行 role+text 文本注入；无副本
时自动回落现行为。

**Architecture:** Pi 事件映射层（`@piwin/agent-host` event-map）在 `message_end`
时把原生 `Message` 序列化为规范化事件 `message/native_context`（product id、载荷对
产品层不透明）；host-runtime recorder 写入每会话 `transcript.sqlite3` 新表
`native_entry`；冷激活时 host-runtime 从 store 读原生序列构建
`SessionSeedMessage[].native`，经既有 `CreateSessionOptions.seedMessages` 通道进入
`createSeededPiSessionManager` 逐条 `appendMessage`。该事件不出 Host（egress 过滤）。

**Tech Stack:** TypeScript strict / ESM、`node:sqlite`（已含）、vitest、
Pi 0.80.10（`SessionManager.inMemory().appendMessage` 接受完整 `Message` 联合类型）。

**Spec:** `docs/specs/session-conversation-tree.md` §4（S1）。

## Global Constraints

- UI/apps 不得 import Pi 包；`NativeContextEntry.payload` 对 `@piwin/session`、
  `@piwin/host-runtime`、客户端全部不透明，仅 `@piwin/agent-host` 编解码。
- `message/native_context` 事件绝不推给客户端（host-runtime 4865 行附近 push 前过滤）。
- 单条 payload 上限 256 KiB（`MAX_NATIVE_ENTRY_BYTES = 262_144`），超限只落
  `truncated: true` 占位，重放时该消息回落文本。
- 种子模式：`seedMode: 'compaction' | 'replay'`；缺省 = `'compaction'`（保持现行
  compact/subagent 行为），仅 `'replay'` 跳过 `createSeededPiSettingsManager` 的
  `keepRecentTokens: 1` 覆盖。
- 无 `any`、无未检查的非空断言；相对导入带 `.js` 后缀；测试与实现同目录。
- 提交按任务分小提交（执行者需获得用户明确授权后才可 commit，只 add 本计划涉及文件）。

---

### Task 1: contracts — 类型扩展

**Files:**
- Modify: `packages/contracts/src/session-seed.ts`
- Modify: `packages/contracts/src/host.ts`（`AgentEvent` 联合，443 行 `message/end` 之后）
- Test: `packages/contracts/src/ipc.test.ts`（追加用例）

**Interfaces（后续任务依赖）:**
- `NativeContextEntry { format: 'pi-message-v1'; payload: string; byteLength: number; truncated?: boolean }`
- `SessionSeedMessage.native?: NativeContextEntry[]`
- `CreateSessionOptions.seedMode?: 'compaction' | 'replay'`
- `AgentEvent` 新变体：
  `{ type: 'message/native_context'; messageId: string; role: 'assistant' | 'toolResult'; entry: NativeContextEntry; responseMessageId?: string; runId?: string }`

- [x] **Step 1: 写失败测试**（`ipc.test.ts` 追加）

```ts
it('accepts message/native_context event and native seed shapes', () => {
  const push: HostPush = {
    type: 'event',
    sessionId: 's1',
    event: {
      type: 'message/native_context',
      messageId: 'm1',
      role: 'assistant',
      entry: { format: 'pi-message-v1', payload: '{"role":"assistant"}', byteLength: 20 },
    },
  };
  expect(push.event.type).toBe('message/native_context');
  const seed: SessionSeedMessage = {
    role: 'assistant',
    text: 'hi',
    timestamp: 1,
    native: [{ format: 'pi-message-v1', payload: '{}', byteLength: 2, truncated: true }],
  };
  const options: CreateSessionOptions = { seedMessages: [seed], seedMode: 'replay' };
  expect(options.seedMode).toBe('replay');
});
```

（`SessionSeedMessage` / `CreateSessionOptions` 需加入该文件 import。）

- [x] **Step 2: 跑测试确认编译失败**
  `pnpm --filter @piwin/contracts test` → 期望 TS 报错（类型不存在字段）。
- [x] **Step 3: 实现**

`session-seed.ts` 全量替换为：

```ts
/** Initial product-history messages for an ephemeral agent session. */

/**
 * Opaque serialized Pi-native message copy (spec §4.1).
 * Only `@piwin/agent-host` may encode/decode `payload`; product packages and
 * clients treat it as an opaque string.
 */
export type NativeContextEntry = {
  format: 'pi-message-v1';
  /** JSON of one Pi `Message`. Empty when `truncated` is set. */
  payload: string;
  byteLength: number;
  /** Payload exceeded the per-entry cap and was dropped; replay falls back to text. */
  truncated?: boolean;
};

export type SessionSeedMessage = {
  role: 'user' | 'assistant';
  text: string;
  /** Unix timestamp in milliseconds, matching Pi message timestamps. */
  timestamp: number;
  /** When present the backend replays these native messages instead of `text`. */
  native?: NativeContextEntry[];
};

export type CreateSessionOptions = {
  /**
   * History to load into a temporary agent session before it is returned.
   * The history is not persisted by the host or by Pi.
   */
  seedMessages?: readonly SessionSeedMessage[];
  /**
   * `compaction` (default) keeps the aggressive keep-recent compaction override
   * used by compact snapshots and subagent continuations. `replay` seeds
   * full-fidelity history and must not force compaction.
   */
  seedMode?: 'compaction' | 'replay';
};
```

`host.ts`：`message/end` 变体后插入：

```ts
  /**
   * Host-internal opaque native context copy (spec §4). Never forwarded to
   * clients; host-runtime persists it and strips it before egress.
   */
  | {
      type: 'message/native_context';
      messageId: string;
      role: 'assistant' | 'toolResult';
      entry: NativeContextEntry;
      /** Owning assistant message for toolResult entries. */
      responseMessageId?: string;
      runId?: string;
    }
```

（`host.ts` 顶部从 `./session-seed.js` import `NativeContextEntry`；确认
`packages/contracts/src/index.ts` 已 re-export `session-seed.js` 的类型，若无则补
`export type { NativeContextEntry } from './session-seed.js';`。）

- [x] **Step 4: 测试转绿** `pnpm --filter @piwin/contracts test`
- [x] **Step 5: 全仓 typecheck** `pnpm typecheck`（确认无实现者破坏）
- [x] **Step 6: Commit（需用户授权）** `git add packages/contracts/src/{session-seed.ts,host.ts,ipc.test.ts,index.ts} && git commit -m "feat(contracts): native context entry + replay seed mode"`

---

### Task 2: session store — `native_entry` 表与级联

**Files:**
- Modify: `packages/session/src/transcript-store.ts`
- Test: `packages/session/src/transcript-store.test.ts`（追加）

**Interfaces:**
- `SessionTranscriptStore.appendNativeEntries(messageId: string, entries: readonly { ordinal: number; entry: NativeContextEntry }[]): Promise<void>`（`INSERT OR IGNORE` 幂等）
- `SessionTranscriptStore.readNativeEntries(messageId: string): Promise<NativeContextEntry[]>`（按 ordinal 升序；truncated 行原样返回）
- `deleteMessage` / `truncateFrom` 同事务级联删除对应 `native_entry` 行

- [x] **Step 1: 失败测试**（追加到 transcript-store.test.ts，复用现有 openStore helper 风格）

```ts
it('persists, reads, cascades native entries', async () => {
  const store = await openStore();
  await store.appendMessage(baseInput({ id: 'a1', role: 'assistant' }));
  await store.appendNativeEntries('a1', [
    { ordinal: 0, entry: { format: 'pi-message-v1', payload: '{"role":"assistant"}', byteLength: 20 } },
    { ordinal: 1, entry: { format: 'pi-message-v1', payload: '', byteLength: 400000, truncated: true } },
  ]);
  // 幂等重放
  await store.appendNativeEntries('a1', [
    { ordinal: 0, entry: { format: 'pi-message-v1', payload: 'REPLAYED', byteLength: 8 } },
  ]);
  const entries = await store.readNativeEntries('a1');
  expect(entries).toHaveLength(2);
  expect(entries[0]?.payload).toBe('{"role":"assistant"}');
  expect(entries[1]?.truncated).toBe(true);
  await store.deleteMessage('a1');
  expect(await store.readNativeEntries('a1')).toHaveLength(0);
});

it('truncateFrom removes native entries of removed rows only', async () => {
  const store = await openStore();
  await store.appendMessage(baseInput({ id: 'u1', role: 'user' }));
  await store.appendMessage(baseInput({ id: 'a1', role: 'assistant' }));
  await store.appendNativeEntries('u1', [{ ordinal: 0, entry: entryOf('keep') }]);
  await store.appendNativeEntries('a1', [{ ordinal: 0, entry: entryOf('drop') }]);
  await store.truncateFrom('a1');
  expect(await store.readNativeEntries('u1')).toHaveLength(1);
  expect(await store.readNativeEntries('a1')).toHaveLength(0);
});
```

（`entryOf(payload)` 小 helper：`{ format: 'pi-message-v1', payload, byteLength: payload.length }`；
`baseInput` 沿用文件内既有构造习惯，若无同名 helper 则按现有测试样例内联字段。）

- [x] **Step 2: 跑测试失败** `pnpm --filter @piwin/session test -- transcript-store`
- [x] **Step 3: 实现**
  - 建表（`openSessionTranscriptStore` 的 `db.exec` 块内追加；不声明外键，手动级联）：

```sql
CREATE TABLE IF NOT EXISTS native_entry(
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  payload TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  truncated INTEGER NOT NULL DEFAULT 0,
  UNIQUE(message_id, ordinal)
);
CREATE INDEX IF NOT EXISTS idx_native_entry_message ON native_entry(message_id);
```

  - 方法实现（返回对象内追加）：

```ts
async appendNativeEntries(messageId, entries) {
  ensureOpen();
  if (entries.length === 0) return;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO native_entry(message_id, ordinal, payload, byte_length, truncated)
     VALUES (?, ?, ?, ?, ?)`,
  );
  db.exec('BEGIN');
  try {
    for (const { ordinal, entry } of entries) {
      insert.run(messageId, ordinal, entry.payload, entry.byteLength, entry.truncated === true ? 1 : 0);
    }
    db.exec('COMMIT');
  } catch (error) {
    rollback(db);
    throw error;
  }
},

async readNativeEntries(messageId) {
  ensureOpen();
  const rows = db
    .prepare(
      `SELECT payload, byte_length, truncated FROM native_entry
       WHERE message_id = ? ORDER BY ordinal ASC`,
    )
    .all(messageId) as Array<{ payload: string; byte_length: number; truncated: number }>;
  return rows.map((row) => ({
    format: 'pi-message-v1' as const,
    payload: row.payload,
    byteLength: row.byte_length,
    ...(row.truncated === 1 ? { truncated: true as const } : {}),
  }));
},
```

  - `deleteMessage`：DELETE 产品行成功后同事务
    `db.prepare('DELETE FROM native_entry WHERE message_id = ?').run(id)`。
  - `truncateFrom`：DELETE 行前先取被删 id 集合，同事务
    `DELETE FROM native_entry WHERE message_id IN (SELECT id FROM transcript_message WHERE sequence >= ?)`（放在删除 transcript_message 之前执行）。
  - `SessionTranscriptStore` 类型加两个方法签名（含 JSDoc：payload 不透明）。
  - 注意：native_entry 不参与 legacy digest（`digestDatabaseRows` 不变）。

- [x] **Step 4: 测试转绿** `pnpm --filter @piwin/session test -- transcript-store`
- [x] **Step 5: Commit（需用户授权）** 涉及两文件。

---

### Task 3: session — 重放种子构建纯函数

**Files:**
- Create: `packages/session/src/build-replay-seed.ts`
- Create: `packages/session/src/build-replay-seed.test.ts`
- Modify: `packages/session/src/index.ts`（导出）

**Interfaces:**
- `type ReplaySeedSourceRow = { message: SessionTranscriptMessage; native: NativeContextEntry[] }`
- `buildReplaySeedMessages(rows: readonly ReplaySeedSourceRow[], options?: { maxChars?: number }): { seedMessages: SessionSeedMessage[]; nativeRowCount: number }`
- `DEFAULT_REPLAY_SEED_MAX_CHARS = 400_000`

规则（spec §4.4）：
1. 输入 rows 为**时间正序**；预算从最新向旧装填（payload/text 字符计入）。
2. 一行原子性：该行全部 native 条目均在预算内且无 truncated → 该行 native；
   否则该行回落 text（text 同样计入预算，text 截断到 4000 字符对齐现行）。
3. 预算外的更旧行直接丢弃（现行文本注入同样有界）。
4. role 映射沿用 `buildCompactionSeedMessages`：assistant→assistant，其余→user；
   text 为空且无 native 的行跳过。
5. `nativeRowCount` 供调用方决定"有无原生可用"（=0 时调用方走现行文本注入路径）。

- [x] **Step 1: 失败测试**（新文件，覆盖：全 native、混合回落 truncated、预算边界丢旧留新、空输入）

```ts
import { describe, expect, it } from 'vitest';
import { buildReplaySeedMessages } from './build-replay-seed.js';
import type { NativeContextEntry, SessionTranscriptMessage } from '@piwin/contracts';

function row(id: string, role: 'user' | 'assistant', text: string, natives: string[] = [],
  truncated = false) {
  const message = {
    id, role, text, createdAt: new Date(1_700_000_000_000).toISOString(), status: 'done',
  } as SessionTranscriptMessage;
  const native: NativeContextEntry[] = natives.map((payload, index) => ({
    format: 'pi-message-v1', payload, byteLength: payload.length,
    ...(truncated && index === natives.length - 1 ? { truncated: true as const } : {}),
  }));
  return { message, native };
}

describe('buildReplaySeedMessages', () => {
  it('emits native seeds when entries fit budget', () => {
    const { seedMessages, nativeRowCount } = buildReplaySeedMessages([
      row('u1', 'user', 'question'),
      row('a1', 'assistant', 'answer', ['{"role":"assistant"}', '{"role":"toolResult"}']),
    ]);
    expect(nativeRowCount).toBe(1);
    expect(seedMessages[0]?.native).toBeUndefined();
    expect(seedMessages[1]?.native).toHaveLength(2);
  });

  it('falls back to text for truncated rows', () => {
    const { seedMessages, nativeRowCount } = buildReplaySeedMessages([
      row('a1', 'assistant', 'answer', ['{}'], true),
    ]);
    expect(nativeRowCount).toBe(0);
    expect(seedMessages[0]?.native).toBeUndefined();
    expect(seedMessages[0]?.text).toBe('answer');
  });

  it('drops oldest rows beyond budget, keeps newest', () => {
    const big = 'x'.repeat(300);
    const { seedMessages } = buildReplaySeedMessages(
      [row('u1', 'user', big), row('a1', 'assistant', big), row('u2', 'user', 'latest')],
      { maxChars: 350 },
    );
    expect(seedMessages.map((seed) => seed.text)).toEqual([big, 'latest']);
  });

  it('returns empty for empty input', () => {
    expect(buildReplaySeedMessages([]).seedMessages).toEqual([]);
  });
});
```

- [x] **Step 2: 跑测试失败**
- [x] **Step 3: 实现**

```ts
/** Build full-fidelity replay seeds from transcript rows + native copies (spec §4.4). */
import type {
  NativeContextEntry,
  SessionSeedMessage,
  SessionTranscriptMessage,
} from '@piwin/contracts';

export const DEFAULT_REPLAY_SEED_MAX_CHARS = 400_000;
const MAX_TEXT_CHARS_PER_MESSAGE = 4_000;

export type ReplaySeedSourceRow = {
  message: SessionTranscriptMessage;
  native: NativeContextEntry[];
};

export function buildReplaySeedMessages(
  rows: readonly ReplaySeedSourceRow[],
  options: { maxChars?: number } = {},
): { seedMessages: SessionSeedMessage[]; nativeRowCount: number } {
  const maxChars = options.maxChars ?? DEFAULT_REPLAY_SEED_MAX_CHARS;
  const selected: SessionSeedMessage[] = [];
  let usedChars = 0;
  let nativeRowCount = 0;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const source = rows[index];
    if (source === undefined) continue;
    const seed = buildRowSeed(source);
    if (seed === undefined) continue;
    const cost = seedChars(seed);
    if (usedChars + cost > maxChars) break;
    usedChars += cost;
    if (seed.native !== undefined) nativeRowCount += 1;
    selected.unshift(seed);
  }
  return { seedMessages: selected, nativeRowCount };
}

function buildRowSeed(source: ReplaySeedSourceRow): SessionSeedMessage | undefined {
  const { message, native } = source;
  const role = message.role === 'assistant' ? 'assistant' : 'user';
  const text = message.text.slice(0, MAX_TEXT_CHARS_PER_MESSAGE);
  const timestamp = Date.parse(message.createdAt) || Date.now();
  const usableNative = native.length > 0 && native.every((entry) => entry.truncated !== true);
  if (usableNative) {
    return { role, text, timestamp, native: [...native] };
  }
  if (text.trim().length === 0) return undefined;
  return { role, text, timestamp };
}

function seedChars(seed: SessionSeedMessage): number {
  if (seed.native !== undefined) {
    let total = 0;
    for (const entry of seed.native) total += entry.payload.length;
    return total;
  }
  return seed.text.length + 1;
}
```

`index.ts` 追加：
`export { buildReplaySeedMessages, DEFAULT_REPLAY_SEED_MAX_CHARS } from './build-replay-seed.js';`
`export type { ReplaySeedSourceRow } from './build-replay-seed.js';`

- [x] **Step 4: 测试转绿** `pnpm --filter @piwin/session test -- build-replay-seed`
- [x] **Step 5: Commit（需用户授权）**

---

### Task 4: agent-host — mapper 采集原生消息

**Files:**
- Modify: `packages/agent-host/src/event-map.ts`（`createPiSessionEventMapper` 的 `message_end` 分支，280–290 行）
- Modify: `packages/agent-host/src/generation-identity.ts`（`normalizeAgentEventIds`，106–115 行分组）
- Test: `packages/agent-host/src/event-map.test.ts`（追加）

**Interfaces:**
- 输入：Pi 原生 `message_end` 事件 `record.message`（`role: 'assistant' | 'toolResult'`）。
- 输出：`message/end` 之后追加一条 `message/native_context`（同一 wrap 批次）：
  assistant → `{ messageId, role: 'assistant', entry }`；
  toolResult → `{ messageId, role: 'toolResult', entry, responseMessageId: lastAssistantMessageId ?? undefined }`。
- 大小上限 `MAX_NATIVE_ENTRY_BYTES = 262_144`（UTF-8 字节）。

- [x] **Step 1: 失败测试**（追加，参考文件内既有 mapper 测试风格）

```ts
it('emits message/native_context after assistant and toolResult message_end', () => {
  const mapper = createPiSessionEventMapper();
  mapper.map({ type: 'message_start', message: { id: 'pa-1', role: 'assistant' } });
  const assistantEnd = mapper.map({
    type: 'message_end',
    message: { id: 'pa-1', role: 'assistant', content: [{ type: 'text', text: 'hi' }], timestamp: 1 },
  });
  const nativeEvents = assistantEnd.filter((w) => w.event.type === 'message/native_context');
  expect(nativeEvents).toHaveLength(1);
  const assistantNative = nativeEvents[0]?.event;
  if (assistantNative?.type !== 'message/native_context') throw new Error('missing');
  expect(assistantNative.role).toBe('assistant');
  expect(JSON.parse(assistantNative.entry.payload)).toMatchObject({ id: 'pa-1', role: 'assistant' });

  mapper.map({ type: 'message_start', message: { id: 'pt-1', role: 'toolResult' } });
  const toolEnd = mapper.map({
    type: 'message_end',
    message: { id: 'pt-1', role: 'toolResult', toolCallId: 'tc-1', content: [], isError: false, timestamp: 2 },
  });
  const toolNative = toolEnd.find((w) => w.event.type === 'message/native_context')?.event;
  if (toolNative?.type !== 'message/native_context') throw new Error('missing');
  expect(toolNative.role).toBe('toolResult');
  expect(toolNative.responseMessageId).toBe('pa-1');
});

it('marks oversized native payload truncated without payload body', () => {
  const mapper = createPiSessionEventMapper();
  mapper.map({ type: 'message_start', message: { id: 'pa-2', role: 'assistant' } });
  const events = mapper.map({
    type: 'message_end',
    message: {
      id: 'pa-2', role: 'assistant', timestamp: 3,
      content: [{ type: 'text', text: 'x'.repeat(300_000) }],
    },
  });
  const native = events.find((w) => w.event.type === 'message/native_context')?.event;
  if (native?.type !== 'message/native_context') throw new Error('missing');
  expect(native.entry.truncated).toBe(true);
  expect(native.entry.payload).toBe('');
});

it('does not emit native context for user message_end', () => {
  const mapper = createPiSessionEventMapper();
  mapper.map({ type: 'message_start', message: { id: 'pu-1', role: 'user' } });
  const events = mapper.map({
    type: 'message_end',
    message: { id: 'pu-1', role: 'user', content: 'q', timestamp: 4 },
  });
  expect(events.some((w) => w.event.type === 'message/native_context')).toBe(false);
});
```

- [x] **Step 2: 跑测试失败** `pnpm --filter @piwin/agent-host test -- event-map`
- [x] **Step 3: 实现**
  - `event-map.ts` 顶部：`const MAX_NATIVE_ENTRY_BYTES = 262_144;` 新函数：

```ts
function buildNativeContextEvent(
  record: Record<string, unknown>,
  mappedEndMessageId: string,
  lastAssistantMessageId: string | null,
): AgentEvent | undefined {
  const message = asRecord(record.message);
  if (!message) return undefined;
  const role = message.role;
  if (role !== 'assistant' && role !== 'toolResult') return undefined;
  let payload = '';
  try {
    payload = JSON.stringify(message);
  } catch {
    return undefined;
  }
  const byteLength = Buffer.byteLength(payload, 'utf8');
  const entry =
    byteLength > MAX_NATIVE_ENTRY_BYTES
      ? { format: 'pi-message-v1' as const, payload: '', byteLength, truncated: true as const }
      : { format: 'pi-message-v1' as const, payload, byteLength };
  if (role === 'toolResult') {
    return {
      type: 'message/native_context',
      messageId: mappedEndMessageId,
      role: 'toolResult',
      entry,
      ...(lastAssistantMessageId !== null ? { responseMessageId: lastAssistantMessageId } : {}),
    };
  }
  return { type: 'message/native_context', messageId: mappedEndMessageId, role: 'assistant', entry };
}
```

  - `createPiSessionEventMapper` 的 `if (type === 'message_end')` 块（280 行起）：在
    现有逻辑**读取 `endedMessage` 之后、置空 activeMessageId 之前**构造并追加。注意
    toolResult 需要 message_end 前的 `lastAssistantMessageId`，故在块首先保存
    `const assistantIdBeforeEnd = lastAssistantMessageId;` 供 toolResult 使用；
    assistant 自身的 native 事件 `messageId` 用 `endedMessage.messageId`（mapper 生成
    id 与 message/end 一致）；追加方式：`mappedEvents.push(nativeEvent)`（在
    `wrapEvents` 调用之前完成，使其获得 envelope）。
  - `generation-identity.ts`：`normalizeAgentEventIds` 新 case：

```ts
    case 'message/native_context': {
      return {
        ...event,
        messageId: normalizeGenerationMessageId(context, event.messageId),
        ...(event.responseMessageId !== undefined
          ? { responseMessageId: normalizeGenerationMessageId(context, event.responseMessageId) }
          : {}),
      };
    }
```

- [x] **Step 4: 测试转绿**（含既有 event-map / generation-identity 用例回归）
  `pnpm --filter @piwin/agent-host test -- event-map generation-identity`
- [x] **Step 5: Commit（需用户授权）**

---

### Task 5: agent-host — 原生重放 + seedMode 贯通

**Files:**
- Modify: `packages/agent-host/src/seeded-pi-session.ts`
- Modify: `packages/agent-host/src/backends/pi-session-backend.ts`（62 行 input 类型加 `seedMode?`）
- Modify: `packages/agent-host/src/backends/sdk-backend-session.ts`（~102 行种子应用处按 seedMode 分支）
- Modify: `packages/agent-host/src/rpc/worker-pi-session-factory.ts`（51–57 行 input 类型、332–347 行应用处）
- Modify: `packages/agent-host/src/rpc-sdk-worker-protocol.ts`（~195 行 create payload 加 `seedMode?`）
- Modify: `packages/agent-host/src/rpc-sdk-worker-client.ts`（~376 行透传）
- Modify: `packages/agent-host/src/rpc/worker-session-runtime.ts`（67 行类型、207 行透传）
- Modify: `packages/agent-host/src/backends/worker-rpc-session-backend.ts`（~87 行透传）
- Modify: `packages/agent-host/src/worker-task-runner.ts`（142 行透传，显式 `seedMode: 'compaction'`）
- Test: `packages/agent-host/src/seeded-pi-session.test.ts`（追加）

**Interfaces:**
- `createSeededPiSessionManager(piModule, cwd, seedMessages)`：`seed.native` 存在且全部
  可解析 → 逐条 `manager.appendMessage(JSON.parse(entry.payload))`；任一条解析失败或
  truncated → 该 seed 整体回落现行 `toPiMessage` 文本路径。
- `SeedablePiMessage` 类型放宽为 `UserMessage | AssistantMessage | Record<string, unknown>`
  （toolResult 经 JSON 解析后原样追加；Pi `appendMessage` 接受完整 Message 联合）。
- 种子应用处规则（两处一致）：

```ts
if (input.seedMessages) {
  sessionOptions.sessionManager = createSeededPiSessionManager(
    piModule as Record<string, unknown>, cwd, input.seedMessages,
  );
  if (input.seedMode !== 'replay') {
    sessionOptions.settingsManager = createSeededPiSettingsManager(
      piModule as Record<string, unknown>,
    );
  }
}
```

- [x] **Step 1: 失败测试**（seeded-pi-session.test.ts 追加；文件内已有 fake piModule 模式，复用其 SessionManager stub 并记录 appendMessage 参数）

```ts
it('replays native entries verbatim and falls back per-seed on truncation', () => {
  const appended: unknown[] = [];
  const piModule = {
    SessionManager: { inMemory: () => ({ appendMessage: (m: unknown) => { appended.push(m); return 'id'; } }) },
  };
  const nativeAssistant = JSON.stringify({ role: 'assistant', content: [{ type: 'toolCall', id: 't1', name: 'bash', arguments: {} }], timestamp: 5 });
  const nativeToolResult = JSON.stringify({ role: 'toolResult', toolCallId: 't1', toolName: 'bash', content: [{ type: 'text', text: 'out' }], isError: false, timestamp: 6 });
  createSeededPiSessionManager(piModule, '/tmp', [
    { role: 'user', text: 'run it', timestamp: 4 },
    {
      role: 'assistant', text: 'ok', timestamp: 5,
      native: [
        { format: 'pi-message-v1', payload: nativeAssistant, byteLength: nativeAssistant.length },
        { format: 'pi-message-v1', payload: nativeToolResult, byteLength: nativeToolResult.length },
      ],
    },
    {
      role: 'assistant', text: 'fallback text', timestamp: 7,
      native: [{ format: 'pi-message-v1', payload: '', byteLength: 999999, truncated: true }],
    },
  ]);
  expect(appended).toHaveLength(4);
  expect(appended[1]).toMatchObject({ role: 'assistant' });
  expect(appended[2]).toMatchObject({ role: 'toolResult', toolCallId: 't1' });
  expect(appended[3]).toMatchObject({ role: 'assistant', content: [{ type: 'text', text: 'fallback text' }] });
});
```

- [x] **Step 2: 跑测试失败**
- [x] **Step 3: 实现** seeded-pi-session.ts 循环体：

```ts
  for (const message of seedMessages) {
    const nativeMessages = parseNativeEntries(message.native);
    if (nativeMessages !== undefined) {
      for (const nativeMessage of nativeMessages) {
        manager.appendMessage(nativeMessage as SeedablePiMessage);
      }
      continue;
    }
    const text = message.text.trim();
    if (!text) continue;
    manager.appendMessage(toPiMessage(message, text));
  }
```

```ts
function parseNativeEntries(
  entries: readonly NativeContextEntry[] | undefined,
): Record<string, unknown>[] | undefined {
  if (entries === undefined || entries.length === 0) return undefined;
  const parsed: Record<string, unknown>[] = [];
  for (const entry of entries) {
    if (entry.truncated === true || entry.payload.length === 0) return undefined;
    try {
      const value = JSON.parse(entry.payload) as unknown;
      if (typeof value !== 'object' || value === null) return undefined;
      parsed.push(value as Record<string, unknown>);
    } catch {
      return undefined;
    }
  }
  return parsed;
}
```

  其余文件为 `seedMode?: 'compaction' | 'replay'` 字段透传 + 两处应用分支（见上）。
  `worker-task-runner.ts` 142 行处补 `seedMode: 'compaction'` 显式保留现行为。
- [x] **Step 4: 测试转绿 + 包内回归** `pnpm --filter @piwin/agent-host test`
- [x] **Step 5: Commit（需用户授权）**

---

### Task 6: host-runtime — recorder 落库

**Files:**
- Modify: `packages/host-runtime/src/store-transcript-recorder.ts`（`recordEvent` switch 增 case）
- Test: `packages/host-runtime/src/store-transcript-recorder.test.ts`（追加）

**Interfaces:**
- `message/native_context` 处理：
  - `role === 'assistant'` → 目标行 = `event.messageId`；
  - `role === 'toolResult'` → 目标行 = `event.responseMessageId ?? lastAssistantId`，均无则丢弃（warn 日志一次）；
  - ordinal：`nativeOrdinalsByMessageId: Map<string, number>` 递增；session 结束/dispose 时清空（放入现有清理路径）。
  - 写入走 `store.appendNativeEntries(targetId, [{ ordinal, entry: event.entry }])`，直接
    `await`（同 enqueue 队列内，顺序天然在行创建之后）。
  - quarantine 检查与其他 message 事件一致（`quarantinedMessageIds.has(targetId)` 跳过）。

- [x] **Step 1: 失败测试**（复用该测试文件既有 recorder + 内存 store 装配；断言 assistant 行收到 ordinal 0/1 两条：自身 + toolResult）

```ts
it('persists native context entries onto the owning assistant row', async () => {
  const { recorder, store } = await createRecorderHarness(); // 沿用文件内既有 helper 命名
  await recorder.recordEvent({ type: 'message/start', messageId: 'a1', role: 'assistant' });
  await recorder.recordEvent({
    type: 'message/native_context', messageId: 'a1', role: 'assistant',
    entry: { format: 'pi-message-v1', payload: '{"role":"assistant"}', byteLength: 20 },
  });
  await recorder.recordEvent({
    type: 'message/native_context', messageId: 'tr1', role: 'toolResult', responseMessageId: 'a1',
    entry: { format: 'pi-message-v1', payload: '{"role":"toolResult"}', byteLength: 21 },
  });
  await recorder.recordEvent({ type: 'message/end', messageId: 'a1' });
  await recorder.flush();
  const entries = await store.readNativeEntries('a1');
  expect(entries.map((entry) => JSON.parse(entry.payload).role)).toEqual(['assistant', 'toolResult']);
});
```

（helper 名与真实文件对齐；若该文件用真实 sqlite 临时目录装配则沿用之。）

- [x] **Step 2: 跑测试失败** `pnpm --filter @piwin/host-runtime test -- store-transcript-recorder`
- [x] **Step 3: 实现**（case 放在 `message/end` case 之前）
- [x] **Step 4: 测试转绿**
- [x] **Step 5: Commit（需用户授权）**

---### Task 7: host-runtime — 冷激活 native seed、文本回落与 egress 过滤

**Files:**
- Modify: `packages/host-runtime/src/product-shell-session.ts`（Options 加 `takePendingSeed`）
- Modify: `packages/host-runtime/src/host-runtime.ts`（创建 shell 处传入 seed 提取器；4865 行 push 过滤；4868 行父转发过滤）
- Modify: `packages/host-runtime/src/commands/session-live-commands.ts`（~918 行文本注入分支前加 native 判定）
- Test: `packages/host-runtime/src/host-runtime.test.ts` 或该文件既有命令测试处追加（egress 过滤 + seed 决策）

**Interfaces:**
- `ProductShellSessionOptions.takePendingSeed?: () => { seedMessages: readonly SessionSeedMessage[]; seedMode: 'replay' } | undefined`
  — `ensureLive` 在 `createLiveSession` 前调用一次，结果并入
  `options.createLiveSession(createInput, seedOptions)`；`createLiveSession` 签名扩为
  `(input: CreateSessionInput, options?: CreateSessionOptions) => Promise<SessionHandle>`，
  host-runtime 侧实现转发 `ProductAgentHost.createSession(input, options)`（161 行签名已支持）。
- host-runtime 持有 `pendingReplaySeedBySession: Map<string, SessionSeedMessage[]>`；
  `armReplaySeed(sessionId, seeds)` / shell 的 takePendingSeed 消费即删。
- 决策点（session-live-commands ~918 行，现文本注入 try 块开头）：

```ts
const nativeSeedArmed = await context.tryArmNativeReplaySeed(sessionId, promptInput.clientMessageId);
if (!nativeSeedArmed) {
  // 现行文本注入路径原样保留
}
context.markProductHistoryInjected(sessionId);
```

- `tryArmNativeReplaySeed`（host-runtime 上下文实现）：
  1. `store.listTail(100)`（排除 `clientMessageId` 对应行）；
  2. 逐行 `store.readNativeEntries(id)` 组装 `ReplaySeedSourceRow[]`；
  3. `buildReplaySeedMessages(rows)`；`nativeRowCount === 0` → return false；
  4. `armReplaySeed(sessionId, seedMessages)` → return true。
- egress 过滤（host-runtime.ts 4862–4870）：

```ts
if (correlatedEvent.type !== 'message/native_context') {
  const eventForClients = enrichAgentEventDocumentTargets(correlatedEvent, { ... });
  this.push({ type: 'event', sessionId: session.id, event: eventForClients });
  if (parentSessionId) { /* 现有父转发同样留在该分支内 */ }
}
// recorder / hooks / usage 路径不变，native 事件继续到达 recorder
```

（实现时确认 recorder 的 recordEvent 调用点在该 push 之外——若在同分支，需把
recorder 调用移出过滤条件。）

- [x] **Step 1: 失败测试**
  1. egress：装配 mock 后端发出 `message/native_context`，断言 push 回调未收到该事件
     但 store 收到 native 行（复用 host-runtime.test.ts 既有 mock-session 装配）。
  2. seed 决策：预置 store（a1 行含 native），调用 prompt 命令路径，断言
     `promptInput.text` 未被拼接 `[piwin-product-history]` 且 shell 收到 seedMessages
     （通过注入 fake createLiveSession 捕获 options）。
- [x] **Step 2: 跑测试失败**
- [x] **Step 3: 实现**（product-shell-session ensureLive 内：）

```ts
const pendingSeed = options.takePendingSeed?.();
const created = await options.createLiveSession(
  createInput,
  pendingSeed !== undefined
    ? { seedMessages: pendingSeed.seedMessages, seedMode: pendingSeed.seedMode }
    : undefined,
);
```

- [x] **Step 4: 测试转绿 + 包内回归** `pnpm --filter @piwin/host-runtime test`
- [x] **Step 5: Commit（需用户授权）**

---

### Task 8: host-runtime — fork/duplicate 复制副本

**Files:**
- Modify: `packages/host-runtime/src/commands/session-product-commands.ts`
  （383–388 与 480–502 两个 `iterateAll` 循环、`appendDerivedMessage` 597 行）
- Test: `packages/host-runtime/src/session-transcript-derived-ops.integration.test.ts`（追加断言）

**Interfaces:**
- `appendDerivedMessage(store, message)` 不变；两个循环体内 append 后追加：

```ts
const nativeEntries = await sourceStore.readNativeEntries(message.id);
if (nativeEntries.length > 0) {
  await targetStore.appendNativeEntries(
    cloned.id,
    nativeEntries.map((entry, ordinal) => ({ ordinal, entry })),
  );
}
```

（fork/duplicate 的 `cloneTranscriptMessage` 保持 id 不变；若实现里 clone 改 id，则以
`cloned.id` 为准——测试覆盖。）

- [x] **Step 1: 失败测试**：integration 测试中给源会话某 assistant 行写 native 两条 →
  执行 `session/fork` → 断言目标 store `readNativeEntries` 同两条、payload 逐字节相等；
  duplicate 同理一条用例。
- [x] **Step 2: 跑测试失败** `pnpm --filter @piwin/host-runtime test -- session-transcript-derived-ops`
- [x] **Step 3: 实现**
- [x] **Step 4: 测试转绿**
- [x] **Step 5: Commit（需用户授权）**

---

### Task 9: 全局验证与文档收尾

- [x] `pnpm typecheck`（全仓）
- [x] `pnpm test`（全仓；关注 desktop reducer 对未知 AgentEvent 变体的容忍性——egress
  已过滤，`host-client-mock.ts` 无需改动）
- [ ] 手工冒烟（记录到 PR/notes）：
  1. Desktop 新会话 → 让模型跑一次 bash 工具 → 重启 Host → 继续提问"刚才命令输出是什么"
     → 模型应答出真实输出；
  2. fork 该会话 → 同样提问 → 同样答出；
  3. 老会话（无副本）→ 继续对话 → 行为与现状一致（文本注入日志出现）。
- [x] 更新 `docs/specs/session-conversation-tree.md`：S1 状态改
  `Implemented (S1) — <commit/日期>`；若实现与 spec 有偏差，在 spec §4 内以
  "Implementation note" 标注。
- [x] Commit（需用户授权）文档变更。

## 执行结果（2026-08-13）

T1–T9 实现与测试全部完成；全仓 `pnpm typecheck` 与 `pnpm test` 全绿
（host-runtime 1262、desktop 1292 等）。与计划正文的偏差：

1. **T7 落点**：未给 `product-shell-session` 加 `takePendingSeed`。冷激活 seed 统一在
   `host-runtime.ts` 的 `doActivateSessionRuntime` 内完成：新模块
   `cold-activation-seed.ts` 的 `buildColdActivationSeedOptions(store, excludeMessageId)`
   读 `listTail(100)` + 逐行 `readNativeEntries` → `buildReplaySeedMessages`，产出
   `CreateSessionOptions { seedMessages, seedMode: 'replay' }` 直接传给
   `host.activateSession`。`nativeRowCount === 0` 时返回 undefined →
   照旧置 `coldStartHistoryBySession` 标记走现行文本注入，无副本行为不回退。
   当前 prompt 的用户行在激活前已落库，通过
   `activateSessionRuntime(..., excludeSeedMessageId = promptInput.clientMessageId)` 排除。
2. **egress 过滤**：在 host-runtime 事件推送管线内，`message/native_context` 分支
   直接交给 recorder 落库后 return，不进入 `push`/父转发/hook 路径。
   `host-push-policy.ts` 仍补了防御性 case（exhaustive switch 要求）。
3. **mock 对齐**：`mock-session.ts` 在 assistant `message/end` 后镜像发出
   `message/native_context`，使 mock 模式可端到端验证落库与 egress 过滤
   （host-runtime.test.ts 两条新用例 + 冷启动重放/回落两条用例）。
4. **T8**：`cloneTranscriptMessage` 会重生成 id，复制按 源id→新id 映射
   （`copyNativeEntries` helper），fork 与 duplicate 两循环各调用一次；
   集成用例断言目标会话 assistant 行携带同 payload 副本。
5. **既有测试语义更新**：原"cold prompt injects bounded history exactly once"
   拆为两条——有 native 副本走重放（断言无 `[piwin-product-history]` 标记）、
   删除 native_entry 模拟 legacy 会话仍走文本注入 exactly-once。
6. 已按包分 5 个提交入库（contracts / session / agent-host / host-runtime / docs，2026-08-13）。手工冒烟（真实 Pi 后端三场景）仍待做。

## Self-Review 结论

- spec §4.1–§4.5 每条均有对应任务（4.1→T1，4.2→T2，4.3→T4/T6，4.4→T3/T5/T7 + fork
  复制 T8，4.5→各任务测试步骤）。
- 类型/签名跨任务一致性已核对：`NativeContextEntry`（T1）被 T2/T3/T4/T5/T6 引用；
  `appendNativeEntries(messageId, [{ordinal, entry}])` 在 T2 定义、T6/T8 消费；
  `seedMode` 在 T1 定义、T5 贯通、T7 以 `'replay'` 使用。
- 无 TBD/占位符；所有修改点均带文件与行号锚。
