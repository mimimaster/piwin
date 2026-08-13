# main 最近 12 小时功能闭合度审查(2026-08-13)

> 审查范围: 2026-08-12 23:00 之后进入 main 的 8 个提交
> (fa0e3f7 checkpoint, 541bf34, 1f728c9, df4b7e8, 0f7f63f, 0f03faa, 6c7d927, ce56d46)。
> 方法: 6 个独立域并行只读审查(代码 + ADR/计划文档一致性核对),基线 `pnpm typecheck` + `pnpm test` 全绿。
> 结论分级: 闭合可用 / 有缺口 / 不闭合。

## 总览

| 域 | 覆盖提交/ADR | 结论 |
|---|---|---|
| 1. 桌面转录与 turn 渲染 | ce56d46, 6c7d927, 541bf34 + checkpoint(thinking 边界、causal 流、响应视口) | 主体闭合;541bf34 有功能缺口 |
| 2. 原生 Web 搜索路由 | 0f7f63f, 0f03faa + checkpoint(ADR 0043、delegation) | 主体闭合;两个新提交各有一条声称的修复未接通 |
| 3. Composer 媒体与草稿 | 1f728c9 + ADR 0045 | 核心链路闭合;Phase 0 失败附件 UX 未做 |
| 4. Host 惰性工具箱 | ADR 0044 | 闭合可用;仅 CLI 呈现降级未记录 |
| 5. 扩展激活与设置热应用 | df4b7e8 + ADR 0047/0048 + worker 密钥引导 | 热应用与密钥引导闭合;扩展激活 Phase A 有实质缺口 |
| 6. Subagent 投影与事件流 | ADR 0046 + causal/compaction/baseline/hardening | 4/5 闭合;子会话窗口投影有实质缺口 |

## 高优先级缺口(按严重度)

### P0 — 功能性断裂

1. **搜索: 主会话 blueprint 未传 `nativeSearchAdapter`**
   `packages/host-runtime/src/blueprint-compiler.ts` 常规会话 `compileToolPolicy`(约 563 行)仍只按协议解析,0f03faa 只改了 side-chat 分支。声明 `vendor-specific` 的模型在 `native-first`/`native-only` 策略下: native 被误判 ready → 外部 `web_search` 被移除 → wrapper 不注入任何字段 → **该次生成两个搜索出口全部丢失**,且 capability brief 还告诉模型"native 搜索已启用"。无测试覆盖。

2. **搜索: providers 域删除 delegate 不触发即时限制**
   `settings-service.ts` `findImmediateRestrictions` 只在 `web` 域 mutation 时计算 web-search 限制;删除/禁用 delegate 模型是 `providers` 域 mutation,走 default 返回空。0f7f63f 提交信息声称的主场景实际不生效;新测试用跨域构造输入掩盖了真实路径。

3. **扩展: "durable deployment" 名不副实(df4b7e8)**
   后台 continuation 是纯内存 Promise;启动时无任何代码扫描部署目录(`extension-revision-store.ts` 的 `listDeployments()` 全仓零调用)。Host 在 waiting-current-run 期间重启后: 同 deploymentId 重试命中 in-flight re-ACK 分支,**永远返回 waiting,部署记录永久卡死**。另外 `extension/deployment-updated` push 在 apps/ 下无任何消费者——后台激活失败对用户完全静默(Desktop 在 quick-ACK 后即显示成功文案)。

4. **桌面: `transcriptOwnerSessionId` 状态机只写了一半(541bf34)**
   owner 仅在 4 处维护;`scope/set`、`project/set`、`project/clear`、`session/delete`(删除激活会话)四条路径清空 `activeSessionId`/`messages` 但**不清 owner**。后果: 切 scope/项目后直接从侧栏 Duplicate 会被守卫误拦,报错文案误导("Transcript is still loading"),直到点开任一会话才自愈。守卫本身无测试(`use-session-actions.ts` 无测试文件)。

5. **Subagent: 子会话窗口 live 投影仍是计划明令废弃的扁平尾部**
   `SubagentStreamState` 在 `message/start` 清空 text/thinking 而 tools 跨消息累积;历史刷新每次选择只执行一次(`use-subagent-session-inspector.ts` `terminalRefreshedForRef`)。子会话产生 ≥3 条 assistant 消息时**窗口打开期间中间消息内容丢失**。与计划 §7.1"Implemented"自述不符,无多消息测试。

