# M3/M4 开源对照速查

| 能力 | 推荐依赖/来源 | 自研部分 | 不要做 |
|------|---------------|----------|--------|
| HTML→正文 | `@mozilla/readability` + `linkedom` | 超时/大小/协议限制 | 自写抽取器 |
| 网页搜索 | Brave/Tavily HTTP API | `SearchProvider` 接口、配置、权限 | 自建索引 |
| 无 key 搜索 | 社区 DDG HTML MCP **仅作可选** | 明确 unstable | 当默认 |
| 图片落盘 | Node fs + UUID | path 安全、mime、注入格式 | 上对象存储 |
| 图片尺寸 | 可选 `image-size` | — | 强依赖 sharp |
| MCP 协议 | `@modelcontextprotocol/sdk` | mcp.json、生命周期、桥到 Pi | 自写 JSON-RPC |
| MCP 配置 UX | Cursor JSON shape | 表单+Raw JSON | 闭源 UI |
| Skills 格式 | Agent Skills + Pi loader | 安装目录、面板、bundled | fork Pi loader |
| Skill 内容 | anthropics/skills 等（看 license） | 默认最小集 | 洗整个市场站 |
| 市场 | git/local install | InstallSource | 自建 registry |

## 参考链接

- Readability: https://github.com/mozilla/readability  
- MCP TS SDK: https://github.com/modelcontextprotocol/typescript-sdk  
- Agent Skills: https://agentskills.io  
- Anthropic skills 示例: https://github.com/anthropics/skills  
- Pi: https://pi.dev/docs/latest/skills  
- Claude web tools 设计讨论（只借拆分思路）: 社区逆向文 / Anthropic web fetch 文档  
