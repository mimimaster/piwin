import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '../../../docs/research/scout-codemode-2026-10-11');
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
const names = (await readdir(root)).filter(name => /^\d{2}-.*\.json$/.test(name)).sort();
const rows = await Promise.all(names.map(async file => ({ file, ...JSON.parse(await readFile(join(root, file), 'utf8')) })));
if (rows.length !== 18 || rows.some(row => row.providerRequests.length !== 1 || row.providerRequests[0]?.status !== 426)) {
  throw new Error('This report describes the preserved 18 HTTP 426 attempts only; inspect new results and write a new report.');
}
const csvFields = ['ordinal', 'taskId', 'group', 'repetition', 'status', 'elapsedMs', 'mainTokens', 'scoutTokens',
  'promptTokens', 'completionTokens', 'cacheReadTokens', 'cacheWriteTokens', 'scoutCount', 'toolCalls', 'codemodeCalls',
  'toolFailures', 'modelRetryAttempts', 'toolRetryAttempts', 'upstreamInternalRetries', 'acceptance', 'httpStatus', 'sourceUnchanged', 'file'];
const csvRows = rows.map(row => [row.ordinal, row.taskId, row.group, row.repetition, row.status, row.elapsedMs,
  '未知', '未知（未运行）', '未知', '未知', '未知', '未知', row.scoutCount, row.toolCalls, row.codemodeCalls,
  row.toolFailures, row.modelRetryAttempts, '未知', '未知', '不可验收（无答案）', 426, row.sourceUnchanged, row.file].join(','));
