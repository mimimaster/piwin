import { describe, expect, it } from 'vitest';
import {
  extractContentFieldFromInputPreview,
  extractMarkdownDocumentFromMessage,
  resolveDocumentContentFromMessages,
} from './resolve-document-content';

/**
 * Regression fixture shaped like session-mskcz6eh-8mv59r6y message 28:
 * a complete plan with TypeScript fences. The old App.tsx regex grabbed the
 * prose *between* two ```ts fences (Slice 2-4 only) — that is the half-cut bug.
 */
const FINAL_PLAN_MESSAGE = `两次写入都被宿主权限策略拒绝。最终完整版如下，可直接保存为 \`docs/design/session-lifecycle-archive.md\`。

---

# 执行计划：Session 生命周期与归档策略（最终落档版）

## 1. 目标与非目标

**目标**：可配置的会话生命周期管理。

**已锁定决策**：自动删除默认关 · 无损 gzip · 默认 monthly。

## 2. 约束

依赖方向 contracts ← session ← host-runtime。

## 3. 垂直切片

### Slice 1 — contracts

\`\`\`ts
type GeneralConfig = { sessionArchive?: SessionArchivePolicy };
type SessionArchivePolicy = {
  enabled: boolean; // false
  dryRun: boolean; // true
};
\`\`\`
\`PiwinConfig\` 加 \`general?\`；\`HostCommand\`（ipc.ts ~L427 区）加 \`{ type: 'session/lifecycle-run'; dryRun?: boolean }\`；\`SessionLifecycleRunResult\` 放 contracts 共用。**退出**：typecheck 绿 + 默认值符合锁定决策。

**Slice 2 — session 纯函数**（新增 \`src/session-lifecycle.ts\` + test）
\`selectSessionsForArchive(records, policy, now)\`：跳过已归档。

**Slice 3 — session gzip**（改 \`message-store.ts\`）
\`loadSessionTranscript\` 无 .json 时探测 \`.gz\`。

**Slice 4 — session 执行器**（\`session-lifecycle.ts\` 续）

\`\`\`ts
runSessionLifecycle({ indexPath, sessionRootDir, lifecyclePath, policy }): Promise<Result>
\`\`\`

### Slice 5 — host-runtime 命令 + 调度

scheduler 默认不启 timer。

### Slice 6 — CLI

\`piwin session lifecycle run [--dry-run]\`

### Slice 7 — Desktop（可延后）

Settings → General「会话归档」分组。

## 4. 风险

loadSessionTranscript 变更最高风险。

## 5. 执行顺序

1 → 2 → 3 → 4 → 5 → 6 → 7

**下一步需要你选**：① 本会话无法写文件；② 若无异议，开工顺序建议从 Slice 1 + 2 开始。
`;

