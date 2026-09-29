# 多会话并发写入：乐观的工作区写锁

> 同一个项目里开多个会话并行干活时，piwin 怎样让它们互不阻塞，又不悄悄覆盖彼此的改动。

---

## 1. 问题：一个会话跑测试，所有会话都在等

piwin 的写盘统一由 Host 执行：`write_file`、`delete_file`、`bash`、Git 操作都在 Host 进程里跑，Host 用一把「工作区写锁」协调它们，保证每一轮对话的改动都能被准确记录、可以撤销。

最初的规则很保守：**任何 bash 命令都拿整个工作区的独占锁**，并且要等命令结束才释放。理由是 shell 可以做任何事（重定向、代码生成、`git checkout`），Host 无法知道它改了哪些文件。

单会话时这没问题。但多个会话在同一个项目里并行时，问题就来了：

```text
会话 A:  pnpm test ████████████████████████████████ (7 分钟，持有独占锁)
会话 B:  rg "foo" ·························· 排队 ······ ▌(40ms)
会话 C:  write_file ························ 排队 ········ ▌
```

一个会话在跑几分钟的测试，其他会话连 `rg`、`sed -n`、`git status` 都得排队。卡片上显示「运行了 7 分钟」，其实命令只执行了 40 毫秒，其余全是排队。

---

## 2. 别人是怎么做的

我们调研了几款主流 coding agent：

| 工具 | 并行怎么处理 |
|---|---|
| Claude Code | 没有跨会话锁。编辑前要求先读，靠文件修改时间判断是否过期；并行靠 git worktree 隔离 |
| Codex | 每个线程一个 worktree；多个线程都用主 checkout 时不加锁，冲突靠手动合并 |
| Cursor | 每个 agent 一个 worktree 或远程机器 |
| OpenCode | 单进程内按文件串行，加读取时间戳做过期检查；没有跨会话锁 |

结论很清楚：**没有谁给 shell 加工作区级的独占锁**。它们要么隔离（worktree），要么在单个文件上做「过期检测」。

piwin 已经支持 worktree 会话，隔离是真正并行时的首选。但很多时候你就是想几个会话共用一个 checkout，这时需要一个既不阻塞、又不会静悄悄出错的方案。

---

## 3. 设计思路：从「事前阻止」改成「事后发现」

新方案的核心取舍：

- **默认乐观**：普通 shell 命令不再独占工作区，和其他会话的写入、其他 shell 同时运行。
- **只锁真正危险的少数命令**：会整体改写工作区的操作（切分支、装依赖、全仓格式化）仍然独占。
- **冲突靠检测**：Host 记录「谁在什么时间段动过工作区」，命令结束或写文件时对照这份记录，发现交叉就告诉模型。
- **局部修改走专门工具**：提供一个在锁内按文本替换的 `edit`，天然不会覆盖别人的改动。

撤销的安全性不依赖这把锁：撤销前 Host 会逐个比对文件内容哈希，只要有文件被别人改过就整体拒绝，写完后还会再校验一次。所以锁放松以后，最坏情况是撤销更常被拒，而不是文件被写坏。

---

## 4. 实现拆解

### 4.1 三种租约

Host 的写锁（gate）按工作区根目录（realpath）记账，路径相同或有祖孙关系就算同一工作区。独立的 worktree 互不影响。

| 操作 | 租约 | 和谁冲突 |
|---|---|---|
| `write_file` / `edit` / `delete_file` | 工作区共享 + 单文件独占 | 同一文件的其他写入；独占持有者 |
| 普通 `bash` | 工作区共享（不占文件） | 只和独占持有者冲突 |
| 危险 shell 命令、Host Git 写操作、子代理合入 | 工作区独占 | 所有人 |
| 撤销 / 重做 | 工作区独占，拿不到就立即失败 | 所有人 |

### 4.2 哪些命令仍然独占

判断规则在 `shell-write-policy.ts`，配有一组 golden 测试用例：