await writeFile(join(root, 'runs.csv'), csvFields.join(',') + '\n' + csvRows.join('\n') + '\n');
const table = rows.map(row => `| ${row.ordinal} | ${row.taskId} | ${row.group}${row.repetition} | ${row.elapsedMs} | 426 / 失败 | 未知 | 0 / 0 / 0 | 0 / 0 / 0 | 不可验收 | [JSON](${row.file}) |`).join('\n');
const inventory = manifest.expected['cross-file'];
const data = manifest.expected['structured-data'];
const report = `# Scout 已可用时，Codemode 的增量收益：阻塞报告

2026-10-11，独立 worktree。**有效性能样本为 0；无法判断节省 Token、提速或正确率变化。**

尝试了全部预定的 18 次主任务（3 题 × 2 组 × 3 次），每次新会话。全部真实上游请求均被 HTTP 426 拒绝，没有产生模型答案、Scout 或 Codemode 调用。未补跑，未用 mock 替代。

上游错误要求从其报告的 Grok CLI 0.2.93 更新到 1.0.13 或更高版本。该版本号来自错误响应；本次未独立验证是哪一个上游组件设置它，也未更新本机客户端或通道。模型列表接口成功不代表生成接口可用。Grok 4.6 在列表中，但本次未额外试用，因此不声称它也不可用。

## 固定配置与任务

代码快照提交：\`${manifest.commit}\`；snapshot SHA-256：\`${manifest.snapshotHash}\`。

A：Codemode=false；B：true；主模型 Grok 4.5/high，Scout Grok 4.5/low；两组同一 Ultra Code readonly explorer 编排。使用生产配置中的本机 custom-openai 通道作为只读凭据来源，通过隔离 SDK Host 执行；没有在现有 host/test-host 中修改配置或创建实验会话。凭据只在内存/临时进程环境中使用，报告不包含密钥。任务保留正常 Scout 和只读 grep/read/bash；不强迫 B 使用 Codemode。

1. **代码定位/调用链**：普通 read_file 从 SessionHostToolExecutionPort 到实际 readFile 的 5 个阶段、实际源码行号、4 个身份字段，及 readOnly/fileEffect/encoding。验收锚点和行范围见 manifest.expected.call-chain；检查语义及源码范围。
2. **跨文件统计**：media/project/mcp 生产 .ts 中静态 from '@piwin/contracts' 文件清单。正确计数分别为 ${inventory.packages.map(row => row.count).join(' / ')}，合计 ${inventory.total}；完整升序清单见 manifest，排除 test/spec/fixtures，排除动态 import 和子路径。
3. **结构化数据**：确定性本地只读 orders.json，4096 行、${manifest.fixtureBytes} 字节；两组都可直接读文件或用 Python/Node/jq 等正常只读命令。正确筛选数 ${data.matchedCount}，Top 5 按 netCents 降序、sku 升序。固定提示、schema、fixture hash、精确答案见 manifest。

预先固定的题内顺序为 ABABAB / BABABA / ABABAB；跨题边界第 6→7 同为 B、第 12→13 同为 A。这是题内交替与起始组平衡，并非全程严格 AB 交替；应在未来有效实验中改为全程严格交替。本次无有效样本，不能据此推断顺序影响。

## 逐次原始指标

耗时从提交 session/prompt 前到主 Run terminal（包含冷激活）；它们是**请求被拒绝的端到端耗时，不是完成任务的性能**。主 Token 包括输入、输出、cache-read、cache-write，全部未知；没有用 0、字符数或估算补缺。Scout 没有运行，其用量也无观测记录。HTTP 请求数每次为 1。

工具/Scout/Code 为所有主模型+Scout 顶层工具调用数 / Scout 会话数 / Codemode 调用数；失败/重试/Code失败为工具失败 / Host 可观察模型重试尝试 / Codemode失败。每次 Run 本身失败 1 次。工具内部重试、通道内部重试未知。没有数据压缩率或金额指标。

| 次序 | 任务 | 组/次 | 耗时 ms | 请求/Run | Token | 工具/Scout/Code | 失败/重试/Code失败 | 客观验收 | 原始记录 |
|---:|---|---|---:|---|---|---|---|---|---|
${table}

JSON 保存真实模型请求的 model/effort/工具名、HTTP 状态、Host 事件、usage ledger、失败原因和校验哈希，不保存请求正文、授权头或完整网络载荷。[CSV 汇总](runs.csv) 将缺失项明确写为“未知”。空 usageLedger 和 observedUsage=null 表示缺失记录，不能视为零 Token。raw validation.passed=false 是“没有可解析答案”，不表示模型生成了错误答案。

## 对照结论

- **代码探索，Scout 之外有收益吗？** 未知。两道代码题均没有有效 A/B 样本，也没有实际 Scout 或 Codemode，无法衡量其增量收益。
- **结构化数据处理有收益吗？** 未知。虽有 0.93 MB 的固定只读数据和精确答案，但所有生成请求失败；没有真实 Token/耗时对照。
- **收益是否伴随错误率上升？** 未知。18/18 是接入失败，不是任务答案错误。没有可验收答案，不能计算回答正确率，更不能声称“不降低正确率”。

不提供性能均值/中位数或节省百分比：对 HTTP 拒绝时间做这些统计会制造性能结论。也不能据此断言“没有收益”；这里只能断言**这次实验未能验证收益**。

## 复现与检查

[固定协议与命令](protocol.md)，[完整 manifest](manifest.json)。在新 worktree 保留同一提交及现有通道配置：

\`\`\`sh
pnpm install --frozen-lockfile
node --test scripts/research/scout-codemode/tasks.test.mjs
pnpm exec tsx scripts/research/scout-codemode/run.mjs --prepare-only
pnpm exec tsx scripts/research/scout-codemode/run.mjs
node scripts/research/scout-codemode/summarize.mjs
\`\`\`

已有 raw JSON 时 runner 拒绝覆盖和追加；本次不继续调用模型。summarize 仅针对当前保存的 18 个 426 结果生成此阻塞报告，新有效实验应写新的结论。

检查结果：18 个唯一主 sessionId；18 次 snapshot 校验全部一致；每题 promptHash 唯一；移除 enabled 后 configHash 全部相同；A 的全部 9 个请求不含 piwin_codemode，B 的全部 9 个请求包含它；请求实际 model=grok-4.5、reasoning_effort=high。Scout low 是冻结配置，未获实际运行验证。provider usage 和 Host finalized usage 均无记录。

脚本验收器的 5 个单元测试通过；pnpm typecheck 全工作区通过（仓库命令排除 mobile）；包边界检查通过。仅增加研究脚本/报告，未修改产品源码、主工作区、真实配置、凭据或默认行为。脚本检查通过不构成模型性能证据。

后续需先修复或选择可生成的真实模型通道，再单独授权新的最多 18 次实验；不计作本次补跑。当前结果保持“阻塞”，不宣称完成有效性能对照。
`;
await writeFile(join(root, 'report.md'), report);
console.log(`Preserved ${rows.length} raw attempts; wrote runs.csv and report.md. No model requests.`);