describe('extractMarkdownDocumentFromMessage', () => {
  it('returns the full H1 plan, not the prose trapped between ts fences', () => {
    const resolved = extractMarkdownDocumentFromMessage(
      FINAL_PLAN_MESSAGE,
      'session-lifecycle-archive',
      'docs/design/session-lifecycle-archive.md',
    );

    expect(resolved).not.toBeNull();
    expect(resolved?.startsWith('# 执行计划：Session 生命周期与归档策略（最终落档版）')).toBe(true);
    expect(resolved).toContain('## 1. 目标与非目标');
    expect(resolved).toContain('### Slice 5 — host-runtime');
    expect(resolved).toContain('## 5. 执行顺序');
    expect(resolved).toContain('开工顺序建议从 Slice 1 + 2 开始');
    // The old bug stopped at Slice 4 mid-sentence and never reached Slice 5+.
    expect(resolved).not.toMatch(/^`PiwinConfig` 加/);
  });

  it('does not treat bare ``` / ```ts fences as the document body', () => {
    const text = [
      'See docs/design/session-lifecycle-archive.md',
      '',
      '```ts',
      'const x = 1;',
      '```',
      '',
      'Not the doc.',
    ].join('\n');

    const resolved = extractMarkdownDocumentFromMessage(
      text,
      'session-lifecycle-archive',
      'docs/design/session-lifecycle-archive.md',
    );
    expect(resolved).toBeNull();
  });

  it('accepts an explicit markdown fence as document body', () => {
    const text = [
      'Saved to notes/hello.md',
      '',
      '```markdown',
      '# Hello',
      '',
      'Full body here with enough characters to pass the usefulness threshold pad pad pad.',
      '```',
    ].join('\n');

    const resolved = extractMarkdownDocumentFromMessage(text, 'hello', 'notes/hello.md');
    expect(resolved).toBe(
      '# Hello\n\nFull body here with enough characters to pass the usefulness threshold pad pad pad.',
    );
  });

  it('prefers a complete standalone heading over a short fenced example', () => {
    const text = [
      'Saved to notes/plan.md',
      '',
      '```markdown',
      '# Tiny',
      'short',
      '```',
      '',
      '# Complete Plan',
      '',
      'This is the actual complete document body with enough content to pass the usefulness threshold.',
    ].join('\n');

    const resolved = extractMarkdownDocumentFromMessage(text, 'plan', 'notes/plan.md');
    expect(resolved).toBe(
      '# Complete Plan\n\nThis is the actual complete document body with enough content to pass the usefulness threshold.',
    );
  });

  it('keeps inner triple-backtick code inside a four-backtick markdown fence', () => {
    const text = [
      'Saved to notes/plan.md',
      '',
      '````markdown',
      '# Complete Plan',
      '',
      '```ts',
      'const answer = 42;',
      '```',
      '',
      'The document tail must remain present after the nested code block.',
      '`````',
    ].join('\n');

    const resolved = extractMarkdownDocumentFromMessage(text, 'plan', 'notes/plan.md');
    expect(resolved).toContain('```ts\nconst answer = 42;\n```');
    expect(resolved).toContain('The document tail must remain present');
    expect(resolved).not.toContain('`````');
  });

  it('does not treat a backtick line with an info string as a closing fence', () => {
    const text = [
      'Saved to notes/plan.md',
      '',
      '````markdown',
      '# Complete Plan',
      '',
      '````ts',
      'const example = true;',
      '',
      'The real document tail must not be truncated by the info-string line.',
      '`````',
    ].join('\n');

    const resolved = extractMarkdownDocumentFromMessage(text, 'plan', 'notes/plan.md');
    expect(resolved).toContain('````ts\nconst example = true;');
    expect(resolved).toContain('The real document tail must not be truncated');
    expect(resolved).not.toContain('`````');
  });
});

describe('extractContentFieldFromInputPreview', () => {
  it('parses complete write_file JSON args', () => {
    const content = '# Title\n\nBody of the design document with enough length for usefulness.';
    const preview = JSON.stringify({
      path: 'docs/design/session-lifecycle-archive.md',
      content,
    });
    expect(extractContentFieldFromInputPreview(preview)).toBe(content);
  });

  it('recovers content from truncated write_file JSON preview', () => {
    const content =
      '# Session 生命周期与归档策略 — 设计方案\n\n> 状态：draft\n\n## 一、目标\n完整正文继续……';
    const full = JSON.stringify({
      path: 'docs/design/session-lifecycle-archive.md',
      content,
    });
    const truncated = `${full.slice(0, 80)}…`;
    const recovered = extractContentFieldFromInputPreview(truncated);
    expect(recovered).not.toBeNull();
    expect(recovered?.startsWith('# Session 生命周期')).toBe(true);
  });
});