- **改写工作区文件的 Git 子命令**：`checkout`、`switch`、`reset`、`restore`、`stash`、`rebase`、`merge`、`pull`、`cherry-pick`、`clean` 等。
- **装依赖**：`pnpm install/add/remove`、`npm ci`、`yarn add` 等。
- **全仓格式化**：带 `--write` / `--fix` 的 prettier、eslint、biome。

`git add` 和 `git commit` 不在名单里：它们只改 index 和 `.git`，Git 自己的 `index.lock` 已经会把它们互相串行。

这里用「黑名单」而不是「白名单」，是因为漏判的代价不同。漏掉一条，只是退回到其他 agent 的默认行为（不加锁），而且事后检测还会报告改动；不会出现「本该保证的东西被悄悄打破」。解析时连引号里的内容一起扫描，所以 `bash -c 'git checkout x'`、`$(git stash)` 也能识别。

### 4.3 有限的「读优先」

严格先来后到有个隐患：会话 B 的 `git checkout` 排在会话 A 的长测试后面，之后**所有会话的所有 shell** 又都排到 checkout 后面，回到了最初的局面。

所以 gate 允许共享请求在独占请求排队的**前 20 秒**插队。超过 20 秒后，新来的共享请求才排到它后面，独占请求不会被一直饿着：

```text
t=0s   A: pnpm test ──────────────────────────────▶ (共享)
t=1s   B: git checkout ··· 排队（等 A）
t=5s   C: rg foo ▌                  ← 20 秒窗口内，直接执行
t=25s  D: ls ········ 排到 checkout 后面   ← 窗口已过
```

### 4.4 活动日志

gate 每授予一个租约，都会在 `workspace-activity-log.ts` 里记一条：哪个会话、哪个工作区、写了哪些文件、从第几个时刻到第几个时刻。时刻用逻辑时钟（每次开始/结束加一），不读系统时间，顺序精确。

所有检测都基于一个查询：**「从时刻 T 起，别的会话在这个工作区做过什么？」** 返回别人写过的文件、别人跑过的 shell 数、独占操作数。日志有容量上限，太久远的窗口会被标记为「不完整」，这时检测一律按乐观处理。

### 4.5 命令结束后的标注

一条普通 shell 跑完后，Host 查询它运行期间别的会话做了什么：

- 别的会话通过 Host 写过文件：文件名是精确知道的。
- 别的会话跑过 shell：Host 不知道它改了什么，就对比运行前后工作区的「脏文件指纹」（`git status -z` 列出的文件加上大小和修改时间）。
- 别的会话只是读文件、没有任何文件变化：**不提示**，避免噪音。

有交叉时，模型会在结果末尾看到类似这样的说明：

```text
[workspace] Other sessions were active in this workspace while this command ran,
so its result may not match the current files.
Written by other sessions: src/api.ts
Changed during the run (may include this command's own writes): src/api.ts, src/api.test.ts
Re-run the command if you need a result for the current files.
```

测试不会被阻止，但模型知道结果可能对应的是混合版本，需要时自己重跑。

**指纹只在真有重叠时才拍**（`shell-baselines.ts`）。单会话工作时不做任何额外的 `git status`，成本为零。一条 shell 开始时如果已经有别的会话在活动，它先拍一张快照再执行，并把快照「发布」出去；之前独自开始的 shell，就用它开始之后第一张发布出来的快照当基线。在那之前没有别人活动，所以此前的变化一定是它自己造成的。

### 4.6 整文件覆盖前的检查

`write_file` 会整个替换文件，是最容易冲掉别人改动的操作。Host 为每个会话记下它最后一次写每个文件时的内容哈希（`session-file-ledger.ts`）。再次写同一个文件时：

- 文件没变：照常写。
- 文件变了，而且期间别的会话写过它，或别的会话在工作区跑过命令：**拒绝一次**，提示模型重新读取、合并后再写。模型确认后重试就会放行。
- 文件变了，但期间没有别人活动：是自己的格式化器或外部编辑器改的，照常写。
- 只有 shell 活动、而且自己也跑过 shell：无法判断是谁改的，按乐观处理放行。

