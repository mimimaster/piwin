# Pi 扩展开发与 piwin 适配指南

> **写给扩展作者**：怎么写一个在 piwin 里好用的 Pi 扩展，怎么把强依赖 Pi 终端界面（TUI）的扩展改造过来，怎么本地调试，怎么发布到扩展仓库。

piwin 运行的就是标准的 Pi 扩展，没有另一套 API。区别只有一个：**piwin 里没有终端**。你的扩展跑在 Host 上，界面由桌面端、命令行或手机来画，它们只接收"数据"，不接收终端组件。所以改造的核心就是：**把"画终端界面"换成"交给 piwin 画的数据"**。

---

## 1. piwin 怎么运行你的扩展

```
你的扩展（index.ts）
   │  运行在 Host：本机 sidecar，或远程机器上的独立 worker 进程
   │  没有 TTY、没有键盘事件、没有 TUI 组件树
   ▼
piwin Host ──数据──▶ 桌面端 / 命令行 / 手机
   对话框请求、状态标签、文本面板、通知
```

- **加载前先静态扫描**：piwin 只读源码文本、不执行，给扩展定一个兼容等级（见第 3 节）。
- **用户启用后才执行**：扩展以 Host 用户的系统权限运行。
- **在一轮对话结束时生效**：启用、停用、更新都在当前 Run 结束后替换运行时，会话历史保留。piwin 不支持扩展自己调用 `ctx.reload()`。
- **可以直接 import 的包**（由宿主提供，不算依赖）：
  `@earendil-works/pi-coding-agent`、`@earendil-works/pi-ai`、`@earendil-works/pi-agent-core`、`@earendil-works/pi-tui`、`typebox`（及旧名 `@sinclair/typebox`、`@mariozechner/pi-*`）。

---

## 2. 能力对照表

| Pi API | piwin 里的表现 |
| :--- | :--- |
| `pi.registerTool` | ✅ 完全支持，模型可调用。结果按文本 / Markdown 显示 |
| `pi.on(...)` 生命周期与工具 hook | ✅ 完全支持 |
| `pi.registerProvider` | ✅ 完全支持 |
| `pi.registerCommand(name, …)` | ✅ 出现在输入框 `/` 菜单的「扩展」分组；用户发送 `/name 参数` 时由 Pi 执行 |
| `ctx.ui.confirm / select / input` | ✅ 桌面端弹窗，命令行 TTY 问答 |
| `ctx.ui.notify(msg, level)` | ✅ 桌面端 toast，命令行打印一行 |
| `ctx.ui.setStatus(key, text)` | ✅ 输入框下方的状态标签 |
| `ctx.ui.setWidget(key, string[], { placement })` | ✅ 输入框上方 / 下方的文本块 |
| `ctx.ui.setWorkingMessage(msg)` | ✅ 状态行里的一个标签 |
| `ctx.ui.theme.fg / bg / bold / …` | ✅ 可以调用，返回原文本；ANSI 颜色会被去掉 |
| `ctx.ui.setWidget(key, 组件工厂)` | ⚪ 被忽略 |
| `ctx.ui.setHeader / setFooter / setTitle` | ⚪ 被忽略 |
| `ctx.ui.setWorkingIndicator / setWorkingVisible / setHiddenThinkingLabel` | ⚪ 被忽略 |
| `renderCall / renderResult / registerMessageRenderer` | ⚪ 被忽略，按文本显示 |
| `pi.registerShortcut`、`registerFlag` | ⚪ 没有键盘和命令行参数，不会触发 |
| 编辑器相关：`setEditorText / pasteToEditor / getEditorText / setEditorComponent / addAutocompleteProvider / onTerminalInput` | ⚪ 无操作（`getEditorText` 返回空字符串） |
| `ctx.ui.setTheme / getAllThemes` | ⚪ 主题切换失败，列表为空 |
| `ctx.ui.custom(...)` | ❌ **会抛错**：`extension custom UI is not supported in piwin desktop host` |
| `ctx.reload()` | ❌ 不支持；让用户在扩展设置里点「应用到当前 Agent」 |
| `process.stdin.setRawMode`、blessed 等终端库 | ❌ 没有终端，这类扩展会被判为不可用 |

