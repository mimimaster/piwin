# Windows 原生 Host 的命令 shell 发现与故障恢复（建议稿）

> 2026-09-26 · 状态：Host 的探测/路径缓存部分已实现在代码中；Windows 真机待验。设置、结构化诊断与轮次级固定仍是建议。
>
> 范围：运行在 Windows 的 piwin Host 所执行的 Agent `bash` / `run_bash` 工具；Desktop 和 CLI 通过同一个 Host 查看状态。

## 1. 现场与根因

用户的 Git for Windows 安装在 D 盘。修复前的实现仅检查环境变量、几个 C 盘常见位置及 PATH；`findGitBash()` 对候选只做文件存在检查，并取第一个存在的 `bash.exe`。因此 PATH 中较早的 `C:\Windows\System32\bash.exe`（WSL 启动器）被误报为 Git Bash；即使它不能执行命令，查找也已经停止。`host/shell-environment` 进一步把这种“找到了文件”报告成 `gitBashInstalled: true`，安装引导不会出现。真正的 D 盘 Git Bash 既不在固定目录，也未必在 PATH。

截图显示该次执行选中了 WSL 路径并失败；另一张截图里的 `pnpm` 启动失败不应直接归因于同一个 shell 问题，需单独诊断。截图中的 Agent 自述可作为线索，最终判断以 Host 执行记录和代码为准。

目标：Host 自动选择**已验证、可执行的 Git for Windows Bash**；任意盘符和便携版可由用户指定；失败时清楚说明正在使用什么、为什么失败、下一步怎么修复。不能让 Windows 原生 Host 把 WSL 启动器误当 Git Bash。

当前可用的指定路径方式：确认 D 盘 Git 安装目录中存在 `bin\bash.exe` 后，将**运行 Host 的进程环境**变量 `PIWIN_GIT_BASH` 指向该文件，再重启 Host。Host 会先验证它；设置页尚无手选路径和可视化诊断。远程 Desktop 必须在远程 Host 设置，客户端本机设置无效。

## 2. 用户体验

在「设置 → 环境 → 命令 Shell」显示 Host 平台、当前实际执行器、来源、状态与最近一次检查时间。例如：

> 当前命令环境：Git Bash · `D:\Program Files (x86)\Git\bin\bash.exe` · 已验证

若未找到可用 Git Bash：

> 找到了 `C:\Windows\System32\bash.exe`，但它是 WSL 启动器，不能作为 Git Bash 使用。当前命令将使用 PowerShell。选择现有 Git Bash，或重新扫描。

提供「重新扫描」「选择 Git Bash」「下载 Git for Windows」「复制诊断」。选文件时接受 Git 安装目录或其中的 `bin\bash.exe`，统一解析到包装器；若选了 `git-bash.exe` 或 `usr\bin\bash.exe`，先定位同安装目录下的 `bin\bash.exe` 再验证，不直接把 GUI 启动器或底层程序当作命令入口。路径可以在 C/D/E 等任意盘，也能包含空格或非 ASCII 字符。

文件选择器只适用于 Desktop 与 Host 在同一台 Windows 机器；远程 Host 须输入/选择**Host 上**的路径，明确标注「此路径位于 Host 机器」，不能把客户端本地路径送到 Host。CLI 在 `piwin doctor` 展示同一诊断，并有等价的 Host 配置途径。

安装引导不再说「没有 Git Bash」，而根据检查结果说「未找到**可用的** Git Bash」。用户此前选「不用，走 PowerShell」仅压制重复引导，设置页及运行错误里仍可查看状态和重新扫描。选定有效 Git Bash 后提示即时生效的时机；活动中的 Agent 轮次不切换执行器。

## 3. Host 选择规则

1. 默认模式为自动发现；可选填 `shell.gitBashPath` 作为**显式路径**，不是“永久选择 PowerShell”。旧的 `windowsBashOfferDeclined` 仅用于引导显示，不影响解析。
2. 顺序：有效的显式路径 → 有效的部署变量 `PIWIN_GIT_BASH` → Git for Windows 安装元数据和 `git.exe` 所在安装根推导 → 常见安装目录 → PATH 上的候选。每层均枚举、去重、验证；一个候选失败就记下原因并继续，而不是见到文件就返回。安装元数据、PATH 均以**运行中的 Host**为准。不要扫描整块 D 盘。
3. PATH 中的 `bash.exe` 只是候选，不能因名字匹配而确认身份。`System32\bash.exe`、WindowsApps 别名及 WSL 启动器排除于 Git Bash 候选。未来若支持 WSL，应设计独立的 Host/工作区路径模型和显式选项。
4. 对候选核对 Git for Windows 安装结构，选用 `<Git>\bin\bash.exe` 包装器，并通过短时、无副作用的 `-lc` 试运行检查退出码、标记输出与工作目录。检查有超时、取消及进程清理；拒绝只存在、启动失败、超时或输出不符的候选。试运行使用真实 Agent 调用方式，但不执行用户命令。
5. 显式路径保存前必须验证。日后路径失效时，记录“所选路径已失效”，继续自动发现其余有效候选；若无 Git Bash，再进入 PowerShell 后备。不能悄悄把失效状态显示为“Git Bash 已安装”。修好路径后下一轮自动恢复。
6. 发现、状态展示、系统提示与命令执行使用同一份 Host 解析结果。每个 Agent 轮次固定一次 shell 种类与路径；新一轮重新检查。若执行器在轮次中消失，报告启动失败并结束该次工具调用，不在用户命令已可能开始后换 shell 自动重放。
7. PowerShell 保留为后备执行器，但须验证其本身可启动；Agent 的工具描述和系统提示明确它运行的是 PowerShell 语法。若两者都不可用，工具返回环境错误和修复动作，不把 PATH 上另一个未知 `bash` 当作替身。

