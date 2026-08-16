# 如何管理与添加多层级 Markdown 文档

VitePress 原生支持**无限层级的父子文档嵌套**、**文件夹分类**以及**可折叠目录**。

本文将详细教你如何组织多层级文档结构。

---

## 1. 文件夹与文件结构推荐

你可以通过建立**子文件夹**来组织不同分类的文档。例如：

```text
apps/docs/docs/
├── getting-started.md             # 顶层单篇文档
│
├── models/                        # 📁 模型分类文件夹 (父目录)
│   ├── vision.md                  # 📄 子文档 1：视觉模型配置
│   ├── delegation.md              # 📄 子文档 2：委托机制详解
│   └── free-tier.md               # 📄 子文档 3：免费额度推荐
│
└── search/                        # 📁 搜索分类文件夹 (父目录)
    ├── tavily.md                  # 📄 子文档 1：Tavily 配置
    └── searxng.md                 # 📄 子文档 2：SearXNG 自建
```

---

## 2. 在配置文件中配置父子层级

打开 `apps/docs/.vitepress/config.mts`，在 `sidebar` 中使用 `items` 嵌套即可实现父子层级：

```ts
sidebar: {
  '/docs/': [
    {
      text: '🧠 模型与推理配置',    // 👈 大分类 (Section Header)
      collapsed: false,             // 是否默认展开
      items: [
        {
          text: '视觉模型 (Vision)',  // 👈 父文档 / 父目录
          collapsed: false,          // 支持单独折叠/展开
          items: [                   // 👈 下属子文档列表
            { text: '视觉模型总览', link: '/docs/models/vision' },
            { text: '视觉委托详解', link: '/docs/models/delegation' },
            { text: '免费模型推荐', link: '/docs/models/free-tier' },
          ],
        },
        {
          text: '主力思考模型',      // 👈 另一个父文档
          collapsed: true,           // 默认折叠，点击展开
          items: [
            { text: 'DeepSeek / Claude 配置', link: '/docs/getting-started' },
          ],
        },
      ],
    },
  ],
}
```

---

## 3. 常用配置属性说明

| 属性 | 说明 | 示例 |
| :--- | :--- | :--- |
| `text` | 侧边栏显示的标题名称 | `'视觉模型与委托'` |
| `link` | 点击跳转的 Markdown 文件路径（无需写 `.md` 后缀） | `'/docs/models/vision'` |
| `items` | 子文档数组（可无限层级嵌套） | `items: [ ...子文档 ]` |
| `collapsed` | 是否可折叠（`false` 默认展开，`true` 默认折叠） | `collapsed: true` |

---

## 4. 上线发布

修改完成后：
1. 本地开发服务（`pnpm dev:docs`）会**秒级热更新**，左侧目录树即刻呈现折叠与层级效果。
2. 提交到 Git：`git commit -am "docs: update hierarchy"` ➔ `git push`，Cloudflare Pages 自动构建发布！