**数量限制**（超出部分会被截断，避免刷屏）：每个会话最多 16 个状态标签、8 个文本面板；状态文字 ≤ 240 字；面板 ≤ 24 行，每行 ≤ 400 字；通知 ≤ 1000 字。状态和面板的更新会合并，大约 50 ms 推送一次，所以高频调用 `setStatus` 也没关系。

---

## 3. 兼容等级：piwin 怎么看你的扩展

| 等级 | 条件 | 含义 |
| :--- | :--- | :--- |
| **可用** `compatible` | 有工具 / hook / 命令 / 对话框，没有 TUI 调用 | 一切正常 |
| **部分可用** `degraded` | 有 Agent 能力，同时出现了 TUI 调用 | 能正常启用运行，TUI 部分按上表被忽略 |
| **不可用** `incompatible` | 只有 TUI 调用；或需要原始终端（`setRawMode`、blessed） | 列出但不加载 |
| **未验证** `unverified` | 读不到入口源码 | 需要检查 |

扫描是按源码文本匹配的：只要出现 `ctx.ui.custom(`、组件形式的 `setWidget(key, (tui, theme) => …)`、`setHeader`、`setFooter`、`renderCall`、`renderResult`、`registerShortcut`、`setTheme`、`onTerminalInput` 等字样，就会标成"部分可用"（文本形式的 `setWidget(key, [...])` 和 `setStatus` 不算）。这**不影响运行**。想拿到"可用"，就把 TUI 代码移除，或者单独放到只给 Pi 终端用的版本里。

查看方式：

```bash
piwin extension list        # 每行：启用状态、id、来源、名称、路径
```

桌面端：**设置 → 扩展**，会显示每个扩展的等级和被忽略的能力。

---

## 4. 改造强依赖 TUI 的扩展：逐项替换

| 原来在 Pi 终端里的写法 | 在 piwin 里改成 |
| :--- | :--- |
| `ctx.ui.custom(...)` 做的选择器、表单、确认框 | `ctx.ui.select` / `input` / `confirm` |
| 组件形式的 `setWidget` 面板 | `setWidget(key, string[])` 文本行 |
| `setFooter` / `setHeader` 显示的状态 | `setStatus(key, text)` |
| `registerShortcut` 快捷键 | `registerCommand` 斜杠命令 |
| `renderCall` / `renderResult` 自定义渲染 | 工具结果本身写成好读的文本或 Markdown |
| 编辑器钩子、自动补全 | 命令参数 + `input` 对话框 |
| `ctx.reload()` | 删掉；告诉用户去设置里「应用到当前 Agent」 |
| 原始键盘输入、blessed 布局 | 重写成"工具 + 对话框 + 状态" |

### 4.1 交互式组件 → 对话框

```ts
// 之前：一个带键盘导航的 TUI 选择器
const picked = await ctx.ui.custom((tui, theme, keybindings, done) => new BranchPicker(branches, theme, done));

// 之后：piwin 桌面端弹出选择框，命令行变成编号选择
const picked = await ctx.ui.select('切换到哪个分支？', branches);
if (picked === undefined) return; // 用户取消
```

需要多步输入时，就连着调用几次：`input` 取文本，`select` 选项，`confirm` 做最后确认。

### 4.2 组件面板 → 文本面板

```ts
// 之前
ctx.ui.setWidget('build', (tui, theme) => new BuildPanel(state, theme));

// 之后：一行一个字符串；placement 决定显示在输入框上方还是下方
ctx.ui.setWidget('build', [
  `构建：${state.status}`,
  ...state.failures.slice(0, 5).map((failure) => `✗ ${failure}`),
], { placement: 'belowEditor' });

ctx.ui.setWidget('build', undefined); // 清除
```

### 4.3 页脚 / 页眉 → 状态标签

```ts
ctx.ui.setStatus('git', `${branch} · ${dirty} 个改动`);
ctx.ui.setStatus('git', undefined); // 清除
```

