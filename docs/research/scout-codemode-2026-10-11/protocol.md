# Scout 之外的 Codemode：预先固定的实验协议

2026-10-11。只做实验，不修改产品功能、默认配置或凭据。

- 快照：当前 HEAD，由 git archive 生成同一个隔离只读目录，文件 0444，运行前后校验 SHA-256。实验脚本、验收答案与结果不在模型项目目录内。
- A：codemode.enabled=false；B：true。其他配置相同。主模型 Grok 4.5/high，Scout Grok 4.5/low，通过现有本机 custom-openai 通道，隔离 SDK Host；Scout 使用产品原有 Ultra Code 编排和 readonly explorer profile。
- 三题各三对，合计最多 18 次主任务。每次新 Host 数据根、新会话；顺序第一题 ABABAB、第二题 BABABA、第三题 ABABAB。主模型每次只收到一次固定任务提示。要求至少一个 Scout，但不指定 Scout 的工具、分工或 B 使用 Codemode。
- 正常 Scout、grep/read、现有只读 shell 命令在两组均可用。禁止任务修改文件或执行有副作用的命令，权限 deny 文件写与常见有副作用命令。关闭外部 MCP、skills、extensions、自动报告，避免无关副作用；两组设置相同。
- 每题硬超时 300 秒；不补跑失败，不用脚本化模型回答。Pi 自动模型重试关闭；模型自行纠正工具错误计入完整任务。模型工具和调用序列自主产生。
- 任务和提示详见 manifest.json。代码题检查 5 个调用阶段、实际源码行号、4 个身份字段及 readOnly/fileEffect/encoding。跨文件题检查 media/project/mcp 生产 .ts 静态 from 导入文件名单和计数。数据题使用确定性 4096 行约 0.93 MB JSON，检查筛选、整数金额聚合和排序后的 Top 5。验收器不调用模型。
- 主要指标：从 session/prompt 提交前到主 Run terminal 的墙钟耗时；主模型和所有 Scout 的 provider-reported Token（包括缓存）；Host finalized usage 逐请求交叉检查；所有工具调用、Codemode 调用/失败、可观察的模型重试、正确率。缓存缺失、内部重试等不可测字段标未知。数据压缩率不替代 Token；不报金额。
- 用量观察器仅转发真实通道响应，采集 SSE 的 model/usage/HTTP 状态及模型所见工具名；不提供模型答案，不保存请求、凭据或完整网络载荷。Host 逐请求 ledger 和工具事件同时保存。SDK/RPC 已有实现直接复用，不修改产品源码。

复现（独立 worktree，已配置本机 custom-openai 的 Grok 通道）：

```sh
pnpm install --frozen-lockfile
node --test scripts/research/scout-codemode/tasks.test.mjs
pnpm exec tsx scripts/research/scout-codemode/run.mjs --prepare-only
pnpm exec tsx scripts/research/scout-codemode/run.mjs
```

源配置只读，默认 ~/.piwin，可用 PIWIN_EXPERIMENT_SOURCE_ROOT 指向 test-host。密钥仅在进程内读入及临时环境变量传给 Host，不写报告或配置。生成内容位于本目录。不要把新的独立实验覆盖到保留的原始数据上；应在新的工作树中复现。

判读：先列每次数据，再列每题两组中位数/均值与 3 对差异。只有实际触发 Codemode 且用量完整时才讨论性能差异。代码探索与结构化处理分别回答；6 或 18 个样本不能证明一般化优越性或等效正确率。测试通过仅说明验收通过。
