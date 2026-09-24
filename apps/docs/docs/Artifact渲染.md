# Artifact 渲染与画布系统

本指南已升级至完整版文档：请查阅 [Artifact 实时渲染与画布系统](/docs/artifact-rendering)。

---

## 快速摘要

PIWIN 的 Artifact 渲染默认开启，使用**极其积极**。使用过程中如果你发现不好用，可以在设置中关闭：

![Artifact 设置入口](https://img.yorickjue.com/file/1789916523828_image.png)

### Inline Artifact
当前场景 inline artifact 实时渲染使用的十分积极，当模型判定密集信息更好 preview 的时候，会积极渲染，也可以自定义触发方式更改：
![Inline Artifact 渲染示例](https://img.yorickjue.com/file/1789916595270_image.png)

### Canvas 分屏画布
一些比较大的 artifact，模型会自动判定用 canvas 渲染，canvas 渲染更稳定，报告、调研会十分积极使用 canvas。这样设计也是因为比较容易一眼看懂，向左自动压掉对话区域，查看更方便：
![Canvas 示例 1](https://img.yorickjue.com/file/1789919214959_image.png)
![Canvas 示例 2](https://img.yorickjue.com/file/1789919257515_image.png)