### P1 — 安全/产品闭环

6. **扩展: 远程激活缺 default-deny(ADR 0047 §12 未实现)**
   `host-server.ts` 把 `extensions/set_enabled`、`extensions/apply` 加入远程白名单,仅做形状校验;contracts `RemoteCommandPolicy.allowExtensionInstall` 全仓零实施调用方。远程激活(= Host 代码执行)当前是 default-allow。

7. **Composer: 计划第一优先级 Phase 0 未落地且文档未交代**
   失败附件仍禁用整个发送按钮(违反 ADR 0045 Decision 4);错误层覆盖缩略图、原因仅 hover 可见、文案硬编码英文;`AttachmentFailureCode` 等 contracts 类型未实现。计划 §11 定为"第一优先级、独立提交先落地",实施顺序相反。

### P2 — 边缘与负债

- 搜索: `nativeSearchAdapter` 零文档(ADR 0043 未更新)、无 Desktop/CLI 入口、非法值静默 fail-closed;Desktop delegate 下拉未滤 adapter 可表达性。
- 搜索: `hasUsableWebSearch` 的 `native-only`/`external-only` 分支语义与 route resolver 不一致(delegate 就绪被当作 native source;delegate 失效但普通源启用时漏报限制);warning 级 issue 无消费者。
- Composer: save 成功但弃发后媒体文件/空 session 残留无回收且未记录;发送在途切会话,失败恢复会把 A 会话内容写进 B 会话 composer;deferred 分支 session 创建失败时草稿侧栏行不恢复。
- 扩展: `ctx.reload()` 受管模式拦截未实现(错误码只存在于文档);loaded/effective/restart-required 状态 Desktop/CLI 均不渲染(Phase A 验收项 8/9);首次执行风险确认页未做;legacy-unmanaged `set_enabled` 仍直写 config.json 与 ADR §5 措辞不符;ADR 0047 仍为 Proposed 而实现先行。
- Subagent: 窗口历史无分页/游标 replay;预分配失败块不可点击(计划 §7.2);`chat-reducer` `refreshActiveSessionMetadata` 在流式高频路径做全列表扫描(性能,无正确性问题)。
- 设置热应用: RPC 模式等价集成验证未做(计划 §8.2);忙碌会话 drain→swap 无完整端到端自动化。
- CLI 降级未记录 ×3(违反 AGENTS.md §5 反模式条目): 工具箱路由名(CLI 显示 `[tool:piwin_toolbox]`)、subagent 推送(CLI 忽略 `subagent/invocation-updated`/`subagent/stream`)、需在 ADR 0044/0046 补一句降级说明。
- 文档矛盾: `docs/specs/agent-activity-presentation-design.md` §4.6/§6/§7 仍规定 preparing sheen 与 Run 摘要,与已落地的反转/causal 流直接相反,无 superseded 标注;08-10 计划正文步骤 2-3 同样未标记取代。
- 测试缺口(轻): srcdoc late-media `load` 重测无行为测试;history-ticks 跨帧重试路径无测试;`findReadyWebSearchDelegate` 不检查 chat capability(执行侧 fail-closed 兜底)。

## 闭合可用、证据扎实的部分(抽样确认)

- turn 级因果渲染 + Artifact preparing 反转: 与 08-13 follow-up 逐条吻合,测试齐全。
- thinking 时长边界: contracts → SQLite → 双 recorder → Desktop 全链路 + 4 类测试。
- delegation 模型委派搜索: 端到端(contracts → config → tools-web 独占分支 → agent-host 真实 Pi stream),SDK/RPC 双模式一致,三层测试。
- 会话操作锁加固: owner token + 年龄阈值 + 原子获取,真并发测试。
- 惰性工具箱(ADR 0044): 注册→编译冻结→双路径激活→安全执行闭环,五条验收全部有代码与测试对应,agent-host 边界干净。
- 设置热应用(ADR 0048): 方向感知分类器、generation-ID CAS、失败保留旧代、Desktop Retry,集成测试(SDK 模式)在。
- worker provider 密钥引导: 双模式接通,fd-3 引导,canary 测试断言密钥不泄漏到 stderr/JSONL,未发现缺口。
- compaction 零超时哨兵: Desktop/CLI/Rust 桥三层 + 回归测试。
- Composer 核心链路: queued chip → Send 落盘 `~/.piwin/media` → 原生 ImageContent 进 Pi(规则 6 满足),草稿三层隔离 7 用例。
- 架构合规: apps/ 无 Pi 导入;UI 只消费规范化事件;媒体路径约束满足。

