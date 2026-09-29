# Pi 扩展开发与 piwin 适配指南

> 本指南面向扩展开发者，涵盖以下内容：如何开发兼容 piwin 的 Pi 扩展、如何将依赖 Pi TUI 的扩展迁移至 piwin、本地调试流程，以及扩展发布方式。

piwin 运行的是标准 Pi 扩展，不引入额外 API。与 Pi 终端的核心区别在于：**piwin 不提供终端环境**。扩展在 Host 进程中执行，UI 由桌面客户端、CLI 或移动端负责渲染——它们接收的是结构化数据，而非终端组件。因此，适配的核心思路是：**将终端 UI 渲染替换为向 piwin 提交可渲染的数据**。

---

## 1. 扩展运行模型

```
扩展入口（index.ts）
   │  运行环境：Host 进程（本机 sidecar 或远程机器上的独立 worker）
   │  无 TTY、无键盘事件、无 TUI 组件树
   ▼
piwin Host ──结构化数据──▶ 桌面客户端 / CLI / 移动端
   对话框请求、状态标签、文本面板、通知
```

**运行机制：**

- **静态扫描**：加载前，piwin 对扩展源码进行文本级静态分析（不执行代码），确定兼容等级（详见第 3 节）。
- **按需执行**：扩展仅在用户显式启用后加载，以 Host 用户的系统权限运行。
- **生效时机**：启用、停用、更新操作均在当前 Run 结束后生效，会话历史保留。piwin 不支持扩展调用 `ctx.reload()`。
- **宿主提供的包**（无需声明为依赖）：
  `@earendil-works/pi-coding-agent`、`@earendil-works/pi-ai`、`@earendil-works/pi-agent-core`、`@earendil-works/pi-tui`、`typebox`（及旧名 `@sinclair/typebox`、`@mariozechner/pi-*`）。

---

## 2. API 兼容性对照表

| Pi API | piwin 中的行为 |
| :--- | :--- |
| `pi.registerTool` | ✅ 完全支持，模型可调用。结果按文本 / Markdown 渲染 |
| `pi.on(...)` 生命周期与工具 hook | ✅ 完全支持 |
| `pi.registerProvider` | ✅ 完全支持 |
| `pi.registerCommand(name, …)` | ✅ 出现在输入框 `/` 菜单的「扩展」分组；用户发送 `/name 参数` 时由 Pi 执行 |
| `ctx.ui.confirm / select / input` | ✅ 桌面端弹窗，CLI 通过 TTY 交互 |
| `ctx.ui.notify(msg, level)` | ✅ 桌面端 toast 通知，CLI 输出日志行 |
| `ctx.ui.setStatus(key, text)` | ✅ 显示为输入框下方的状态标签 |
| `ctx.ui.setWidget(key, string[], { placement })` | ✅ 输入框上方或下方的文本面板 |
| `ctx.ui.setWorkingMessage(msg)` | ✅ 显示为状态栏中的标签 |
| `ctx.ui.theme.fg / bg / bold / …` | ✅ 可调用，返回原始文本；ANSI 转义序列会被移除 |
| `ctx.ui.setWidget(key, 组件工厂)` | ⚪ 静默忽略 |
| `ctx.ui.setHeader / setFooter / setTitle` | ⚪ 静默忽略 |
| `ctx.ui.setWorkingIndicator / setWorkingVisible / setHiddenThinkingLabel` | ⚪ 静默忽略 |
| `renderCall / renderResult / registerMessageRenderer` | ⚪ 静默忽略，内容按纯文本渲染 |
| `pi.registerShortcut`、`registerFlag` | ⚪ 无键盘和命令行参数上下文，不会触发 |
| 编辑器相关：`setEditorText / pasteToEditor / getEditorText / setEditorComponent / addAutocompleteProvider / onTerminalInput` | ⚪ 无操作（`getEditorText` 返回空字符串） |
| `ctx.ui.setTheme / getAllThemes` | ⚪ 主题切换无效，主题列表为空 |
| `ctx.ui.custom(...)` | ❌ **抛出异常**：`extension custom UI is not supported in piwin desktop host` |
| `ctx.reload()` | ❌ 不支持；需由用户在扩展设置中手动点击「应用到当前 Agent」 |
| `process.stdin.setRawMode`、blessed 等终端库 | ❌ 无终端环境，此类扩展将被标记为不可用 |

