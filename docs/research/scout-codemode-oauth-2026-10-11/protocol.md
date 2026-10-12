# Scout × Codemode：原生 OAuth 小样本实验

用户要求使用 OAuth 后，原 CPA 通道的 HTTP 426 阻塞批次保留在相邻目录；本批独立编号、最多 18 次，不补跑失败。

- 使用 **test-host 的配置来源 `~/.piwin-test`**，在独立 worktree 运行公共 `HostRuntime` SDK；Scout 使用现有 RPC worker。没有向正在运行的生产 Host/test-host 注入实验会话。
- 从 test-host 读取原生 xAI OAuth，复制到每次新建的临时 Host 根，权限 0600；源凭据从不写入或刷新。每次配置、MCP、会话、usage 都隔离。实际生成端点为 `https://api.x.ai/v1/responses`，没有经 CPA 转发。Grok CLI 检测版本 1.0.50。
- 主模型 Grok 4.5 / high，Scout Grok 4.5 / low，UltraCode 的 explorer/readonly，fallback none；两组配置唯一差异为 `codemode.enabled`。未使用 Grok 4.6，避免它在本机原生目录中的不同 API/推理支持引入第二个变量。
- A false、B true；全程串行 ABABAB、ABABAB、ABABAB。每次新会话、固定提示词、新临时 Host。两组允许正常 Scout、read/grep/bash 只读命令；共同提示要求至少一个 Scout，自主决定分工、命令与工具，B 不强制 Codemode。
- 被探索的代码固定为 `5868a0de4af5afd3137d00b8142c6fc033d6d895` 的 git archive。所有文件 0444；主任务禁止写文件/配置、联网或有副作用的命令。每次前后 SHA256 校验全部文件内容。夹具是 4096 行、929260 字节的固定本地 JSON，两组读取能力相同。
- 每题每组 3 次；主任务硬截止 300 秒；Pi 自动模型重试关闭。模型自主纠错、重复工具调用包含在总用量/耗时中，不补跑。
- 耗时是提交 session/prompt 前至主 Run terminal，包含主模型、Scout 等待和工具；排除建 Host、制作夹具和采集后的整理。Token 是整个任务内每次生成实际报告的累计输入/输出/缓存，不是最后上下文大小或夹具压缩率。reasoning 是 output 子集，不再加到 total。

## 固定任务与验收

完整原始中文提示与完整预先生成的 oracle 位于 `manifest.json`，实现位于 `scripts/research/scout-codemode/tasks.mjs`。

1. **调用链**：追踪普通 read_file 的 port/router/prepare/admission/executor；校验五个源文件、函数符号和函数行号范围，四个身份字段 sessionId/runtimeGenerationId/runId/toolName，以及 readOnly=true、fileEffect=none、UTF-8。范围事先固定；空白行不通过。
2. **跨文件统计**：media/project/mcp 的生产 .ts 静态 `from '@piwin/contracts'`，排除 test/spec/fixtures、动态 import 和子路径，逐文件去重；要求完整有序文件列表和计数分别 8/2/10，总数 20。列表也必须精确匹配。
3. **结构化数据**：paid、CNY、cn-east/cn-north、grossCents>=1000；SKU 聚合后净额降序/SKU 升序取五。795 行符合条件；top 为 sku-08(137,620,1944201)、sku-01(151,734,1889499)、sku-12(145,684,1845825)、sku-05(123,661,1621847)、sku-04(119,593,1501863)，括号依次 count/quantity/netCents。

## 采集来源与限制

- 主模型：被动读取真实 Responses SSE 的 usage/HTTP 元数据，与现有 Host finalized usage ledger 交叉核对。观察器不改变请求、工具或回答，不保存 Authorization、凭据或请求正文。
- Scout：Pi 原生 RPC 会话 JSONL 的 assistant.usage，保留逐请求原始归一化用量与工具证据；与主模型 SSE 一致的原生文件识别主模型，其余由 sessions-index 证实为 Scout 后汇总。
- **执行中的旧采集回调漏掉 `subagent/stream`，RPC worker 的环境过滤也阻止了 fetch 预载入。第 6 次开始，用外部只读观察器在清理前保存原生会话证据；没有重跑。第 1–5 次 Scout Token、全任务 Token、Scout 工具指标是未知。** 原始编号 JSON 保留当时采集值，里面 scoutCount=0/observedUsage 仅主模型，不能作为完整任务指标。`metrics.json` / `runs.csv` 是明确修正并带来源的指标。
- cacheRead 实测，输入区分未缓存；xAI 不报告 cacheWrite，Pi 的默认 0 不当成实测，统一未知。不报金额。只观察到主模型 retry 事件；全部 Scout/供应商内部重试、模型自行选择的工具重试次数不能可靠判定，未知。
- 当前修正脚本直接采集子事件并在清理前保存原生会话，修复测量器未改变产品、任务或本批执行中的进程。完整性以末次 stop 及主模型 SSE 对账为门槛；不完整记录不估算。
- n=3 只能描述本批；固定从 A 开始的交替顺序仍可能受供应商缓存/负载影响，采集器补采阶段也是局限。不能用测试通过替代性能证据，不能用启用组的差异证明实际使用 Codemode 的因果收益。

## 复现

在此分支的独立 worktree，Node >=22.19、pnpm 9，安装锁定依赖后执行：

```bash
pnpm install --frozen-lockfile
node --test scripts/research/scout-codemode/tasks.test.mjs
PIWIN_EXPERIMENT_OUTPUT_DIR="$(mktemp -d /tmp/piwin-oauth-ab-XXXXXX)" \
  pnpm exec tsx scripts/research/scout-codemode/run.mjs --oauth
# 将输出目录传入；汇总不会调用模型：
node scripts/research/scout-codemode/summarize-oauth.mjs /tmp/piwin-oauth-ab-XXXXXX
```

源 OAuth 必须已有至少 30 分钟有效期；脚本不会替用户登录或刷新真实凭据。可用 `PIWIN_EXPERIMENT_SOURCE_ROOT` 指定另一个本地 test-host 根，但这会成为不同实验环境。`--prepare-only` 仅生成协议、夹具/oracle并验证配置，不算模型实验，不证明性能。本批实际启动命令为 `pnpm exec tsx scripts/research/scout-codemode/run.mjs --oauth`，第 6 次开始另开 `node scripts/research/scout-codemode/recover-native.mjs` 被动补采；复现使用修正脚本不需要补采进程。