同一个 key 重复设置会覆盖。所以状态可以放心地在 `turn_end`、`tool_result` 这类 hook 里频繁更新。

### 4.4 快捷键 → 斜杠命令

```ts
pi.registerCommand('deploy', {
  description: '部署当前分支',
  handler: async (args, ctx) => {
    const target = args.trim() || (await ctx.ui.select('部署到哪里？', ['staging', 'production']));
    if (!target) return;
    if (!(await ctx.ui.confirm('确认部署', `部署到 ${target}？`))) return;
    // ...
    ctx.ui.notify(`已部署到 ${target}`, 'info');
  },
});
```

- **命令名请写成字符串字面量**：`/` 菜单里的命令列表来自静态扫描，`registerCommand(someVariable, …)` 这种写法扫不到，命令仍然可用，但不会出现在菜单里。
- 用户只有在**整条消息就是命令**时（`/deploy staging`，不带附件）才会触发。
- 和 piwin 内置命令（`/compact`、`/goal`、`/plan` 等）或已安装技能同名时，菜单里不会显示，建议换个名字。

### 4.5 自定义渲染 → 好读的工具结果

piwin 不执行 `renderCall` / `renderResult`，工具结果按内容显示。所以要把给人看的信息放进 `content`，把结构化数据放进 `details`：

```ts
return {
  content: [{ type: 'text', text: `找到 ${hits.length} 处引用：\n${hits.map((hit) => `- ${hit.file}:${hit.line}`).join('\n')}` }],
  details: { hits },
};
```

---

## 5. 一份代码同时兼容 Pi 终端和 piwin

不用维护两个版本。`ctx.ui.custom` 在 piwin 里会抛错，而组件面板会被静默忽略，所以"先试 TUI、失败就降级"就能两边都顺：

```ts
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';

/** Pi 终端里用漂亮的 TUI 选择器；piwin（或任何不支持的宿主）里退回普通选择框。 */
async function pickOne(ctx: ExtensionContext, title: string, options: string[]): Promise<string | undefined> {
  try {
    return await ctx.ui.custom<string | undefined>((tui, theme, keybindings, done) =>
      new FancyPicker(title, options, theme, done),
    );
  } catch {
    return ctx.ui.select(title, options);
  }
}

/** 面板：先给 piwin 能显示的文本行，终端里再用组件覆盖。 */
function showPanel(ctx: ExtensionContext, lines: string[]) {
  ctx.ui.setWidget('panel', lines);
}
```

如果确实需要判断当前是不是 piwin：piwin 提供的主题对象名字是 `piwin-host`（`ctx.ui.theme.name === 'piwin-host'`）。不过这只是当前的实现细节，**优先用上面的 try/catch**。

---

## 6. 完整示例：把一个 TODO 看板改造过来

**改造前**（只能在 Pi 终端用）：快捷键打开全屏看板，在组件面板里画列表，页脚显示计数。

```ts
pi.registerShortcut('ctrl+t', {
  handler: async (ctx) => {
    await ctx.ui.custom((tui, theme, keybindings, done) => new TodoBoard(todos, theme, done));
  },
});
pi.on('turn_end', (_event, ctx) => {
  ctx.ui.setWidget('todos', (tui, theme) => new TodoPanel(todos, theme));
  ctx.ui.setFooter((tui, theme, footer) => new TodoFooter(todos, theme, footer));
});
```

**改造后**（piwin 桌面端、命令行、手机都能用，Pi 终端里也照样工作）：

