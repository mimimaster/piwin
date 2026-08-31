# piwin Live 稳定性修订与验证

日期：2026-08-31。本文补充 ADR 0065、渠道规格和语言模型分层规格；下列行为优先于旧文中冲突的描述。

## 根因与证据

1. 用户截图的 HTTP 400 是 AVAS 拒收 `session.intelligence`，不是 SQLite 警告，也不能据此判定账户没有 Voice 资格。
2. 本轮开始前工作区已有关闭该字段的改动，但本机 Host PID 57401 仍运行 11:54 启动的旧代码。本轮保留这些改动并补充兼容/回归验证。
3. 静态示例 SDP 探测收到 `Invalid SDP offer`，**不是连接成功证据**。
4. 使用本机已有参考 helper 的 `start_v3_bridge` 生成有效 offer，由当前 `CodexLiveAdapter` 创建：**HTTP 201 → 原生 WebRTC connected → closed**。没有打开麦克风，没有采集/保存录音，没有执行 Agent 任务。
5. 确认 Host `activeSessionCount=0` 且无 Live call 后，正常终止旧进程并启动当前源码；旧 Desktop 自动重新连接。

公开 [OpenAI Create call](https://developers.openai.com/api/reference/typescript/resources/realtime/subresources/calls/methods/create) 描述的是 Platform `/realtime/calls`。Codex AVAS 是不同的非公开接口；本修复以当前失败和实际建连证据为准，不把公开参数套进私有请求。

## 落地行为

### 配置和凭据

- Codex call-create 不发送 intelligence，schema 不展示该选项。
- 读取旧配置时忽略已撤下的字段；旧 `alloy` 等不支持的持久化音色归一为 `cove`。不主动覆盖用户配置文件。
- 设置页新提交仍严格校验：错误音色、未知字段不得静默保存。
- 同一 owner、同一 key、同一 session/provider 才允许重放 start response；跨 owner 同 key 返回 busy，不泄漏 owner bootstrap。重放不消耗新建频率预算。
- 新建 call 必须匹配当前 settingsRevision，callId 使用随机 UUID，防止同毫秒重试复用标识。

### 生命周期

- Desktop/Mobile 必须同时满足 peer connected 和 data channel open，才认定媒体已就绪；共享便携式就绪 gate，15 秒超时可恢复失败。
- 挂断/取消终止创建过程；即使 provider 晚返回成功，也关闭并清除旧槽。
- 释放槽的 null 更新先于异步 close；迟到的 close 不得把新通话清空。owner action 按 callId 过滤。
- 等待麦克风授权时取消无需等待系统弹窗结束；之后才授权的音轨会被停止，不重新创建 peer。
- Host 清理失败只记录去敏阶段信息，不再静默吞掉。
- 挂断仍不取消已接纳的工作 Run。结束操作保留 callId/owner 校验，但不因 activity 导致的过期 revision 阻止紧急挂断。

### 工作交接和回传

- Host 独占结果关联和回传。Desktop 不再把当前页面的最后一条助理气泡猜作任务结果，也不同时注入 session/delegation 两份结果。
- 排队任务由真实 prompt admission 的 messageId/runId 补关联，不把下一条任意完成的 Run 绑定给队列。
- 同一个 Run 的多条 steer 合并完成，最终结果只回传一次，归到最近的委派。
- 结果先于 admission 回执到达时，临时保留有界去敏结果，待精确 Run 关联后再投递。不会提前口头确认接纳。
- 其它会话、子任务和通话结束后的结果不得播报。
- 会话仍保留 brief、工具、权限和完整工作正文；语音只拿短 takeaway。

### 界面

- 失败时释放媒体，但保留可见原因、重试和关闭，错误通过 alert 宣读。
- Live 控件使用 ui-kit IconButton，点击目标 44px；保留紧凑通话样式。
- 删除只会取消静音的假“允许执行”和假“打断”按钮。静音始终控制麦克风；权限回到会话确认；语音打断继续使用上游 barge-in。
- 已有通话时提示回到持麦设备处理，不承诺“再点一下就能抢占”。

## 验证结果

- contracts：62 文件 / 432 测试通过。
- voice：6 文件 / 27 测试通过。
- Host Live 专项、原生 SDK/RPC 本地测试通过；Host 全包 1914/1916 通过。全包中的 RPC 重试测试单独重跑通过；Plan 完成条件测试在本轮修改前即失败。
- Desktop Live 14 文件 / 60 测试通过；Mobile Live 4 文件 / 8 测试通过。
- contracts、voice、host-runtime 类型检查通过；包边界检查通过。
- 全仓类型检查尚不绿：host-client 闪卡测试的 exactOptionalPropertyTypes；Desktop composer-card 未使用的 triggerFollowUp；Mobile artifact 导出/props 等现有错误。本轮不修改这些无关工作。
- 浏览器实际检查：应用加载、连接中显示、取消后 Live 恢复可用。未批准浏览器麦克风授权。

## 未冒充完成的验收

原生 bridge connected 不等于 Tauri/手机上的真实双向音频和听感验收。请在设备上确认说话、播放、barge-in、静音、权限、工作回传；Limited Beta 的 50 次成功率与 100 次资源清理门禁仍未完成。Gemini / OpenAI-compatible 本轮做了自动化回归，没有做真实账户音频验收。
