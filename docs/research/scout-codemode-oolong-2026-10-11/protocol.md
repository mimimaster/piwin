# OOLONG × Scout × Codemode：预先固定协议

在用户授权“直接选题集测试”之后，选择公开 OOLONG-synth 的**无标签版**，保持只读，三题 × 两组 × 三次 = 最多 18 次主任务，失败不补跑。材料存在本地文件，自主工具访问，因此是 OOLONG 工具版改编，不与官方整套排行榜混称。

来源：[官方项目](https://github.com/abertsch72/oolong)、[官方数据](https://huggingface.co/datasets/oolongbench/oolong-synth)。数据 revision `f0d59eaf0febf130664cfceb710436c8e3216b2b`；评分参考代码 revision `0bb7eabe839218fee7fe8d007f41cfc2fd3ae24c` 的 `src/eval/eval_helpers.py`。选题基于不同数据集、长度和聚合形式，ID 在首次模型调用前固定，没有用模型表现挑题。

| 任务 | 官方 ID | 标称 context_len | 完整输入字节 | 题意 | 精确 oracle |
|---|---:|---:|---:|---|---|
| negation-32k | 415040019 | 32768 | 95843 | 683 条陈述中应标为 True 的数量 | 261 |
| agnews-64k | 316030027 | 65536 | 192445 | 687 条新闻中用户 91245 的最常见类别 | Business |
| yahoo-128k | 517050022 | 131072 | 280690 | 1676 条问答中的最少类别 | Family & Relationships |

官方 context_len 是数据集字段，不当成 Grok 实际 Token。完整 `context_window_text` 原样落盘；`context_window_text_with_labels`、gold、评分器和运行器不放入模型项目。素材 hash、源 Parquet hash、题意/元数据见 `dataset-provenance.json`。模型项目用同一固定 Piwin 代码 archive `5868a0de4af5afd3137d00b8142c6fc033d6d895` 加这三个输入；文件 0444，每次前后全文 fingerprint 校验。

- test-host `~/.piwin-test` 原生 xAI OAuth；每次复制凭据到独立临时 Host，真实配置/凭据不写入或刷新，首尾 hash 检查。实际 SDK 主模型 + RPC Scout，mock=false。
- 主模型 Grok 4.5/high；Scout Grok 4.5/low，UltraCode explorer readonly、fallback none，最多三个 Scout、并发两个。同一隔离阶段内两组配置只有 codemode.enabled 不同；A false、B true。普通 Scout/read/grep/bash 只读能力保持可用，B 不强制 Codemode。
- 每次新的 Host 根与会话。串行 ABABAB，各题分别三对，共 18 次。Pi 自动 retry/compaction 关闭；每个主任务上限 900000ms（15 分钟），超时计失败，不追加任务。
- 共同提示要求至少一个 Scout，工具/分工/纠错完全由真实模型选择；禁止修改文件、联网、有副作用命令和访问项目外答案/配置/凭据。最终 JSON 必须是 `{"answer":VALUE}`，数值题整数、类别题原英文字符串。
- 主要验收是精确相等，无模型裁判。另报官方数值部分得分 `0.75 ** abs(gold-prediction)`；类别题 0/1。部分得分不当作答对。
- 端到端耗时从 session/prompt 提交前到主 Run terminal，包含 Scout/工具等待、模型自行纠错；建 Host/下载数据/后处理不计。超时记录的原始 elapsedMs 仅测到 15 分钟截止检测，未包含随后取消/清理；其完整端到端耗时标未知，截止时间另列，不能据此比较平均速度。统计主模型和全部 Scout 的**每次实际生成**累计 Token，cacheRead 仅算一次，reasoning 是输出子集。
- 主模型 SSE usage + Host finalized ledger + Pi 原生 SDK/RPC assistant.usage 对账；完整记录子事件与原生用量后才清理。工具直接调用和 Codemode 内嵌调用分列，失败记录；模型 retry 事件记录，无法可靠区分的自主工具重试与供应商内部重试标未知。xAI 未报告的 cacheWrite 标未知，无金额、无压缩率冒充 Token。
- 若发生生成/授权系统性失败，保留实际尝试并停止；不使用 mock、预先写好的模型答案或额外试跑。n=3 只能描述当前题目，不能证明一般正确率非劣效。交替从 A 起始，供应商缓存/负载仍是限制。

## 复现

在附加的独立 worktree 中，已有 Node >=22.19、pnpm 9 和锁定依赖；Python Parquet 读取器放在临时环境，不改项目依赖：

```bash
python3 -m venv /tmp/piwin-oolong-reader
/tmp/piwin-oolong-reader/bin/pip install --only-binary=:all: pyarrow
# 使用新的输出目录，不覆盖已有原始记录。
OUT_DIR="$(mktemp -d /tmp/piwin-oolong-ab-XXXXXX)"
/tmp/piwin-oolong-reader/bin/python scripts/research/scout-codemode/prepare-oolong.py "$OUT_DIR" /tmp/piwin-oolong-shards
node --test scripts/research/scout-codemode/tasks.test.mjs scripts/research/scout-codemode/readonly-shell.test.mjs scripts/research/scout-codemode/network-isolation.test.mjs
node --import tsx --test scripts/research/scout-codemode/network-permission.test.mjs
PIWIN_EXPERIMENT_OUTPUT_DIR="$OUT_DIR" pnpm exec tsx scripts/research/scout-codemode/run.mjs --oauth --oolong
node scripts/research/scout-codemode/summarize-oauth.mjs "$OUT_DIR"
```

素材准备和 `--prepare-only` 不调用模型，不计为性能实验。源 OAuth 必须已有效；不得为实验修改真实配置或刷新原凭据。

## 实际偏离与隔离阶段

最初的隔离实现有缺陷，不能隐藏或将中断当成模型答错。四个中断均占用原有额度，不补跑，精确停止耗时与完整 Token 未知；只保存已完成请求的实测下界。

| 槽位 | 状态 | 处置 / 原因 |
|---:|---|---|
| 1 A1 | invalid-readonly-violation | Python 写了两个 /tmp 中间文件；发现后中止并清理。源快照未变。 |
| 4 B2 | invalid-network-violation | Scout 实际向 DuckDuckGo 搜索，返回 0 条；题目禁止联网，故中止。 |
| 5 A3 | invalid-isolation-audit | 网页域名通配拒绝测试失败，安全中断；未观察到网络工具请求。 |
| 6 B3 | invalid-permission-audit | auto 模式实验运行器未正常完成 Scout 启动，安全中断以免削弱工具；原因未定位为产品缺陷。 |

第 2 槽位起，两组 shell 子进程共用 macOS sandbox-exec：禁止全部文件写入和网络，只允许 /dev/null 写入；读文件、管道和内存计算实测可用。没有修改产品或真实系统设置。第 4 次前，脚本错误使用不存在的 web.searchEnabled 开关，未关闭网页工具。第 5 次尝试用显式网络拒绝规则；验证显示搜索规则有效，网页 * / ** 通配未匹配。第 6 次尝试 auto 加顶层审批拒绝，未通过实际 Scout 可用性检查。以上都是实验运行器偏离，不包装为性能证据。

第 7 槽位起使用最终统一隔离：恢复已实测可运行 Scout 的 bypass 模式，保留文件写入等拒绝规则和 shell 的 OS 保护；在**实验进程**导入 Host 前安装 fetch 限制，仅放行 api.x.ai 的 POST /v1/responses、POST /v1/chat/completions 普通模型请求，拒绝其他 HTTP 及供应商原生搜索/代码工具。模型请求参数原样转发，RPC 的 Host 工具请求在这个进程执行。真实外部 fetch 已验证在网络发送前拒绝；正常模型与 Scout 已实际执行。被此限制拒绝且未发出的辅助请求不算模型 Token，拒绝元数据保存在原始记录中。piwin_codemode 仍是正常 function 工具，可由模型自主选择。

首题仅 A2 和 B1 两个有效协议观察，且两者都未通过精确验收；完整 Token 缺失，不足以比较性能。新闻与问答各六次均采用最终相同隔离，仍保留每组 3 次。全部槽位的原始记录交付，四个中断排除有效均值，不隐藏任务超时、工具失败和用量缺口。

第三阶段启动保护发现源 auth.json 整体 hash 变化，但上一阶段临时副本与源 xAI 对象内容 hash 一致，access/refresh/expiry 未变。文件整体变化来源未知，不能声称源文件自始至终未变；实验代码没有直接写源认证文件。一次拒绝启动的清理移除了临时快照，已按相同 commit 和输入重建原路径并校验相同 fingerprint，未调用模型、不占任务额度。证据见 resume-environment-check.json；源文件整体和 xAI 凭据一致性分开报告。

本批次中断后仅恢复未执行槽位：

```bash
pnpm exec tsx scripts/research/scout-codemode/run.mjs --oauth --oolong --resume-oolong
```

续跑只接受已记录的中断编号与连续原始文件，不允许覆盖或替补。新复现实验从第一槽位起采用最终隔离；源 OAuth 必须在预计运行期间有效，实验不主动刷新源凭据。
