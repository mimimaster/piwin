# 多端使用与运行指南

平时写代码，最舒服的方式莫过于直接在主力机上双击桌面包开箱使用。如果你有一台性能强劲的台式机或常开的软路由/NAS，也可以将它作为常驻后台，出门在外用笔记本或平板随时连回继续工作。

本文档为你介绍桌面一体包安装、远程访问与二次开发指引。

---

## 1. 客户端形式一览

| 客户端形式 | 适用场景 | 亮点体验 |
| :--- | :--- | :--- |
| **macOS 一体包** | Mac 笔记本 / 主力机 | 双击即跑，免配环境，Apple Silicon 极致流畅 |
| **Windows 一体包** | PC 台式机 / 笔记本 | 双击运行，开箱即用，自动拉起核心服务 |
| **Web 远程端** | 平板 / 任意浏览器 | 自适应宽屏布局，结合组网随时随地远程接续 |
| **iOS 移动端** | iPhone / 随身查看 | 出门在外随手查看长程任务执行进度与报错 |

---

## 2. 桌面一体包快速安装 (开箱即用)

> [!TIP]
> 现已开放专属 **[全平台客户端下载中心](/download)**，包含 macOS、Windows 最新安装包、系统版本限制明细与 iOS 移动伴侣研发动态。

对于绝大多数日常使用者，直接下载安装包是最舒服的选择：

1. 前往 **[全平台客户端下载中心](/download)** 或 **[GitHub Releases 页面](https://github.com/mimimaster/piwin/releases)**；
2. 下载对应系统的安装包：
   - macOS 用户：点击 **[下载 DMG 镜像](https://dl.piwinwin.com/piwinwin_0.0.0_aarch64.dmg)**（暂时只支持 M 系列芯片），双击拖入 Applications 文件夹；
   - Windows 用户：下载对应安装包或 zip 便携包解压即用。

---

## 3. 远程访问方案 (Tailscale + 家用台式机/NAS)

如果你想把计算跑在家里配置更高的台式机上，用轻薄本或者平板随时随地连回：

### 连接步骤
1. **免费组网**：在台式机和笔记本上同时安装并登录 [Tailscale](https://tailscale.com/)，加入同一网络；
2. **启动服务**：在台式机上直接启动 Piwin；
3. **远程输入**：在远端设备的浏览器或客户端中填入台式机的 Tailscale 内网 IP，即可丝滑接入，进度完全同步。

---

## 4. 开发者二次开发与本地构建

如果你需要自行定制功能或基于源码进行编译：

### 4.1 环境要求
- **Node.js**：`>= 22.0.0`
- **pnpm**：`>= 9.0.0`
- **Rust**：`>= 1.75.0` (用于编译 Tauri 2 桌面端)

### 4.2 常用开发指令
```bash
# 1. 克隆代码仓库
git clone https://github.com/mimimaster/piwin.git
cd piwin

# 2. 安装全部依赖
pnpm install

# 3. 运行全量类型检查与单元测试
pnpm typecheck
pnpm test

# 4. 启动桌面端开发调试模式
pnpm dev:desktop

# 5. 启动 CLI 命令行开发模式
pnpm dev:cli

# 6. 本地打包生成 macOS 完整安装包 (.dmg)
pnpm package:desktop
```

---

## 5. 关联文档

- [快速起步概览](./getting-started.md)
- [OAuth 登录与多账号体系](./oauth-login.md)
- [扩展、Skill 与 MCP 生态](./extensions.md)