**数量限制**（超出部分自动截断）：每个会话最多 16 个状态标签、8 个文本面板；状态文本上限 240 字符；面板上限 24 行，每行上限 400 字符；通知上限 1000 字符。状态与面板的更新按约 50 ms 间隔合并推送，因此高频调用 `setStatus` 不会造成性能问题。

---

## 3. 兼容等级

piwin 在加载前对扩展源码进行静态扫描，根据分析结果分配以下等级：

| 等级 | 判定条件 | 说明 |
| :--- | :--- | :--- |
| **可用** `compatible` | 包含工具 / hook / 命令 / 对话框，不包含 TUI 调用 | 功能完全兼容 |
| **部分可用** `degraded` | 包含 Agent 能力，同时包含 TUI 调用 | 正常加载运行，TUI 部分按上表规则处理 |
| **不可用** `incompatible` | 仅包含 TUI 调用；或依赖原始终端（`setRawMode`、blessed） | 在列表中显示但不加载 |
| **未验证** `unverified` | 无法读取入口文件源码 | 需人工检查 |

**扫描规则**：基于源码文本匹配。出现以下调用会被标记为「部分可用」：`ctx.ui.custom(`、组件工厂形式的 `setWidget(key, (tui, theme) => …)`、`setHeader`、`setFooter`、`renderCall`、`renderResult`、`registerShortcut`、`setTheme`、`onTerminalInput`。文本数组形式的 `setWidget(key, [...])` 和 `setStatus` 不计入。此标记**不影响运行**。若需获得「可用」等级，需移除 TUI 代码或将其拆分为 Pi 终端专用版本。

**查看方式：**

```bash
piwin extension list        # 输出：启用状态、id、来源、名称、路径
```

桌面客户端：**设置 → 扩展**，显示每个扩展的兼容等级及被忽略的能力项。

---

## 4. TUI 依赖迁移指南

以下是各类 TUI 调用的对应替代方案：

| 原 Pi 终端写法 | piwin 替代方案 |
| :--- | :--- |
| `ctx.ui.custom(...)` 实现的选择器、表单、确认框 | `ctx.ui.select` / `input` / `confirm` |
| 组件工厂形式的 `setWidget` 面板 | `setWidget(key, string[])` 文本数组 |
| `setFooter` / `setHeader` 状态显示 | `setStatus(key, text)` |
| `registerShortcut` 快捷键绑定 | `registerCommand` 斜杠命令 |
| `renderCall` / `renderResult` 自定义渲染 | 在工具返回值中提供可读的文本或 Markdown |
| 编辑器钩子、自动补全 | 命令参数 + `input` 对话框 |
| `ctx.reload()` | 移除；引导用户在设置中点击「应用到当前 Agent」 |
| 原始键盘输入、blessed 布局 | 重构为「工具 + 对话框 + 状态」模式 |

### 4.1 交互式组件 → 对话框

```ts
// 迁移前：基于键盘导航的 TUI 选择器
const picked = await ctx.ui.custom((tui, theme, keybindings, done) => new BranchPicker(branches, theme, done));

// 迁移后：桌面端弹出选择框，CLI 回退为编号选择
const picked = await ctx.ui.select('切换到哪个分支？', branches);
if (picked === undefined) return; // 用户取消
```

多步输入场景可依次调用：`input` 获取文本输入，`select` 提供选项，`confirm` 做最终确认。

### 4.2 组件面板 → 文本面板

```ts
// 迁移前
ctx.ui.setWidget('build', (tui, theme) => new BuildPanel(state, theme));

// 迁移后：每行一个字符串；placement 控制面板相对于输入框的位置
ctx.ui.setWidget('build', [
  `构建：${state.status}`,
  ...state.failures.slice(0, 5).map((failure) => `✗ ${failure}`),
], { placement: 'belowEditor' });

ctx.ui.setWidget('build', undefined); // 清除面板
```

