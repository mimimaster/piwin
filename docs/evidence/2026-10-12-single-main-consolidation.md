# piwin 本地分支与工作区收敛（2026-10-12）

用户要求把本地开发内容统一到 `main`，只保留一个本地主分支和主工作区。
处理前有 7 个本地分支、6 个 Git 工作区；处理后仅有 `main` 和
`/Volumes/BigDisk/Developer/piwin`，工作目录无未提交源码。

## 归并结果

| 来源 | 处理 |
| --- | --- |
| `feat/artifact-expressive` | 已在 main；保留完整 Artifact v14 功能、修复及验收历史 |
| `feat/cli-open-image` | 合入 CLI/Grok 图片预览及子代理界面，并按职责保存全部未提交源码 |
| `codex/scout-codemode-experiment` | 合入 8 个独有研究提交；保留实验记录、输入、分析与离线测试 |
| `feat/cli-tui` | 已是 main 祖先，无独有内容 |
| `piwin/subagent/slot-0` | 已提交历史属于 main；契约与最终实现相同的内容已保留，迁移额外 3 项守卫回归 |
| `backup/pre-strip-signatures` | 源码树与 main 祖先 `5bc0ced1` 完全相同；旧签名改写前历史存入 bundle，不重复合入历史 |
| App Store 临时工作区 | 图标、脚本和音频权限已在当前代码；旧 `.14` 配置不覆盖当前 `.15`，生成的原生项目资料已归档 |
| Desktop release 临时工作区 | 唯一源码差异是当时打包用的 `0.2.0` 版本；归档该配置，保持源码版本占位由现有打包脚本按标签替换 |

旧子代理候选已由当前会话的最终实现替代，原候选源码和 index 状态仍有完整备份。
最终 Host 复习工具复用既有 mutation/sanitize 路径，没有引回旧候选的重复实现。

未提交改动分别保存为：活动子代理并发限制、任意用户执行方式的计划确认、
精简 Artifact 决策规则、子代理原型、原生复习工具、SDK/RPC 扩展命令传递、
可选教学扩展及真实 Pi 集成夹具。源码合并完成于 `a4724bcb`，没有冲突。

## 验证

| 检查 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过（仓库默认脚本不包含 Mobile） |
| 包边界与生产文件 1000 行限制 | 通过 |
| contracts | 810 项通过 |
| agent-host | 757 项通过 |
| artifact | 320 项通过 |
| flashcards | 109 项通过 |
| host-runtime | 3966 项通过，含 SDK/RPC Study Space 和提示词预算回归 |
| Desktop | 5783 项通过 |
| 独立 Study Space | typecheck 通过，93 项测试通过 |
| Scout 离线脚本 | `node --import tsx --test scripts/research/scout-codemode/*.test.mjs`，14 项通过 |
| v14 浏览器回归 | 主工作区提供页面，Chromium/WebKit 各 6 项，共 12 项通过 |

本轮没有运行新的付费模型实验，也没有发布安装包。

## 清理与恢复

已移除 5 个额外 Git 工作区及 6 个本地分支，保留远程分支。
在清理前逐一确认工作文件仍与备份一致；主工作区没有指向待删除目录的依赖或
构建缓存链接。预览服务已迁回主工作区，原来的 `14491` 地址仍可使用。

备份目录：
`/Users/yorickjue/.piwin/backups/piwin-consolidation-20261012-111924/`。
含验证过的原始 `all-refs.bundle`、归并后的 `consolidated-refs.bundle`、各工作区的
working/index patch 和文件 tar；需保留的 iOS 生成项目也已存档。
依赖目录、编译产物和可重建缓存未复制进源码提交。

个人 Obsidian 配置、两张粘贴截图与空白笔记仍留在主目录，通过本地
`.git/info/exclude` 排除，不丢弃或提交媒体。独立的 `piwin-extensions-agent`
仓库不属于本仓 Git 工作区，保持原样。

通过 `@piwin/project` 的公开 API 移除两个已删除工作区的侧栏登记；
`projects-before-cleanup.json` 已保存，未改动任何会话文件。

本次请求是本地收敛；新增的收敛提交尚未推送。此前 Artifact 功能的
`origin/main` 仍在 `2237cd8a`。
