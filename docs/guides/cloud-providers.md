# Vertex AI / Amazon Bedrock 提供方

piwin 直接复用 Pi（`@earendil-works/pi-ai`）自带的 `google-vertex` 与
`bedrock-converse-stream` 传输：鉴权链、令牌刷新、流式解析、工具调用、图片、思考都由 Pi 负责，
piwin 只把 `~/.piwin/config.json` 里的项目 / 区域等字段传过去。

## Vertex AI（`protocol: "google-vertex"`）

```jsonc
{
  "id": "vertex",
  "protocol": "google-vertex",
  "name": "Vertex AI",
  "baseUrl": "",                    // 留空 = 官方端点
  "project": "my-gcp-project",      // 也作为 x-goog-user-project 发送
  "location": "global",             // 留空 = global；也可 us-central1 等
  // "credentialsFile": "~/sa.json", // 可选：服务账号 JSON
  "models": [{ "id": "gemini-2.5-pro", "input": ["text", "image"] }]
}
```

鉴权（按优先级）：
1. `apiKeyRef` / `apiKeyEnv`：Vertex API 密钥（express mode）。
2. 否则 Google ADC：`gcloud auth application-default login`、`credentialsFile`
   或 `GOOGLE_APPLICATION_CREDENTIALS`；令牌由 google-auth-library 自动刷新。

## Amazon Bedrock（`protocol: "amazon-bedrock"`）

```jsonc
{
  "id": "bedrock",
  "protocol": "amazon-bedrock",
  "name": "Amazon Bedrock",
  "baseUrl": "",              // 留空 = bedrock-runtime.<region>.amazonaws.com；可填 VPC / 代理端点
  "region": "us-east-1",      // 留空 = AWS_REGION / AWS_DEFAULT_REGION，再退回 us-east-1
  "profile": "my-sso-profile",// 可选：~/.aws/config 中的 profile（支持 SSO）
  "models": [{ "id": "us.anthropic.claude-sonnet-4-5-20250929-v1:0", "input": ["text", "image"] }]
}
```

鉴权：`apiKeyRef` / `apiKeyEnv` 填 Bedrock API 密钥（Bearer，等同
`AWS_BEARER_TOKEN_BEDROCK`）；留空走 AWS 默认凭证链（环境变量、profile、SSO、ECS/IRSA/IMDS），SigV4 签名。
模型 ID 可以是基础模型、跨区推理 profile（`us.` / `eu.` 前缀）或 inference profile ARN。

## 说明

- 桌面端「添加提供商 → 云厂商」里有 Vertex AI / Amazon Bedrock 预设；
  「测试连接」会通过 Pi 真实发一次最小请求。
- 模型列表需要手动按 ID 添加（这两个平台的列表接口需要云鉴权，暂不自动拉取）。
- 会话自动命名等「结构化补全」和视觉委托走纯 HTTP，对这两类提供方不可用；主对话、子代理、工具调用均正常。