### 4.3 页脚 / 页眉 → 状态标签

```ts
ctx.ui.setStatus('git', `${branch} · ${dirty} 个改动`);
ctx.ui.setStatus('git', undefined); // 清除
```

相同 key 的重复调用会覆盖前值，因此可在 `turn_end`、`tool_result` 等高频 hook 中放心更新。

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

**注意事项：**

- **命令名应使用字符串字面量**：`/` 菜单中的命令列表基于静态扫描生成，`registerCommand(someVariable, …)` 形式无法被扫描到。命令本身仍可执行，但不会出现在菜单中。
- 仅当整条消息为命令格式时触发（如 `/deploy staging`，不含附件）。
- 与 piwin 内置命令（`/compact`、`/goal`、`/plan` 等）或已安装技能同名时，不会在菜单中显示，建议使用不同的命令名。

### 4.5 自定义渲染 → 结构化工具结果

piwin 不执行 `renderCall` / `renderResult`，工具结果按原始内容显示。应将用户可读信息放入 `content`，结构化数据放入 `details`：

```ts
return {
  content: [{ type: 'text', text: `找到 ${hits.length} 处引用：\n${hits.map((hit) => `- ${hit.file}:${hit.line}`).join('\n')}` }],
  details: { hits },
};
```

---

## 5. 同时兼容 Pi 终端与 piwin

无需维护两个版本。`ctx.ui.custom` 在 piwin 中会抛出异常，而组件面板调用会被静默忽略。利用这一行为，采用「先尝试 TUI，异常时降级」的策略即可实现双端兼容：

```ts
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';

/** Pi 终端中使用 TUI 选择器；piwin 或其他不支持 custom UI 的宿主中回退为标准选择框。 */
async function pickOne(ctx: ExtensionContext, title: string, options: string[]): Promise<string | undefined> {
  try {
    return await ctx.ui.custom<string | undefined>((tui, theme, keybindings, done) =>
      new FancyPicker(title, options, theme, done),
    );
  } catch {
    return ctx.ui.select(title, options);
  }
}

/** 面板：使用文本数组确保 piwin 兼容，Pi 终端中可选择性使用组件覆盖。 */
function showPanel(ctx: ExtensionContext, lines: string[]) {
  ctx.ui.setWidget('panel', lines);
}
```

如需运行时检测当前宿主：piwin 提供的主题对象 `ctx.ui.theme.name` 值为 `'piwin-host'`。但这属于实现细节，**推荐优先使用上述 try/catch 模式**。

---

## 6. 完整示例：TODO 看板迁移

**迁移前**（仅支持 Pi 终端）：通过快捷键打开全屏看板，组件面板渲染列表，页脚显示计数。

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

**迁移后**（兼容 piwin 桌面客户端、CLI、移动端，同时保持 Pi 终端兼容）：