Git for Windows 官方说明 `bin\bash.exe` 是设置环境后再启动真正 Bash 的包装器；WSL 则是独立的 Linux 执行环境，Windows 路径和工作目录需要转换。因此两者不能仅凭文件名互换。[Git for Windows wrapper](https://gitforwindows.org/git-wrapper.html) · [Microsoft WSL interop](https://learn.microsoft.com/en-us/windows/dev-environment/wsl-interop)

## 4. 失败语义和可观察性

| 事件 | 产品行为 |
|---|---|
| 候选文件存在但验证失败 | 继续查找，诊断列出“跳过 WSL/启动失败/超时”等归类 |
| 选定 Git Bash 启动前失效 | 本次命令返回可恢复的环境错误；重新扫描供下次调用使用 |
| shell 已启动，用户命令返回非零 | 视为命令失败；**不换 shell 自动重试**，防止重复文件/网络副作用 |
| 没有可用 Git Bash | 使用已验证的 PowerShell，明确显示当前语法；安装提示仍可访问 |
| Host 状态请求失败或旧版 Host 不支持 | 显示「无法判断 Host 命令环境」，不等同于“未安装” |

诊断应包括 Host 平台、执行器类型、来源、路径、验证时间、已跳过候选与安全的原因码，以及最近一次执行是“启动失败”还是“命令失败”。不包含用户命令内容、环境变量值或凭据；普通 Agent 提示只拿到 shell 类型，不需要本机绝对路径。

## 5. 实现归属与分期

**已在本轮实现的范围：** Windows Host 枚举候选并验证真实 Git Bash；查找 HKCU/HKLM 的 Git for Windows 安装位置；跳过 WSL 启动器；将成功路径保存在 `~/.piwin/cache/windows-git-bash.json`，后续调用优先复用，Host 重启后首次复用再验证；路径失效时重新查找。Host 状态查询、系统提示、Job 与直接执行路径使用同一配置根。macOS/Linux 保持原解析逻辑。以下 P0/P1 是尚待交付的产品体验与执行一致性工作。

**P0，后续体验：** `contracts` 扩充 Host shell 状态与可选的显式路径配置；Desktop 引导增加「选择现有 Git Bash」和重新扫描；同一轮次提示与执行绑定。目前 `bash`/`run_bash` 的 Job 与直接执行路径都使用同一发现结果，但活动轮次尚未锁定执行器。

**P1，完善体验：** 设置页候选列表、最后检查时间、复制诊断；CLI doctor 对齐；远程 Host 路径选择；对环境变化的按需失效/刷新，避免每条命令都重复启动探测进程。

契约先在 `packages/contracts` 增加**结构化状态**，建议包含 `platform`、`shellKind`、`health`、`source`、可展示的 `executablePath`、`checkedAt`、`rejectedCandidates`。旧版 `{ platform, gitBashInstalled }` 可过渡保留；新客户端在旧 Host 上显示“状态未知”。Host 配置仅新增可选路径，默认仍自动发现。实际文件选择/执行器验证均由 Host 做；Desktop/CLI 不自行 `where bash`。

Host 自动发现的路径保存在独立缓存中，不写 `config.json`。若后续交付手选路径，才把用户明确指定的路径作为配置保存；自动发现仍为默认。

## 6. 验收场景

- D 盘安装、路径有空格/中文且不在 PATH：用户选择一次后验证成功，下一轮 Agent 命令用该路径；重启 Host 后仍有效。
- PATH 顺序为 `System32\bash.exe`、WindowsApps 别名、真正 Git Bash：前两者被记录为跳过，最后一个被选中。
- PATH 只有不可用 WSL 启动器：不用它执行 `-lc`，显示 PowerShell 后备及原因；引导可选择现有安装。
- C 盘标准安装、安装元数据定位的非默认盘安装、便携版手选路径都可运行；不存在 Git Bash 时仍可用 PowerShell。
- 已保存路径被移动/卸载：状态报失效，继续检查其它候选；恢复原路径或重新选择后下一轮生效。
- 验证进程超时、拒绝启动、Host 状态请求失败、PowerShell 也不可用均有不同错误；探测进程会清理。
- 轮次中安装/卸载 Git Bash 不改变该轮的 shell 语法；用户命令一旦可能开始，即使失败也不被另一 shell 自动执行第二次。
- Desktop、CLI、远程 Desktop 看到的是同一 Host 的 shell 状态；远程输入路径被解释为 Host 路径。

交付门槛：Windows 真机/虚拟机覆盖 WSL 占位符、D 盘自定义安装和便携版；候选选择与失败分类单测；Host 两条命令执行路径的集成验证；全仓 `pnpm typecheck` 和受影响包测试通过。
