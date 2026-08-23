# piwin

还在开发中。

第一版只保证 **Mac 综合包**（Host + 桌面壳）。Windows、iOS、安卓后面再做。移动壳现在不打包。

## 怎么用

自己在本机打总包：

```bash
pnpm install
pnpm package:desktop
```

打出来的 DMG 在 `apps/desktop/src-tauri/target/release/bundle/dmg/`。拖到「应用程序」再打开。

目前没有现成的 GitHub Release 安装包。打出来的包一般也没有 Apple 公证。第一次打开如果系统提示「无法验证开发者」，到「系统设置 → 隐私与安全性」选「仍要打开」。

## 运行环境

- macOS（Apple Silicon）
- 需要本机有 Node / pnpm；打桌面包还要 Rust
- 配置目录：`~/.piwin`

## 说明

项目还不稳定，接口和界面都可能变。有问题开 Issue。