```ts
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

type Todo = { id: number; text: string; done: boolean };

export default function todoBoard(pi: ExtensionAPI) {
  const todos: Todo[] = [];
  let nextId = 1;

  // 使用状态标签和文本面板，替代原有的页脚和组件面板
  const render = (ctx: ExtensionContext) => {
    const open = todos.filter((todo) => !todo.done).length;
    ctx.ui.setStatus('todos', open > 0 ? `待办 ${open}` : undefined);
    ctx.ui.setWidget(
      'todos',
      todos.length > 0 ? todos.map((todo) => `${todo.done ? '✓' : '○'} #${todo.id} ${todo.text}`) : undefined,
      { placement: 'belowEditor' },
    );
  };

  // 注册工具供模型调用，返回可读的文本结果
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

  // 将快捷键替换为斜杠命令 + 选择框
  pi.registerCommand('todo-done', {
    description: '将一项待办标记为完成',
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

迁移完成后，扩展不包含任何 TUI 调用，静态扫描结果为「可用」。

---

## 7. 打包规范

piwin 及扩展仓库安装扩展时，仅拉取指定 commit 的源码原样存放至不可变目录，**不执行 npm install 或任何脚本**：

- 入口文件为扩展目录下的 `index.ts`；单文件扩展可直接使用 `.ts` 文件。
- `package.json` **不允许声明 `dependencies`**。第 1 节列出的宿主包应放入 `peerDependencies` 或 `devDependencies`。
- 其他第三方依赖需**打包进源码**。推荐使用 esbuild 构建为单文件，将宿主包标记为外部依赖：

  ```bash
  npx esbuild src/index.ts --bundle --format=esm --platform=node \
    --external:@earendil-works/* --external:typebox \
    --outfile=dist/index.ts
  ```

  输出为纯 JavaScript，同时也是合法的 TypeScript，因此文件扩展名可使用 `index.ts`。发布前请先在本地执行安装测试（见第 8 节）。
- 禁止包含 `preinstall` / `install` / `postinstall` / `prepare` 脚本，禁止符号链接和 `node_modules` 目录，总大小上限 5 MB，文件数上限 2000。

---

## 8. 本地调试

```bash
piwin extension install --local ./my-extension   # 创建不可变版本快照，默认不启用
piwin extension list                             # 查看 id 及兼容等级
piwin extension enable <id>                      # 启用扩展
```

- **桌面客户端**：通过 **设置 → 扩展** 管理启用/停用状态，点击「应用到当前 Agent」使变更在当前轮次结束后生效。
- **更新代码后**：重新执行 `install --local`，piwin 根据内容哈希生成新版本，然后在设置中点击「应用到当前 Agent」。
- **CLI 调试**：`notify` 及状态变更会输出为日志行，适合观察扩展的输出行为。
- 在桌面客户端输入 `/` 可验证命令是否正确注册到「扩展」分组。

---

## 9. 发布流程

访问 [piwin 扩展仓库提交页面](https://extension.piwinwin.com/#/submit)，使用 GitHub 账号登录，将扩展文件夹拖入页面并点击「一键发布」。系统将在你的账号下创建仓库存放源码，并自动向扩展仓库提交 PR。发布前会使用与仓库 CI 相同的规则验证第 7 节的打包规范。完整说明参见扩展仓库的 [CONTRIBUTING](https://github.com/mimimaster/piwin-extensions/blob/main/CONTRIBUTING.md)。

PR 合并后数分钟内，所有 piwin 用户即可在桌面客户端扩展市场中搜索并安装该扩展（CLI 暂不支持市场浏览）。

仓库索引由 Host 读取；桌面客户端 **扩展市场 → piwin 扩展** 展示已上架条目。

### 9.1 订阅 / OAuth 提供商扩展

如果扩展通过 `pi.registerProvider` 提供需要登录的模型（OAuth 或 API Key），可以在扩展目录的 `piwin.json` 中声明一个订阅提供商，让它出现在 piwin 的 OAuth 设置页：

```json
{ "authProvider": "acme-cloud", "authProviderName": "Acme Cloud" }
```

- `authProvider` 必须等于扩展 `registerProvider` 注册的提供商 id，格式为小写 slug（`[a-z0-9][a-z0-9-]{0,63}`）。不能占用 piwin 内置的订阅 id（`kimi-coding`、`openai-codex`、`anthropic`、`xai`、`github-copilot`、`devin`、`anthropic-claude-code`）；非法或保留的声明会被忽略并在 Host 日志中警告。两个已启用扩展声明同一 id 视为错误。
- `authProviderName` 可选，是 OAuth 卡片上的名称；省略时依次回退到 `registerProvider` 传入的 `name`、再到 id。
- 每个扩展只能声明一个提供商，Host 也只注册这一个 id，扩展无法借此注入其他提供商。
- 启用扩展后，OAuth 设置页出现连接卡片；授权完成后模型进入模型管理。凭证保存在 Host 的 `~/.piwin/pi-agent/auth.json`，扩展自选 `oauth` 或 `api_key` 凭证形态均视为已登录。停用或卸载扩展后，卡片和模型会在下次状态同步时消失，已存凭证保留到用户退出登录。
- 这类扩展在 OAuth 页加载时同样以 Host 用户的系统权限运行。

参考示例：[Command Code for piwin](https://github.com/mimimaster/piwin-commandcode-provider/tree/main/piwin)，其 `piwin.json` 声明 `authProvider: "commandcode"`。