```ts
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

type Todo = { id: number; text: string; done: boolean };

export default function todoBoard(pi: ExtensionAPI) {
  const todos: Todo[] = [];
  let nextId = 1;

  // 状态标签 + 文本面板，替代原来的页脚和组件面板。
  const render = (ctx: ExtensionContext) => {
    const open = todos.filter((todo) => !todo.done).length;
    ctx.ui.setStatus('todos', open > 0 ? `待办 ${open}` : undefined);
    ctx.ui.setWidget(
      'todos',
      todos.length > 0 ? todos.map((todo) => `${todo.done ? '✓' : '○'} #${todo.id} ${todo.text}`) : undefined,
      { placement: 'belowEditor' },
    );
  };

  // 模型可以调用的工具：结果直接写成好读的文本。
  pi.registerTool({
    name: 'todo_add',
    label: 'Add todo',
    description: 'Add an item to the todo board',
    parameters: Type.Object({ text: Type.String({ description: 'What needs doing' }) }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const todo: Todo = { id: nextId++, text: params.text, done: false };
      todos.push(todo);
      render(ctx);
      return { content: [{ type: 'text', text: `已添加 #${todo.id}：${todo.text}` }], details: todo };
    },
  });

  // 快捷键 → 斜杠命令 + 选择框。
  pi.registerCommand('todo-done', {
    description: '把一项待办标记为完成',
    handler: async (_args, ctx) => {
      const open = todos.filter((todo) => !todo.done);
      if (open.length === 0) {
        ctx.ui.notify('没有待办', 'info');
        return;
      }
      const labels = open.map((todo) => `#${todo.id} ${todo.text}`);
      const picked = await ctx.ui.select('完成哪一项？', labels);
      if (picked === undefined) return;
      const todo = open[labels.indexOf(picked)];
      if (todo) todo.done = true;
      render(ctx);
      ctx.ui.notify(`已完成 #${todo?.id}`, 'info');
    },
  });
}
```

改完之后没有任何 TUI 调用，扫描结果是"可用"。

---

## 7. 打包规则

piwin（以及扩展仓库）安装扩展时，只拉取固定 commit 的源码原样放进不可变目录，**不运行 npm、不运行任何脚本**：

- 入口是扩展目录里的 `index.ts`；单文件扩展也可以直接是一个 `.ts` 文件。
- `package.json` **不能有 `dependencies`**。第 1 节列出的宿主包放进 `peerDependencies` 或 `devDependencies` 即可。
- 其他第三方库**打包进源码**。例如用 esbuild 打成单个文件，宿主包标成外部依赖：

  ```bash
  npx esbuild src/index.ts --bundle --format=esm --platform=node \
    --external:@earendil-works/* --external:typebox \
    --outfile=dist/index.ts
  ```

  打出来的是纯 JavaScript，它同样是合法的 TypeScript，所以文件名可以用 `index.ts`。发布前请先在本地装一次试试（第 8 节）。
- 不能有 `preinstall` / `install` / `postinstall` / `prepare` 脚本，不能有符号链接和 `node_modules`，总大小 ≤ 5 MB，文件数 ≤ 2000。

---

## 8. 本地调试

```bash
piwin extension install --local ./my-extension   # 暂存为不可变版本，默认不启用
piwin extension list                             # 找到它的 id，看兼容等级
piwin extension enable <id>                      # 启用
```

- **桌面端**：设置 → 扩展，可以启用或停用，并点「应用到当前 Agent」。改动会在当前一轮结束后生效。
- **修改代码后**：再执行一次 `install --local`，piwin 按内容生成新版本，然后在设置里点「应用到当前 Agent」。
- **在命令行里调试**：`notify` 和状态变化都会打印成日志行，最适合观察扩展往外发了什么。
- 桌面端输入 `/` 可以看你的命令是否出现在「扩展」分组里。

---

## 9. 发布

打开 [piwin 扩展仓库](https://mimimaster.github.io/piwin-extensions/#/submit)，用 GitHub 登录，把扩展文件夹拖进去，点「一键发布」。页面会在你的账号下建仓库放源码，并替你向扩展仓库开 PR。发布前，页面会用和仓库 CI 相同的规则先检查一遍第 7 节的打包规则。完整说明见扩展仓库的 [CONTRIBUTING](https://github.com/mimimaster/piwin-extensions/blob/main/CONTRIBUTING.md)。

合并后几分钟，所有 piwin 用户都能在桌面端扩展市场里搜到它，或者这样安装：

```bash
piwin extension install --registry <你的用户名>/<扩展名>
```