## 建议修复顺序

1. blueprint-compiler 主会话传 `nativeSearchAdapter` + providers 域即时限制分类(两个都是"已声称修复"的收尾,小 diff)。
2. 扩展部署启动恢复: 启动扫描 in-flight 部署(标记 failed 或恢复)+ 同 id re-ACK 区分"有无在飞 Promise" + Desktop 消费 `extension/deployment-updated`。
3. `transcriptOwnerSessionId` 补 4 条清空路径 + 守卫测试。
4. 子会话窗口按 messageId 的多消息投影 + 多消息用例。
5. host-server 对 `extensions/apply`/`set_enabled` 加默认拒绝远程策略。
6. Composer Phase 0 独立提交。
7. 文档批次: spec superseded 标注、ADR 0043 适配器段、CLI 降级记录 ×3、ADR 0045 孤儿负债记录。

## 修复记录（2026-08-13，同日跟进）

上述 1-7 已全部落地（TDD：每项先加失败用例再实现）：

1. `blueprint-compiler.ts` 主会话路径改传 `model.nativeSearchAdapter`；
   `settings-service.ts` 增加 `providers` 域即时限制分类，并把
   `hasUsableWebSearch` 语义修正为"外部 `web_search` 后端可用"（`native-only`
   下恒 false、delegate 配置后以 delegate 就绪为准）。
2. `host-runtime.ts` 启动恢复：扫描上个进程遗留的 in-flight 部署记录并终态化为
   `active`；`extensions/apply` re-ACK 增加"本进程在飞 Promise 所有权"判定；
   Desktop `use-host-bootstrap.ts` 消费 `extension/deployment-updated`，
   `rolled-back` / `restart-required` 终态转为错误通知。
3. `chat-reducer.ts` 为 `scope/set`、`project/set`、`project/clear`、
   `session/remove`(删除激活会话) 四条路径补 `transcriptOwnerSessionId = null`，
   守卫测试覆盖。
4. `SubagentStreamState` 引入 `completedSegments` 多消息分段投影；工具事件按
   `responseMessageId`/`toolCallId` 归属到对应分段；投影、transcript、
   inspector 增量刷新与多消息用例齐备。
5. `HostServer` 默认拒绝远程 `extensions/set_enabled`/`extensions/apply`
   (`extensions/list` 保留)；`allowRemoteExtensionActivation` 显式 opt-in，
   `apps/host` 暴露 `PIWIN_HOST_ALLOW_EXTENSION_ACTIVATION=1`；ADR 0047 §12
   补实现说明并转为 Accepted。
6. Composer Phase 0：失败附件不再禁用发送；缩略图无覆盖层，失败原因与
   重试/移除动作移到 chip 外侧失败行；发送时"重试并发送 / 仅发送其余内容 /
   返回"三选确认；仅失败附件时主按钮变"重试附件"；错误按
   `policy`/`connection`/`local` 分类展示；中英文 localization；hook 发送入口
   增加"失败附件永不静默丢弃"守卫。孤儿媒体/在途切会话恢复串会话/草稿行不恢复
   三项负债记入 ADR 0045。
7. 文档批次：activity spec §4.6/§6/§7 superseded 标注、08-10 计划步骤 2-4
   取代/回退标注、ADR 0043 `nativeSearchAdapter` 适配器段(含已知限制)、
   ADR 0044/0046 CLI 降级记录、ADR 0045 Phase 0 落地说明与已知负债、
   composer 计划 Phase 0 落地横幅。

仍开放（P2，未在本轮处理）：扩展 `ctx.reload()` 拦截、loaded/effective 状态
渲染、首次执行风险确认页；子会话窗口历史分页；`refreshActiveSessionMetadata`
性能；RPC 模式热应用等价验证；srcdoc late-media 与 history-ticks 行为测试；
delegate 下拉按 adapter 可表达性过滤。
