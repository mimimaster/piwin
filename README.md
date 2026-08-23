# piwin

还在开发中。

第一版只保证 **Mac 综合包**（Host + 桌面壳）能用。Windows、iOS、安卓后面再做。移动壳现在不打包。

## 现在能做什么

下载 GitHub Release 里的 `.dmg`，拖到「应用程序」，再打开。

这个包没有 Apple 公证。第一次打开如果系统提示「无法验证开发者」，到「系统设置 → 隐私与安全性」选「仍要打开」。

## 运行环境

- macOS
- 不需要自己装 Node、pnpm、Rust
- 配置目录：`~/.piwin`

## 从源码跑（可选）

给要改代码的人。日常使用请直接装 DMG。

```bash
pnpm install
pnpm package:desktop
```

打出来的 DMG 在 `apps/desktop/src-tauri/target/release/bundle/dmg/`。

## 说明

项目还不稳定，接口和界面都可能变。有问题开 Issue。
