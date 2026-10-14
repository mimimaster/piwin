# Study Space 可发现命令入口验收

日期：2026-10-12。

## 实现

- 独立注册 teacher-ta / learn / resume / review / status / off，保留旧子命令。裸 `/teacher` 打开基本选择菜单；无 UI 输出帮助。
- 继续/复习按课程名称选择，同名用序号区分；空列表提供创建入口。取消选择保留状态；切会话和退出取消未完成激活。状态异步读取不会在退出后恢复旧展示。
- 学习进度复用文本 widget：模式、课程、实际练习记录、路径阶段、下一次练习和待核对制卡结果。退出或模式切换清除展示，不宣布掌握。
- contracts 添加可选 commandDescriptions；Host 静态读取字面量，不执行扩展；Desktop 斜杠菜单与扩展菜单展示用途，复用既有匹配支持中文搜索。旧 Host/扩展仍按名称和来源回退。
- 使用指南、ADR 0080、主仓测试副本与独立扩展源码同步。独立源码：`/Volumes/BigDisk/Developer/piwin-study-space`，分支 `codex/study-space-command-entry`。

## 验证

| 范围 | 结果 |
| --- | --- |
| Study Space 全套单元/跨进程/原生门控/可移植性 | 108 项通过 |
| Host 命令描述/实际源码发现/扩展扫描/SDK 与 spawned RPC 原生闪卡链路 | 23 项通过 |
| Desktop 菜单/真实输入框中文搜索与点击/兼容回退 | 51 项通过 |
| 相关扩展兼容性及 UI contracts | 4 项通过 |
| 主仓扩展副本及独立源码 typecheck | 通过 |
| 架构边界检查、两个源码仓库 diff --check | 通过 |
| 本次生产文件行数 | 最大 378 行，无文件超过 1000 行 |
| 安装包 | `/private/tmp/piwin-study-space-0.1.1.tgz`；11 个生产文件，含 status.ts，无 tests/node_modules |

共 186 项相关测试通过；独立源码另行运行相同的 108 项也全部通过，未重复计入总数。真实模型教学质量和已发布 Desktop 外观不在此次自动验收范围。

全仓 `pnpm typecheck` 未通过：并行新增的 `packages/host-runtime/src/grok/native-cli-catalog.integration.test.ts` 第 47 行 optional scope 和第 63 行缺少 getAgentCliOwnership API 两处类型错误。单独 Desktop typecheck 还受到已有 `src/xterm-image-addon.ts` 缺失 `@xterm/addon-image` 的影响；锁文件里的该包未登记到 Desktop importer，frozen install 拒绝安装。没有修改这些并行代码、依赖或锁文件。最终日志：`/private/tmp/piwin-study-space-command-typecheck-final.log`。

独立源码与主仓生产代码及修改测试逐字节一致。独立源码验证复用了主仓已兼容的 Pi 0.84.2/Typebox/TypeScript/Vitest/tsx 工具环境；单独 offline install 因缓存缺少 AWS 传递依赖版本失败，不把它当安装成功。临时工具链接在验证后移除，不进入源码或安装包。

## 交付状态

源码和 0.1.1 包已准备；未发布市场版本、未改写个人不可变 revision、未重启/替换用户正在运行的 Host/Desktop。当前个人安装仍是 0.1.0。新命令需更新扩展，用途说明需更新 Host/Desktop 后生效。