局限：`read` 在 worker 进程里执行，Host 看不到模型读过哪个版本，所以「先读、很久以后第一次写」这种情况还没有覆盖。补法和暂缓原因见 [6.1 「先读后写」检查](#_6-1-「先读后写」检查-d-wwg-01)。

### 4.7 Host 自己的 `edit` 工具

数据显示，模型改文件时大量使用 `python3` heredoc 或 `sed -i`。原因是 piwin 以前只有整文件覆盖的 `write_file`，没有局部修改工具（Pi 自带的 `edit` 在 worker 里直接写盘，为了保证 Host 是唯一写盘入口而关闭了）。shell 改文件对 Host 是黑盒：不能检查、不能归因，还会让撤销记录不完整。

现在 Host 提供了同名的 `edit` 工具，参数和说明文字与 Pi 的 `edit` 一致（模型更熟悉这个格式）：

```json
{
  "path": "src/api.ts",
  "edits": [
    { "oldText": "const timeout = 30;", "newText": "const timeout = 60;" }
  ]
}
```

关键在于：**文本匹配发生在 Host 的单文件锁内，针对的是磁盘上此刻的内容。**

```text
原文件:        top / middle / bottom
会话 B edit:  bottom → BOTTOM          ✓
会话 A edit:  top → TOP                ✓   （B 的改动保留）
会话 A edit:  bottom → end             ✗   找不到 "bottom"，提示重新读取
```

- 别人改了文件的其他位置：替换照样成功，而且保留别人的改动。整文件覆盖和 `sed` 都做不到这一点。
- 别人改了同一段：匹配失败，模型重读后再改，不会悄悄覆盖。
- 不做模糊匹配（Pi 原版在精确匹配失败时会忽略引号样式、行尾空格等差异）：宽松匹配可能落到别人刚改过的文字上。
- 保留原文件的 BOM 和 CRLF 换行。
- 改动走和 `write_file` 一样的权限确认，并生成撤销记录。

为什么不直接用 Pi 原生 `edit`、或 agent-host 里已有的 Pi 工具工厂？后者把「读文件」和「写文件」拆成两次独立调用，匹配发生在两次调用之间的 worker 里，别的会话能在中间插进来，并发安全就没了。

`write_file` 和 `bash` 的工具说明也改了，引导模型用 `edit` 做局部修改，而不是用 sed/python 脚本。

### 4.8 排队时间单独显示

gate 会测量每次等锁的时间，放进工具结果的 `details.workspaceWrite.queuedMs`。桌面端工具卡片会把它单独显示出来：

```text
bash  pnpm typecheck        排队 380s · 40ms
```

---

## 5. 保证什么，不保证什么

| 场景 | 结果 |
|---|---|
| 会话 A 跑测试，会话 B 搜索、读文件 | 并行，无提示 |
| 会话 A 跑测试，会话 B 用 `edit` / `write_file` 改文件 | 并行；A 的结果带上「期间被修改」的说明 |
| 两个会话 `edit` 同一文件的不同位置 | 都成功，互相保留 |
| 两个会话 `edit` 同一段 | 后到的匹配失败，重读后再改 |
| 会话 A 整文件覆盖一个 B 刚改过的文件 | 拒绝一次，要求重读 |
| 会话 A 跑测试时，会话 B `git checkout` | B 排队等 A 结束（最多被插队 20 秒） |
| 两个会话的 shell 同时写同一个文件 | **不阻止**，后写的赢；事后在结果里标注 |
| 用外部编辑器、MCP 工具、后台进程改文件 | 不在这套机制内 |
| 撤销被别人改过的文件 | 拒绝并列出被改的文件 |

需要真正隔离时，给会话开独立的 worktree：不同工作区根目录之间永远不共享锁。

---

## 6. 尚未实现（待办）

以下几项讨论过、有意暂缓，**目前没有实现**。仓库里对应的登记在 `docs/todo-deferred.md` 的 `D-WWG-*` 条目。

### 6.1 「先读后写」检查（D-WWG-01）

**缺口**：模型读了一个文件，隔了很多步（在作者本机数据里，读和写之间中位隔 22 次工具调用）才第一次用 `write_file` 整文件覆盖它。如果这期间别的会话改过这个文件，现在拦不住，别人的改动会被冲掉。

现有的写后写检查只覆盖「本会话写过、之后被别人改了」；`edit` 靠写入时匹配，不受影响。剩下的只有「第一次整文件覆盖」这一种。

**打算怎么做**：

1. `read` 在 worker 里执行，Host 看不到内容，但能看到读完成的事件和路径。agent-host 在事件里把路径交给 Host 的一个端口，Host 当场对文件算一次哈希，记进会话文件账本（`session-file-ledger.ts`）。读和算哈希之间有极短的竞态，可以接受。
2. `write_file` 覆盖**已存在**的文件时：如果本会话从没读过、也没写过它，或者读完后被别的会话改过，就拒绝一次，提示重新读取。新建文件不受影响。
3. 这和社区扩展 [pi-read-before-write](https://github.com/SteelDynamite/pi-read-before-write) 的思路一样，但它只挂在 Pi 原生 `edit`/`write` 上，在 piwin 里用不了，得在 Host 侧实现。

**为什么暂缓**：`edit` 上线后，局部修改不再需要整文件覆盖，这个缺口应该小很多。先观察一两周：统计「整文件覆盖一个已存在、且本会话没读过的文件」还剩多少，再决定值不值得加一条 worker 到 Host 的读事件管道。

### 6.2 其他暂缓项

| 编号 | 内容 | 暂缓原因 |
|---|---|---|
| D-WWG-02 | shell 写入的改动归因：没有别的会话重叠时，用指纹对比结果把改动记到这条命令名下，而不是把本轮撤销记录标成「不完整」 | 有重叠时归因说不清；先让 `edit` 把大部分改文件操作从 bash 里拉出来 |
| D-WWG-03 | 长测试 / 构建在快照或临时 worktree 里跑，别的会话照常编辑，测试结果对应确定的版本 | pnpm monorepo 每个 worktree 都要处理 `node_modules`，代价大；目前靠「期间被修改」的标注兜底 |
| D-WWG-04 | 在已有会话运行的工作区里新开会话时，提示或默认使用 worktree | 产品交互还没定；乐观写锁服务的是「就想共用一个 checkout」的场景 |
| D-WWG-05 | 给 OpenAI / Codex 系模型提供 `apply_patch` 格式；hashline 编辑评估后暂不采用 | 先上线与 Pi 同格式的 `edit`；hashline 的基准结论不一致，还要改 `read` 的输出格式 |
| D-WWG-06 | 排队界面显示「正在等哪个会话的哪条命令」，并提供取消 | 先把排队时间单独显示出来；显示持锁者需要新的查询和推送 |
| D-WWG-07 | 两个会话的 shell 同时写同一个文件时，后写的赢，只能事后标注 | 这是乐观方案有意接受的代价，不打算修，但要一直记着 |

---

## 7. 代码位置

| 模块 | 职责 |
|---|---|
| `host-runtime/src/turn-changes/workspace-write-gate.ts` | 租约、排队、有限读优先 |
| `host-runtime/src/turn-changes/workspace-activity-log.ts` | 活动日志（逻辑时钟） |
| `host-runtime/src/turn-changes/session-file-ledger.ts` | 整文件写入的过期判断 |
| `host-runtime/src/tools/shell-write-policy.ts` | 哪些命令独占 |
| `host-runtime/src/tools/run-host-shell.ts` | shell 执行、事后标注 |
| `host-runtime/src/tools/shell-baselines.ts` | 仅在重叠时拍指纹 |
| `host-runtime/src/tools/workspace-fingerprint.ts` | `git status` 指纹与对比 |
| `host-runtime/src/tools/host-edit-tool.ts`、`text-edits.ts` | Host `edit` 工具 |
| `docs/adr/0069-workspace-write-gate.md` | 设计决策记录 |
