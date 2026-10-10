# 桌面端发布流程

一条命令发布 macOS（已公证 DMG）和 Windows（NSIS）安装包。打包本身的细节
（Host sidecar、签名、DMG 兜底）见 [`../release-desktop.md`](../release-desktop.md)。

## 日常用法

```bash
pnpm release:plan              # 只读：下一个版本号、就绪检查、更新日志草稿
# 把草稿改写成人话，写进 CHANGELOG.md 最上面
pnpm release:desktop           # 小更新：0.1.0 -> 0.1.1
pnpm release:desktop --formal  # 正式版：0.1.4 -> 0.2.0
```

| 选项 | 作用 |
|---|---|
| `--formal` | 发正式版（次版本号 +1，补丁号归零） |
| `--version X.Y.Z` | 指定版本号；也用于续跑一次中途失败的发布 |
| `--skip-windows` | Windows 构建机不可用时只发 macOS |
| `--github` | 小更新也把安装包传到 GitHub Release |
| `--rebuild` | 忽略已构建好的安装包，重新构建 |
| `--dry-run` | 构建 `origin/main`，不提交、不公证、不上传、不打 tag |

## 版本规则

- **git tag `vX.Y.Z` 是唯一的版本来源。** `tauri.conf.json` 在仓库里保持 `0.0.0`
  （开发构建一眼可辨），发布时在干净检出里临时写入版本号。
- **小更新**：补丁号 +1（`0.1.1`、`0.1.2`…），脚本自动算，不需要决定任何事。
- **正式版**：`X.Y.0`，由 `--formal` 触发。下载页带「正式版」标记，安装包同时存档到
  GitHub Release。
- 每个版本的安装包都在带版本号的固定地址，发布后不再覆盖：
  `https://dl.piwinwin.com/releases/<版本>/piwinwin_<版本>_aarch64.dmg`。

## 更新日志

`CHANGELOG.md` 是唯一手写的地方：

```markdown
## 0.1.1 — 2026-10-08
### 新增
- 下载页显示版本号和更新日志
### 修复
- 修复长会话滚动时偶发的空白
```

`pnpm release:plan` 会按上次发布以来的 `feat` / `perf` / `fix` 提交生成草稿；
`docs`、`refactor`、`test` 等用户看不到的提交不列出。没有对应版本的条目时
`release:desktop` 拒绝发布。

## 一次发布做了什么

1. 提交 `CHANGELOG.md`（只提交这一个文件）并 push `main`。
2. 两条线并行，都从**同一个提交的干净检出**构建——工作区里没提交的改动不会进安装包：
   - macOS：发布专用检出（默认是仓库旁的 `piwin-release`）→ `pnpm package:desktop`
     → 校验 → 公证 + staple → Gatekeeper 关卡（必须是 `Notarized Developer ID`）。
   - Windows：SSH 到构建机，`git reset --hard <提交>` → 打包 → 取回安装包。
3. 安装包和 `.sha256` 上传到 R2 的版本目录，核对线上文件大小。
4. 更新 `https://dl.piwinwin.com/releases.json`。下载页读这份清单，**文档站不需要重新
   构建或部署**。清单最后才写，所以下载页不会指向还没传完的文件。
5. 打 tag 并 push；正式版再创建 GitHub Release。

日志和产物在 `dist/release/<版本>/`。结尾会打印每一步的耗时。

某一步失败后直接重跑：已构建好的安装包（同一提交、同一版本）会复用，已上传且校验一致
的文件会跳过。如果失败发生在打 tag 之后，用 `--version X.Y.Z` 续跑同一个版本。

不需要等 CI：发布提交只改了 `CHANGELOG.md`。

## 本机配置

构建机地址、Apple 密钥编号等不进这个公开仓库，放在
`~/.piwin/skills/piwin-desktop-release/release.config.json`（可用
`PIWIN_RELEASE_CONFIG` 指到别处）：

```json
{
  "macCheckout": "/path/to/piwin-release",
  "packageTmpdir": "/path/with/space/tmp",
  "apple": { "signingIdentity": "Developer ID Application: …", "apiKey": "…", "apiIssuer": "…" },
  "windows": { "ssh": "user@host", "dir": "D:\\Codes\\piwin" },
  "r2": { "bucket": "piwin-downloads", "publicBase": "https://dl.piwinwin.com", "rcloneRemote": "" }
}
```

### 一次性设置

**允许跨域读取清单。** 两处会读 `releases.json`：`docs.piwinwin.com` 的下载页，和桌面端
「设置 → 通用 → 版本」卡片（来源是 `tauri://localhost` / `http://tauri.localhost`）。
清单本来就是公开文件，所以给 R2 桶加一条允许任意来源只读的 CORS 规则。没加之前下载页
停留在内置的兜底链接、应用里只显示当前版本不提示更新，都不会报错。
`pnpm release:plan` 的就绪检查会显示是否生效。

```json
{
  "rules": [
    {
      "allowed": { "origins": ["*"], "methods": ["GET", "HEAD"] },
      "maxAgeSeconds": 3600
    }
  ]
}
```

```bash
npx wrangler@4 r2 bucket cors set piwin-downloads --file cors.json
```

**更快的上传（可选）。** 默认用 wrangler，单请求上传，单文件上限 300 MiB（DMG 目前约
281 MiB）。在 Cloudflare 创建一个 R2 API 令牌，用 `rclone config` 建一个 S3 类型的
remote，把名字填进 `r2.rcloneRemote`，上传就会改成分片并行且没有大小上限。

## 存量说明

- 引入本流程前的安装包发布在 `piwinwin_0.0.0_*` 这两个被反复覆盖的地址上，旧链接继续
  可用；下载页读不到清单时也回落到它们。
- R2 上的历史版本不会自动清理。
