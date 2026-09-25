# 在 piwin 中使用 Cloudflare MCP

Cloudflare 插件安装两个 MCP 服务：`plugin__cloudflare__docs` 用于搜索公开文档，`plugin__cloudflare__api` 用于访问你的 Cloudflare 账号。API 服务首次连接需要在浏览器完成 OAuth 授权；安装插件本身不会完成授权。

1. 打开「设置 → 扩展 → 插件」，安装 Cloudflare 插件。
2. 打开「设置 → 扩展 → MCP 工具」。展开 `plugin__cloudflare__api`，点「刷新工具」；也可点「配置…」再点「测试连接」。浏览器打开 Cloudflare 授权页后，登录并选择允许访问的账号和权限。保持 piwin 打开，直到服务显示「运行中」且列出工具。授权由 Cloudflare 和本机 `mcp-remote` 保存，不需要把 API Token 填入插件配置。
3. `plugin__cloudflare__docs` 可单独启动，无需登录。它应列出 `search_cloudflare_documentation` 和 `migrate_pages_to_workers_guide`。
4. 在对话中说明要做的 Cloudflare 任务。未 Pin 的 MCP 工具由 `piwin_toolbox` 按需搜索、描述和调用；需要模型直接看到某个工具时，可在 MCP 工具页 Pin 该工具。API 服务授权的权限范围决定哪些账号操作可执行。

若 API 服务一直显示启动中或报错，先看卡在授权页还是连接阶段。授权窗口关闭或超过等待时间后，重新点「刷新工具」或「测试连接」会发起新流程。`~/.piwin/mcp.json` 中 API 服务使用 `mcp-remote` 连接 `https://mcp.cloudflare.com/mcp`；`--protocol auto` 兼容 Cloudflare 的新旧 MCP 协议，`--auth-timeout 90` 给浏览器授权 90 秒。`--static-oauth-client-metadata '{"scope":"user:read"}'` 避免代理默认请求 Cloudflare 不认识的 `openid email profile`；登录页仍可自行选择具体权限。piwin 的连接等待比代理的授权等待略长。不要把访问令牌或完整授权链接贴进问题反馈。

参考：[Cloudflare MCP 服务目录](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/)和 [mcp-remote 使用说明](https://github.com/punkpeye/mcp-remote#readme)。
