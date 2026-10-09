import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Each test starts a Host and waits on real pushes; the harness has its own shorter, explaining timeout.
vi.setConfig({ testTimeout: 20_000 });
import { KEY, startTuiHarness, type TuiHarness } from './tui-e2e.harness.js';
import { hostData } from './tui-host-link.js';

/** A real 1x1 PNG: the Host inspects image bytes when it stores an attachment. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

describe('TUI end to end against a mock Host', () => {
  let tui: TuiHarness | undefined;

  afterEach(async () => {
    await tui?.dispose();
    tui = undefined;
  });

  /** Send a message and wait for the mock's reply to finish. */
  async function converse(harness: TuiHarness, text: string): Promise<void> {
    harness.mark();
    await harness.submit(text);
    await harness.waitFor(`you said: ${text}`);
    await harness.waitFor('mock_echo');
    // The reply is drawn before the run's terminal record arrives.
    await harness.waitForIdle();
  }

  describe('conversation', () => {
    it('sends the first message of a new conversation and shows the reply', async () => {
      tui = await startTuiHarness();
      await tui.waitFor('输入消息开始对话');
      await tui.submit('你好，第一条');
      await tui.waitFor('› 你好，第一条');
      await tui.waitFor('you said: 你好，第一条');
      await tui.waitFor('mock_echo');
    });

    it('lists its commands and leaves an unknown slash word to the agent', async () => {
      tui = await startTuiHarness();
      await tui.submit('/help');
      await tui.waitFor('/sessions  切换、搜索、重命名、归档会话');
      await tui.waitFor('Shift+Tab 权限模式');
      await converse(tui, '/not-a-tui-command');
    });

    it('cycles the Run Mode with Shift+Tab and names the Host default', async () => {
      tui = await startTuiHarness();
      await tui.waitFor('权限 放行（Host）');
      tui.mark();
      await tui.press(KEY.shiftTab);
      await tui.waitFor('权限 询问');
      await tui.press(KEY.shiftTab);
      await tui.waitFor('权限 自动');
    });

    it('exits on Ctrl+D with an empty composer', async () => {
      tui = await startTuiHarness();
      await tui.press(KEY.ctrlD);
      expect(tui.exited()).toBe(true);
    });
  });

  describe('sessions', () => {
    it('renames the session and finds it again in the picker', async () => {
      tui = await startTuiHarness();
      await converse(tui, '最初的话');
      tui.mark();
      await tui.submit('/rename 改过名的会话');
      await tui.waitFor('改过名的会话 ·');
      tui.mark();
      await tui.press(KEY.ctrlS);
      await tui.waitFor('搜索');
      await tui.waitFor('今天');
      await tui.waitFor('改过名的会话');
    });

    it('says there are no sessions yet', async () => {
      tui = await startTuiHarness();
      tui.mark();
      await tui.press(KEY.ctrlS);
      await tui.waitFor('还没有会话');
    });

    it('shows a session list failure inside the picker', async () => {
      tui = await startTuiHarness();
      const listing = tui.holdRequests('session/list');
      tui.mark();
      await tui.press(KEY.ctrlS);
      await tui.waitFor('加载中');
      listing.fail('list boom');
      await tui.waitFor('list boom');
    });

    it('keeps archived sessions folded until Tab', async () => {
      tui = await startTuiHarness();
      await converse(tui, '要归档的话');
      tui.mark();
      await tui.submit('/rename 待归档会话');
      await tui.waitFor('待归档会话 ·');
      tui.mark();
      await tui.press(KEY.ctrlS);
      await tui.waitFor('待归档会话');
      await tui.press(KEY.ctrlX);
      await tui.waitFor('再按 Ctrl+X');
      await tui.press(KEY.ctrlX);
      await tui.waitFor('已折叠');
      tui.mark();
      await tui.press(KEY.tab);
      await tui.waitFor('待归档会话');
    });

    it('filters the open list by project from the keyboard', async () => {
      tui = await startTuiHarness({ project: true });
      await tui.waitFor('fixture');
      await converse(tui, '项目里的第一句');
      tui.mark();
      await tui.submit('/rename 项目会话');
      await tui.waitFor('项目会话 ·');
      const created = hostData<{ sessionId: string }>(
        await tui.asOtherShell({
          type: 'session/create',
          input: { scope: { kind: 'general' }, sessionName: '通用会话' },
        }),
      );
      await tui.asOtherShell({
        type: 'session/rename',
        sessionId: created.sessionId,
        name: '通用会话',
      });
      tui.mark();
      await tui.press(KEY.ctrlS);
      await tui.waitFor('会话 · 全部');
      await tui.waitFor('项目会话');
      await tui.waitFor('通用会话');
      tui.mark();
      await tui.press(KEY.ctrlP);
      await tui.waitFor('会话 · 对话');
      expect(tui.seen()).not.toContain('项目会话');
      tui.mark();
      await tui.press(KEY.ctrlP);
      await tui.waitFor('会话 · fixture');
      await tui.waitFor('项目会话');
    });

    it('starts a fresh draft and reopens the earlier session from the picker', async () => {
      tui = await startTuiHarness();
      await converse(tui, '早先的对话');
      tui.mark();
      await tui.submit('/new');
      await tui.waitFor('输入消息开始对话');
      await tui.press(KEY.ctrlS);
      await tui.waitFor('早先的对话');
      tui.mark();
      await tui.press(KEY.enter);
      await tui.waitFor('you said: 早先的对话');
    });

    it('keeps session switching out of reach when embedded', async () => {
      tui = await startTuiHarness({ embedded: true });
      await tui.submit('/sessions');
      await tui.waitFor('内嵌模式下请用 Desktop 侧栏切换会话');
    });
  });

  describe('composer inputs in a project', () => {
    it('completes a file mention from the Host listing and sends it as a reference', async () => {
      tui = await startTuiHarness({ project: true });
      await tui.waitFor('fixture');
      tui.mark();
      await tui.press(...'看 @sr');
      await tui.waitFor('src/');
      await tui.press(KEY.tab);
      await tui.press('a');
      await tui.waitFor('a.ts');
      await tui.press(KEY.tab);
      tui.mark();
      await tui.press(KEY.enter);
      await tui.waitFor('› 看 @src/a.ts');
      await tui.waitFor('⎿ @src/a.ts');
    });

    it('finds a deep file by a fragment of its name', async () => {
      tui = await startTuiHarness({ project: true });
      await tui.waitFor('fixture');
      tui.mark();
      await tui.press(...'@butt');
      await tui.waitFor('src/ui/button.tsx');
    });

    it('uploads an attached file and sends it with the next message', async () => {
      tui = await startTuiHarness({ project: true });
      const image = path.join(tui.projectPath ?? '', 'shot.png');
      writeFileSync(image, PNG_1X1);
      await tui.submit(`/attach ${image}`);
      await tui.waitFor('附件 1');
      tui.mark();
      await tui.submit('看这张图');
      await tui.waitFor('⎿ 附件 shot.png');
      await tui.waitFor('mock_echo');
    });

    it('refuses a file type the Host would not accept, before uploading', async () => {
      tui = await startTuiHarness();
      const blob = path.join(process.env.PIWIN_ROOT ?? '', 'blob.bin');
      writeFileSync(blob, Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));
      await tui.submit(`/attach ${blob}`);
      await tui.waitFor('blob.bin：不支持的文件类型');
    });
  });

  describe('while a turn is running', () => {
    it('queues the next message and lists it', async () => {
      tui = await startTuiHarness({ hangingRuns: true });
      await tui.submit('会一直跑的第一条');
      await tui.waitFor('Esc 中断');
      tui.mark();
      await tui.submit('排在后面的一条');
      await tui.waitFor('已排队（第 1 条）');
      await tui.waitFor('排队 1');
      tui.mark();
      await tui.submit('/queue');
      await tui.waitFor('1. 排在后面的一条');
    });

    it('queues a message sent before the running push arrives', async () => {
      tui = await startTuiHarness({ hangingRuns: true });
      await tui.submit('先开个会话');
      await tui.waitFor('Esc 中断');
      await tui.press(KEY.escape);
      await tui.waitForIdle();
      const sessionId = tui.sessionId();
      // The window from the report: the Host already runs a turn, but the
      // running push has not reached this shell, so it still looks idle.
      const release = tui.holdPushes();
      hostData(
        await tui.asOtherShell({
          type: 'session/prompt',
          sessionId,
          input: { text: '另一端先发的一轮' },
          foreground: { kind: 'if-idle' },
        }),
      );
      await waitForForegroundRun(tui, sessionId, (run) => run?.status === 'running');
      expect(tui.isRunning()).toBe(false);
      tui.mark();
      await tui.submit('紧接着的一条');
      await tui.waitFor('已排队（第 1 条）');
      expect(tui.seen()).not.toContain('foreground-run-mismatch');
      const queued = hostData<{ queuedTurns: Array<{ input: { text: string } }> }>(
        await tui.asOtherShell({ type: 'session/queued-turn-list', sessionId }),
      );
      expect(queued.queuedTurns.map((turn) => turn.input.text)).toContain('紧接着的一条');
      release();
      await tui.waitFor('Esc 中断');
      tui.mark();
      await tui.submit('/queue');
      await tui.waitFor('1. 紧接着的一条');
    });

    it('puts a message sent while the first creates the session into that session, after it', async () => {
      tui = await startTuiHarness({ hangingRuns: true });
      const creating = tui.holdRequests('session/create');
      await tui.submit('首条消息');
      await tui.submit('紧跟的消息');
      creating.release();
      await tui.waitFor('已排队（第 1 条）');
      const sessions = await listSessions(tui);
      expect(sessions).toHaveLength(1);
      const sessionId = sessions[0] ?? '';
      await waitForForegroundRun(tui, sessionId, (run) => run?.status === 'running');
      const queued = hostData<{ queuedTurns: Array<{ input: { text: string } }> }>(
        await tui.asOtherShell({ type: 'session/queued-turn-list', sessionId }),
      );
      expect(queued.queuedTurns.map((turn) => turn.input.text)).toEqual(['紧跟的消息']);
    });

    it('returns unsent messages to the composer when creating the session fails', async () => {
      const shell = await startTuiHarness();
      tui = shell;
      const creating = shell.holdRequests('session/create');
      tui.mark();
      await tui.submit('建会话会失败的一条');
      await tui.submit('失败后的下一条');
      await tui.waitFor('待发送 1 条');
      creating.fail('create-failed: injected');
      await tui.waitFor('create-failed: injected');
      // Nothing left for the Host out of context: both are back in the composer.
      expect(await listSessions(shell)).toHaveLength(0);
      expect(tui.seen()).not.toContain('› 建会话会失败的一条');
      tui.mark();
      await tui.press(KEY.enter);
      await tui.waitFor('› 建会话会失败的一条');
      await tui.waitFor('失败后的下一条');
      await tui.waitFor('mock_echo');
      await tui.waitForIdle();
      expect(await listSessions(shell)).toHaveLength(1);
    });

    it('returns a message the Host refuses to queue', async () => {
      tui = await startTuiHarness({ hangingRuns: true });
      await tui.submit('会一直跑');
      await tui.waitFor('Esc 中断');
      const queueing = tui.holdRequests('session/queued-turn-submit');
      tui.mark();
      await tui.submit('排不进去的一条');
      queueing.fail('queue-refused: injected');
      await tui.waitFor('queue-refused: injected');
      expect(tui.seen()).not.toContain('已排队');
      tui.mark();
      await tui.press(KEY.enter);
      await tui.waitFor('已排队（第 1 条）');
      const queued = hostData<{ queuedTurns: Array<{ input: { text: string } }> }>(
        await tui.asOtherShell({ type: 'session/queued-turn-list', sessionId: tui.sessionId() }),
      );
      expect(queued.queuedTurns.map((turn) => turn.input.text)).toEqual(['排不进去的一条']);
    });

    it('takes back messages that have not left yet with Ctrl+C', async () => {
      const shell = await startTuiHarness({ hangingRuns: true });
      tui = shell;
      const creating = shell.holdRequests('session/create');
      await tui.submit('已经在路上的一条');
      await tui.submit('还没发出的一条');
      await tui.waitFor('待发送 1 条');
      tui.mark();
      await tui.press(KEY.ctrlC);
      await tui.waitFor('已取回 1 条未发出的消息');
      creating.release();
      await tui.waitFor('Esc 中断');
      const sessionId = tui.sessionId();
      await waitForForegroundRun(tui, sessionId, (run) => run?.status === 'running');
      const queuedTurns = async (): Promise<string[]> =>
        hostData<{ queuedTurns: Array<{ input: { text: string } }> }>(
          await shell.asOtherShell({ type: 'session/queued-turn-list', sessionId }),
        ).queuedTurns.map((turn) => turn.input.text);
      expect(await queuedTurns()).toEqual([]);
      tui.mark();
      await tui.press(KEY.enter);
      await tui.waitFor('已排队（第 1 条）');
      expect(await queuedTurns()).toEqual(['还没发出的一条']);
    });

    it('does not send a waiting message into a conversation the user switched to', async () => {
      const shell = await startTuiHarness();
      tui = shell;
      const creating = shell.holdRequests('session/create');
      await tui.submit('切走之前发的一条');
      tui.mark();
      await tui.submit('/new');
      creating.release();
      await tui.waitFor('会话已切换');
      // The session made for the abandoned draft is not the one on screen.
      expect(() => shell.sessionId()).toThrow();
      expect(tui.seen()).not.toContain('you said');
      tui.mark();
      await tui.press(KEY.enter);
      await tui.waitFor('you said: 切走之前发的一条');
      await tui.waitForIdle();
    });

    it('interrupts the running turn with Escape', async () => {
      tui = await startTuiHarness({ hangingRuns: true });
      await tui.submit('会一直跑');
      await tui.waitFor('Esc 中断');
      tui.mark();
      await tui.press(KEY.escape);
      await tui.waitFor('已中断');
    });

    it('steers a sentence into the running turn', async () => {
      tui = await startTuiHarness({ hangingRuns: true });
      await tui.submit('会一直跑');
      await tui.waitFor('Esc 中断');
      tui.mark();
      await tui.submit('/steer 顺便说一句');
      await tui.waitFor('› 顺便说一句');
      await tui.waitFor('⎿ 插入当前回合');
    });

    it('replaces the running turn with new text', async () => {
      tui = await startTuiHarness({ hangingRuns: true });
      await tui.submit('会被换掉的一轮');
      await tui.waitFor('Esc 中断');
      tui.mark();
      await tui.submit('/replace 改做这个');
      await tui.waitFor('› 改做这个');
      expect(tui.seen()).not.toContain('已排队');
    });
  });

  describe('conversation tree', () => {
    it('rewrites the last prompt as a branch and switches back to the original', async () => {
      tui = await startTuiHarness();
      await converse(tui, '用 Redis 做');
      tui.mark();
      await tui.submit('/edit');
      await tui.waitFor('改写上一条提问');
      // Replace the loaded prompt: Ctrl+U clears the line.
      await tui.press('\x15');
      tui.mark();
      await tui.submit('用 SQLite 做');
      await tui.waitFor('you said: 用 SQLite 做');
      await tui.waitFor('分支 1');
      tui.mark();
      await tui.submit('/branches');
      await tui.waitFor('切换到哪个分支');
      await tui.waitFor('1. 用 Redis 做');
      tui.mark();
      await tui.press(KEY.up, KEY.enter);
      await tui.waitFor('you said: 用 Redis 做');
    });

    it('keeps the old answer as a branch on retry keep', async () => {
      tui = await startTuiHarness();
      await converse(tui, '解释一下');
      tui.mark();
      await tui.submit('/retry keep');
      await tui.waitFor('分支 1');
    });

    it('keeps the branch count when a reload cannot read the branches', async () => {
      tui = await startTuiHarness();
      await converse(tui, '解释一下');
      tui.mark();
      await tui.submit('/retry keep');
      await tui.waitFor('分支 1');
      await tui.waitForIdle();
      // The reloads that follow the next fork's pushes ask for the branches; that read fails.
      const listing = tui.holdRequests('session/branch-list');
      tui.mark();
      await tui.submit('/retry keep');
      await tui.waitFor('you said: 解释一下');
      await tui.waitForIdle();
      listing.fail('branch-list-failed: injected');
      tui.mark();
      await tui.press(KEY.shiftTab);
      await tui.waitFor('权限 ');
      expect(tui.seen()).toContain('分支 1');
    });

    it('forks the conversation into a new session and opens it', async () => {
      tui = await startTuiHarness();
      await converse(tui, '主线对话');
      tui.mark();
      await tui.submit('/fork 试验分叉');
      await tui.waitFor('这是分叉出的会话「试验分叉」');
      await tui.waitFor('试验分叉 ·');
    });
  });

  describe('state other shells change', () => {
    it('announces a plan written from another shell and opens it', async () => {
      tui = await startTuiHarness({ project: true });
      await converse(tui, '先聊一句');
      const sessionId = tui.sessionId();
      tui.mark();
      const written = await tui.asOtherShell({
        type: 'plan/set',
        sessionId,
        expected: null,
        plan: {
          id: 'plan-1',
          sessionId,
          projectPath: tui.projectPath ?? '',
          status: 'draft',
          title: '重构登录',
          goal: '拆掉旧存储',
          steps: [
            { id: 'a', title: '梳理调用点', status: 'pending' },
            { id: 'b', title: '替换存储', status: 'pending' },
          ],
          revision: 0,
          createdAt: '2026-10-08T00:00:00Z',
          updatedAt: '2026-10-08T00:00:00Z',
          source: 'assistant',
        },
      });
      expect(written.success).toBe(true);
      await tui.waitFor('计划已生成：重构登录（2 步）');
      await tui.waitFor('计划 0/2 · 草稿');
      tui.mark();
      await tui.submit('/plan');
      await tui.waitFor('○ 1. 梳理调用点');
      await tui.waitFor('批准并执行（当前会话）');
    });

    it('follows a rename made from another shell', async () => {
      tui = await startTuiHarness();
      await converse(tui, '会被别处改名');
      const sessionId = tui.sessionId();
      tui.mark();
      await tui.asOtherShell({ type: 'session/rename', sessionId, name: '桌面端改的名字' });
      await tui.waitFor('桌面端改的名字 ·');
    });
  });

  describe('side chat', () => {
    it('steps into a side chat, carries its answer back, and sends it with the next prompt', async () => {
      tui = await startTuiHarness();
      await converse(tui, '主会话的问题');
      tui.mark();
      await tui.submit('/side 调研');
      await tui.waitFor('这是侧聊');
      await tui.waitFor('侧聊 · /back 返回');
      tui.mark();
      await tui.submit('侧聊里的问题');
      // A side chat's prompt is wrapped with the inherited conversation.
      await tui.waitFor('Current side chat question:');
      await tui.waitFor('mock_echo');
      await tui.waitForIdle();
      tui.mark();
      await tui.submit('/handoff');
      await tui.waitFor('侧聊的回答会随下一条消息带给主会话');
      await tui.waitFor('带回侧聊回答 1');
      tui.mark();
      await tui.submit('结合侧聊继续');
      await tui.waitFor('⎿ 侧聊回答：');
      await tui.waitFor('mock_echo');
    });
  });

  describe('status bar', () => {
    /** Redraw the status bar and return what it shows now. */
    async function redrawnStatus(harness: TuiHarness): Promise<string> {
      harness.mark();
      await harness.press(KEY.shiftTab);
      await harness.waitFor('权限 ');
      return harness.seen();
    }

    it('keeps the project and the context usage across a side chat and back', async () => {
      tui = await startTuiHarness({ project: true });
      await converse(tui, '主会话的问题');
      await tui.waitFor('上下文 0%');
      tui.mark();
      await tui.submit('/side 调研');
      await tui.waitFor('这是侧聊');
      const inSideChat = await redrawnStatus(tui);
      expect(inSideChat).toContain(' · fixture · ');
      expect(inSideChat).not.toContain(' · 对话 · ');
      tui.mark();
      await tui.submit('/back');
      await tui.waitFor('主会话的问题 · fixture');
      // No turn ran since reopening: the usage comes from the reopened session itself.
      expect(await redrawnStatus(tui)).toContain('上下文 0%');
    });

    it('shows what the launch had to say', async () => {
      tui = await startTuiHarness({ startNotice: '「/tmp/elsewhere」还不是已信任的项目' });
      await tui.waitFor('「/tmp/elsewhere」还不是已信任的项目');
      await converse(tui, '照常对话');
    });
  });

  describe('artifacts', () => {
    it('lists an artifact from the conversation and shows its source', async () => {
      tui = await startTuiHarness();
      const fence = '```';
      await tui.paste(
        `原样返回：\n${fence}artifact-html title="演示页"\n<h1>你好</h1>\n${fence}\n完`,
      );
      tui.mark();
      await tui.press(KEY.enter);
      await tui.waitFor('mock_echo');
      await tui.waitForIdle();
      tui.mark();
      await tui.submit('/artifacts');
      await tui.waitFor('从新到旧');
      tui.mark();
      await tui.press(KEY.enter);
      await tui.waitFor('导出为带沙箱的本地页面');
      tui.mark();
      await tui.press(KEY.down, KEY.enter);
      await tui.waitFor('演示页（源码）');
      await tui.waitFor('<h1>你好</h1>');
      expect(tui.openedFiles()).toEqual([]);
    });

    it('exports an artifact as a sandboxed page for the browser', async () => {
      tui = await startTuiHarness();
      const fence = '```';
      await tui.paste(
        `原样返回：\n${fence}artifact-html title="演示页"\n<h1>你好</h1>\n${fence}\n完`,
      );
      tui.mark();
      await tui.press(KEY.enter);
      await tui.waitFor('mock_echo');
      await tui.waitForIdle();
      tui.mark();
      await tui.submit('/artifacts');
      await tui.waitFor('从新到旧');
      tui.mark();
      await tui.press(KEY.enter);
      await tui.waitFor('导出为带沙箱的本地页面');
      tui.mark();
      await tui.press(KEY.enter);
      await tui.waitFor('已在浏览器打开「演示页」');
      const [exported] = tui.openedFiles();
      expect(path.basename(exported ?? '')).toBe('演示页.html');
      expect(readFileSync(exported ?? '', 'utf8')).toContain('<iframe sandbox="allow-scripts"');
    });
  });

  describe('mock Host subagents and file changes', () => {
    it('starts a subagent, shows its result and accepts a follow-up', async () => {
      const shell = await startTuiHarness({ project: true });
      tui = shell;
      await tui.submit('你好');
      await tui.waitFor('you said: 你好');
      await tui.waitForIdle();
      const parentSessionId = tui.sessionId();
      tui.mark();
      const started = await tui.asOtherShell({
        type: 'subagent/batch-start',
        request: {
          parentSessionId,
          tasks: [
            {
              id: 'task-1',
              parentSessionId,
              task: '整理 README 的结构',
              sessionName: '整理文档',
            },
          ],
        },
      });
      expect(started.success, JSON.stringify(started).slice(0, 300)).toBe(true);
      await tui.waitFor('子代理「整理文档」已完成');
      const batchOf = async (): Promise<string | undefined> =>
        hostData<{ sessions: Array<{ subagentBatchRunId?: string }> }>(
          await shell.asOtherShell({ type: 'session/list-children', parentSessionId }),
        ).sessions[0]?.subagentBatchRunId;
      const firstBatch = await batchOf();
      expect(firstBatch).toBeDefined();
      tui.mark();
      await tui.submit('/subagents');
      await tui.waitFor('整理文档');
      tui.mark();
      await tui.press(KEY.enter);
      await tui.waitFor('给它追加指令');
      tui.mark();
      await tui.press(KEY.enter);
      await tui.waitFor('给子代理追加指令');
      await tui.submit('再补一节安装说明');
      await tui.waitFor('子代理「整理文档」已完成');
      const followedUp = await tui.asOtherShell({ type: 'session/list-children', parentSessionId });
      expect(JSON.stringify(followedUp)).toContain('再补一节安装说明');
      // The follow-up is its own batch; that id is what the announcement was matched on.
      expect(await batchOf()).not.toBe(firstBatch);
      expect(tui.seen().split('子代理「整理文档」已完成')).toHaveLength(2);
    });

    it('records a file edit, shows the diff and undoes it', async () => {
      tui = await startTuiHarness({ project: true });
      const file = path.join(tui.projectPath ?? '', 'mock-edit.txt');
      await tui.submit('改文件：把说明换成新版');
      await tui.waitFor('you said: 改文件：把说明换成新版');
      await tui.waitForIdle();
      expect(readFileSync(file, 'utf8')).toContain('改文件：把说明换成新版');
      tui.mark();
      await tui.submit('/changes');
      await tui.waitFor('各轮的文件改动');
      tui.mark();
      await tui.press(KEY.enter);
      await tui.waitFor('查看改动的文件');
      tui.mark();
      await tui.press(KEY.enter);
      await tui.waitFor('mock-edit.txt');
      tui.mark();
      await tui.press(KEY.enter);
      await tui.waitFor('改文件：把说明换成新版');
      tui.mark();
      await tui.press(KEY.escape);
      await tui.waitFor('改动的文件');
      await tui.press(KEY.escape);
      await tui.submit('/undo');
      await tui.waitFor('撤销这一轮的改动');
      await tui.waitFor('会把 1 个文件改回这一轮开始前的样子');
      tui.mark();
      await tui.press(KEY.down, KEY.enter);
      await tui.waitFor('已撤销');
      expect(existsSync(file)).toBe(false);
    });
  });
});

async function listSessions(harness: TuiHarness): Promise<string[]> {
  const listed = hostData<{ sessions: Array<{ sessionId: string }> }>(
    await harness.asOtherShell({
      type: 'session/list',
      scopeRef: { kind: 'all-authorized' },
      order: 'updated',
      maxItems: 10,
    }),
  );
  return listed.sessions.map((session) => session.sessionId);
}

type ForegroundRun = { runId: string; status: string } | null;

/** Wait for the Host's own record of the session's turn, as another shell sees it. */
async function waitForForegroundRun(
  harness: TuiHarness,
  sessionId: string,
  matches: (run: ForegroundRun) => boolean,
): Promise<void> {
  await vi.waitFor(
    async () => {
      const { run } = hostData<{ run: ForegroundRun }>(
        await harness.asOtherShell({ type: 'session/foreground-run', sessionId }),
      );
      expect(matches(run)).toBe(true);
    },
    { timeout: 4_000, interval: 15 },
  );
}
