# 安装 Pi 扩展：以 cc-safety-net 为例

| 字段 | 值 |
|------|----|
| 状态 | Living document |
| 相关 | [Pi Extensions in piwin](./pi-extensions.md)、[ADR 0060](../adr/0060-pi-native-package-follow.md) |
| 实测 | `cc-safety-net@2.4.11`，产品负责人 2026-09-27 在 Desktop 验证生效 |

## 这个扩展做什么

[`cc-safety-net`](https://www.npmjs.com/package/cc-safety-net) 在 Agent 执行
bash 前检查命令，拦截 `git reset --hard`、`rm -rf` 这类破坏性操作。它只用
`tool_call` 钩子，属于 piwin 支持的 Agent Runtime 能力，不依赖 Pi 终端界面。

## 安装

1. 打开 Desktop **市场**，搜索 `cc-safety-net`，点击安装。
2. 确认弹窗：扩展以 Host 用户的系统权限运行，只安装你信任的来源。

市场安装等同于 `pi install npm:cc-safety-net`：包写入 `~/.pi/agent`，
在 piwin 里显示为 `pi-native` 来源。已安装 Pi CLI 的用户也可以在终端执行该命令，
效果相同。

## 启用与生效

1. 打开 **设置 → 扩展**，点击**刷新**。
2. 确认 `cc-safety-net` 标记为「兼容」且开关已打开（兼容的 Pi 包默认启用）。
3. 新建会话即可使用；已有会话点击**应用到当前 Agent**，从下一轮开始生效。

## 验证

在一个临时空目录新建会话，让 Agent 执行：

```text
git init && git commit --allow-empty -m init && git reset --hard HEAD
```

bash 调用被阻止、原因中出现 `CC Safety Net`，即表示扩展已生效。若 piwin
先弹出自身的权限确认，允许后仍应被扩展拦截。

## 已知限制

- 扩展注册的 `/cc-safety-net` 命令不会出现在输入框的 `/` 菜单中。
- piwin 只加载 Agent Runtime 能力（工具、钩子、确认/选择/输入/通知）。
  以自定义终端界面为主的扩展会显示为「仅 Pi 终端」且不加载，
  详见 [Pi Extensions in piwin](./pi-extensions.md)。

## 卸载

在市场的已安装列表中移除，或在终端执行 `pi remove npm:cc-safety-net`，
然后回到设置 → 扩展点击刷新。