describe('resolveDocumentContentFromMessages', () => {
  it('reproduces the half-cut regression and returns the full plan', () => {
    const messages = [
      {
        text: '全部证据齐了。写设计文档到 `docs/design/session-lifecycle-archive.md`。',
        tools: [
          {
            toolName: 'write_file',
            output: 'Permission denied: Permission deny for write_file: piwin-config',
            presentation: {
              inputPreview:
                '{"path":"docs/design/session-lifecycle-archive.md","content":"# Session 生命周期与归档策略 — 设计方案\\n\\n> 状…',
              targetPaths: ['docs/design/session-lifecycle-archive.md'],
            },
          },
        ],
      },
      {
        text: FINAL_PLAN_MESSAGE,
        tools: [],
      },
    ];

    const resolved = resolveDocumentContentFromMessages({
      title: 'session-lifecycle-archive',
      path: 'docs/design/session-lifecycle-archive.md',
      messages,
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.length ?? 0).toBeGreaterThan(1000);
    expect(resolved).toContain('# 执行计划：Session 生命周期与归档策略（最终落档版）');
    expect(resolved).toContain('### Slice 5 — host-runtime');
    expect(resolved).toContain('## 5. 执行顺序');
    // Must not be the inter-fence fragment that ended at Slice 4.
    expect(resolved?.trimStart().startsWith('`PiwinConfig`')).toBe(false);
    expect(resolved).not.toMatch(/\*\*Slice 4 — session 执行器\*\*[^\n]*$/);
  });

  it('prefers full write_file content over message body when available', () => {
    const writeBody = [
      '# Written Plan',
      '',
      'This is the body that was actually passed to write_file and should win.',
      'Pad pad pad pad pad pad pad pad pad pad pad pad pad.',
    ].join('\n');

    const resolved = resolveDocumentContentFromMessages({
      title: 'plan',
      path: 'docs/plan.md',
      messages: [
        {
          text: '# Older draft in chat\n\nShould lose to write tool content with enough padding here.',
          tools: [
            {
              toolName: 'write_file',
              output: 'Permission denied',
              presentation: {
                inputPreview: JSON.stringify({ path: 'docs/plan.md', content: writeBody }),
                targetPaths: ['docs/plan.md'],
              },
            },
          ],
        },
      ],
    });

    expect(resolved).toBe(writeBody);
  });

  it('uses real session transcript and returns full plan not inter-fence fragment', async () => {
    const { readFile } = await import('node:fs/promises');
    const transcriptPath = `${process.env.HOME}/.piwin/sessions/session-mskcz6eh-8mv59r6y/transcript.json`;
    let raw: string;
    try {
      raw = await readFile(transcriptPath, 'utf8');
    } catch {
      // Machine without the original session — skip rather than fail CI.
      return;
    }
    const document = JSON.parse(raw) as {
      messages: Array<{
        text?: string;
        tools?: Array<{
          toolName?: string;
          output?: string;
          presentation?: {
            inputPreview?: string;
            targetPaths?: string[];
          };
        }>;
      }>;
    };

    // Old buggy algorithm: first optional-markdown fence match.
    // The newest matching message may wrap the whole plan in a ```markdown
    // fence (then the old bug also gets the full plan); keep walking back to
    // the historical message where the old bug produced an inter-fence
    // fragment — that is the regression this test pins down.
    const oldBugPattern = /```(?:markdown|md)?\n([\s\S]*?)\n```/i;
    let oldBugBody: string | null = null;
    for (let index = document.messages.length - 1; index >= 0; index -= 1) {
      const text = document.messages[index]?.text ?? '';
      if (
        text.includes('session-lifecycle-archive') ||
        text.includes('docs/design/session-lifecycle-archive.md')
      ) {
        const match = oldBugPattern.exec(text);
        // The fragment must be an inter-fence prose block (not a heading
        // document, not a file-path listing) — it contains Slice references
        // but does not start with `#`.
        if (match?.[1] && !match[1].trimStart().startsWith('#') && match[1].includes('Slice ')) {
          oldBugBody = match[1];
          break;
        }
      }
    }
    expect(oldBugBody).not.toBeNull();
    // Prove the old bug really produced the half-cut fragment on this session.
    expect(oldBugBody).toContain('Slice 2');
    expect(oldBugBody).toContain('Slice 4');
    expect(oldBugBody).not.toContain('Slice 5');
    expect(oldBugBody?.trimStart().startsWith('#')).toBe(false);

    const resolved = resolveDocumentContentFromMessages({
      title: 'session-lifecycle-archive',
      path: 'docs/design/session-lifecycle-archive.md',
      messages: document.messages,
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.startsWith('#')).toBe(true);
    expect(resolved).toContain('Slice 5');
    expect(resolved).toContain('Slice 7');
    expect(resolved?.length ?? 0).toBeGreaterThan((oldBugBody?.length ?? 0) * 2);
  });
});
