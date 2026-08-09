# 用量统计聚合重排与缓存归因

## 目标

把 Settings → 用量统计从“多 KPI + 热力图 + 趋势图 + 多张重复表”收敛为一个
可快速回答问题的页面：用了多少、缓存是否有效、哪个模型与 Key 的缓存率有问题。

## 信息架构

页面只保留三层：

1. 三个摘要块：总 Token、提示词缓存率、请求/会话活动。
2. 一张聚合趋势图：在同一根日柱中合并直接输入、缓存读取、缓存写入和输出。
3. 一张模型 × Key 表：展示缓存率、缓存读写、直接输入/输出、请求数和总量。

删除 GitHub 活跃热力图、输入/输出比例独立 KPI、Provider 独立表、Model 独立表，
以及根据模型名推算 tok/s、TTFT、成功率的性能表。未由 Host 记录的指标不得在 UI
中伪造。

## Key 归因与安全

- 当前配置模型中一个 provider 配置只绑定一个 credential source，因此
  `providerId` 是模型用量的安全 Key 维度。
- `UsageRecord` 记录 `providerId`，rollup 新增 `byModelKey`；同一 `modelId`
  在不同 provider 配置下必须分成不同的行。
- Desktop 显示 provider 配置 ID，并明确说明密钥已隐藏。
- 不读取、不持久化、不通过 HostResponse 返回 API key 值或其前后缀。
- 旧 ledger 没有 `providerId` 时归入“未知 Key / 历史记录”，不猜测归因。

## 缓存率口径

使用 Pi normalized usage 语义：

```text
缓存率 = cacheRead / (input + cacheRead + cacheWrite)
```

- `input` 是未命中的直接输入。
- `cacheWrite` 是本次写入缓存、尚未命中的提示词 Token。
- 输出 Token 不属于提示词缓存分母。
- 分母为 0 时显示未知（`—`），不显示伪造的 `0%`。
- 该公式由 `@piwin/contracts` 的纯函数统一提供，Desktop 与 CLI 复用。

## 实施范围

- `@piwin/contracts`：provider 归因、`UsageModelKeyTotal`、`byModelKey`、缓存率函数。
- `@piwin/session`：按 provider 配置 + model 聚合，保留旧 `byModel` 兼容面。
- `@piwin/host-runtime`：写 ledger 时带上当前 `ModelRef.providerId`。
- Desktop：减法式重排、改用 `@piwin/ui-kit` 控件、独立 usage stylesheet。
- CLI：使用同一缓存率口径并输出 model + Key 明细。

## 验证

- 同一模型、不同 provider 配置产生不同 `byModelKey` 行。
- 缓存率只使用提示词侧 Token，零分母返回未知。
- Desktop 只有一张趋势图和一张明细表；不存在热力图或推算性能表。
- Desktop 表可以按模型或 Key 筛选，并兼容没有 `byModelKey` 的旧 Host。
- 运行 contracts/session/desktop/CLI 相关测试、全仓 typecheck，并进行本地页面视觉检查。
