/**
 * Curated Skills from anthropics/skills, pinned to one commit so the
 * installed content is exactly what was reviewed.
 */
import type { MarketplaceCatalogEntry, MarketplaceCategory, MarketplaceExample, MarketplaceLocalizedText, MarketplaceRequirement } from '@piwin/contracts';

const ANTHROPIC_SKILLS_REPOSITORY = 'https://github.com/anthropics/skills.git';
/** anthropics/skills HEAD on 2026-09-24. */
const ANTHROPIC_SKILLS_COMMIT = '34040c9c568585f6929bedeaad110ad08f079624';

function anthropicSkill(input: {
  skillId: string;
  category: MarketplaceCategory;
  name: MarketplaceLocalizedText;
  summary: MarketplaceLocalizedText;
  description: MarketplaceLocalizedText;
  examples: MarketplaceExample[];
  requirements?: MarketplaceRequirement[];
  featured?: boolean;
}): MarketplaceCatalogEntry {
  return {
    entryId: `skill:${input.skillId}`,
    capabilityId: input.skillId,
    kind: 'skill',
    category: input.category,
    name: input.name,
    summary: input.summary,
    description: input.description,
    version: ANTHROPIC_SKILLS_COMMIT,
    author: 'Anthropic',
    homepage: `https://github.com/anthropics/skills/tree/${ANTHROPIC_SKILLS_COMMIT}/skills/${input.skillId}`,
    sourceLabel: 'GitHub',
    install: {
      kind: 'skill',
      source: {
        kind: 'git',
        url: ANTHROPIC_SKILLS_REPOSITORY,
        ref: ANTHROPIC_SKILLS_COMMIT,
        subdir: `skills/${input.skillId}`,
      },
    },
    requirements: input.requirements ?? [],
    examples: input.examples,
    verification: [{ level: 'author-declared' }],
    featured: input.featured ?? false,
  };
}

export const SKILL_CATALOG: MarketplaceCatalogEntry[] = [
  anthropicSkill({
    skillId: 'skill-creator',
    category: 'code-development',
    name: { en: 'Skill Creator', zhCN: 'Skill 创作助手' },
    summary: {
      en: 'Create, edit and evaluate your own Skills.',
      zhCN: '创建、修改并评测你自己的 Skill。',
    },
    description: {
      en: 'A workflow for drafting a new Skill, improving an existing one and measuring whether it triggers and performs as intended.',
      zhCN: '一套起草新 Skill、改进已有 Skill，并衡量其触发与效果是否符合预期的工作流。',
    },
    examples: [
      {
        title: { en: 'Draft a Skill', zhCN: '起草一个 Skill' },
        prompt: {
          en: 'Create a skill that writes release notes from git log.',
          zhCN: '做一个根据 git log 写发布说明的 Skill。',
        },
      },
    ],
    featured: false,
  }),
  anthropicSkill({
    skillId: 'mcp-builder',
    category: 'code-development',
    name: { en: 'MCP Builder', zhCN: 'MCP 服务开发' },
    summary: {
      en: 'Guidance for building well-designed MCP servers in Python or TypeScript.',
      zhCN: '指导用 Python 或 TypeScript 构建设计良好的 MCP 服务。',
    },
    description: {
      en: 'Covers tool design, error handling and evaluation for MCP servers that wrap an external API.',
      zhCN: '涵盖封装外部 API 的 MCP 服务在工具设计、错误处理与评测方面的做法。',
    },
    examples: [
      {
        title: { en: 'Wrap an API', zhCN: '封装一个 API' },
        prompt: {
          en: 'Build an MCP server in TypeScript for the GitHub issues API.',
          zhCN: '用 TypeScript 为 GitHub issues API 写一个 MCP 服务。',
        },
      },
    ],
  }),
  anthropicSkill({
    skillId: 'webapp-testing',
    category: 'code-development',
    name: { en: 'Web App Testing', zhCN: 'Web 应用测试' },
    summary: {
      en: 'Test local web apps with Playwright scripts, screenshots and logs.',
      zhCN: '用 Playwright 脚本测试本地 Web 应用，获取截图与日志。',
    },
    description: {
      en: 'Writes and runs Python Playwright scripts against a local server, including a helper that manages the server lifecycle.',
      zhCN: '针对本地服务编写并运行 Python Playwright 脚本，附带管理服务启停的辅助脚本。',
    },
    requirements: [
      {
        kind: 'command',
        value: 'python3 + playwright',
        required: true,
        description: {
          en: 'The bundled scripts run on the Host with Python Playwright.',
          zhCN: '附带脚本在 Host 上通过 Python Playwright 运行。',
        },
      },
    ],
    examples: [
      {
        title: { en: 'Smoke-test a page', zhCN: '冒烟测试一个页面' },
        prompt: {
          en: 'Start the dev server and check that the login page renders without console errors.',
          zhCN: '启动开发服务器，检查登录页能正常渲染且没有控制台报错。',
        },
      },
    ],
    featured: true,
  }),
  anthropicSkill({
    skillId: 'frontend-design',
    category: 'design-content',
    name: { en: 'Frontend Design', zhCN: '前端视觉设计' },
    summary: {
      en: 'Intentional visual direction for new or reshaped UI.',
      zhCN: '为新界面或改版界面确定有辨识度的视觉方向。',
    },
    description: {
      en: 'Guidance on aesthetic direction and typography so generated UI does not read as a template default.',
      zhCN: '在审美方向与排版上给出指导，避免生成的界面像模板默认样式。',
    },
    examples: [
      {
        title: { en: 'Restyle a page', zhCN: '重做页面样式' },
        prompt: {
          en: 'Redesign the settings page so it feels calm and editorial.',
          zhCN: '重新设计设置页，让它显得安静、有编辑感。',
        },
      },
    ],
    featured: true,
  }),
  anthropicSkill({
    skillId: 'doc-coauthoring',
    category: 'docs-research',
    name: { en: 'Doc Co-authoring', zhCN: '文档协作写作' },
    summary: {
      en: 'A structured workflow for specs, proposals and decision docs.',
      zhCN: '为规格说明、提案、决策文档提供结构化写作流程。',
    },
    description: {
      en: 'Gathers context, drafts in iterations and checks the document works for its readers.',
      zhCN: '先收集上下文，再迭代起草，最后检验文档对读者是否好用。',
    },
    examples: [
      {
        title: { en: 'Write a proposal', zhCN: '写一份提案' },
        prompt: {
          en: 'Help me write a proposal for moving our CI to self-hosted runners.',
          zhCN: '帮我写一份把 CI 迁到自建 runner 的提案。',
        },
      },
    ],
    featured: true,
  }),
  anthropicSkill({
    skillId: 'pdf',
    category: 'docs-research',
    name: { en: 'PDF', zhCN: 'PDF 处理' },
    summary: {
      en: 'Read, merge, split, fill and create PDF files.',
      zhCN: '读取、合并、拆分、填写表单并生成 PDF 文件。',
    },
    description: {
      en: 'Text and table extraction, merging and splitting, form filling, watermarks and OCR for scanned PDFs, using Python libraries and command-line tools.',
      zhCN: '借助 Python 库与命令行工具完成文字/表格提取、合并拆分、表单填写、加水印，以及扫描件 OCR。',
    },
    requirements: [
      {
        kind: 'command',
        value: 'python3 + pypdf',
        required: true,
        description: {
          en: 'Most operations run Python scripts on the Host; OCR also needs tesseract.',
          zhCN: '多数操作在 Host 上运行 Python 脚本；OCR 还需要 tesseract。',
        },
      },
    ],
    examples: [
      {
        title: { en: 'Fill a form', zhCN: '填写表单' },
        prompt: {
          en: 'Fill in ~/Downloads/application.pdf with my details and save a copy.',
          zhCN: '用我的信息填好 ~/Downloads/application.pdf 并另存一份。',
        },
      },
    ],
  }),
  anthropicSkill({
    skillId: 'docx',
    category: 'docs-research',
    name: { en: 'Word Documents', zhCN: 'Word 文档' },
    summary: {
      en: 'Create and edit .docx files with real formatting.',
      zhCN: '创建和编辑带完整排版的 .docx 文档。',
    },
    description: {
      en: 'Builds Word documents with headings, tables of contents and tracked changes, and edits existing ones without breaking their formatting.',
      zhCN: '生成带标题层级、目录与修订记录的 Word 文档，并在不破坏原有格式的前提下修改已有文档。',
    },
    requirements: [
      {
        kind: 'command',
        value: 'node + pandoc',
        required: true,
        description: {
          en: 'Uses the docx npm package and pandoc on the Host; LibreOffice for conversions.',
          zhCN: '在 Host 上使用 docx npm 包与 pandoc；格式转换需要 LibreOffice。',
        },
      },
    ],
    examples: [
      {
        title: { en: 'Draft a memo', zhCN: '起草备忘录' },
        prompt: {
          en: 'Turn these meeting notes into a formatted Word memo.',
          zhCN: '把这些会议纪要整理成一份排好版的 Word 备忘录。',
        },
      },
    ],
  }),
  anthropicSkill({
    skillId: 'xlsx',
    category: 'docs-research',
    name: { en: 'Excel Spreadsheets', zhCN: 'Excel 表格' },
    summary: {
      en: 'Build and fix spreadsheets with formulas and formatting.',
      zhCN: '创建和修正带公式与格式的电子表格。',
    },
    description: {
      en: 'Creates, edits and cleans .xlsx/.csv files with openpyxl and pandas, and recalculates formulas so results are verified.',
      zhCN: '用 openpyxl 与 pandas 创建、编辑、清洗 .xlsx/.csv 文件，并重新计算公式以核对结果。',
    },
    requirements: [
      {
        kind: 'command',
        value: 'python3 + openpyxl',
        required: true,
        description: {
          en: 'Runs Python on the Host; formula recalculation uses LibreOffice.',
          zhCN: '在 Host 上运行 Python；公式重算依赖 LibreOffice。',
        },
      },
    ],
    examples: [
      {
        title: { en: 'Clean a sheet', zhCN: '整理表格' },
        prompt: {
          en: 'Clean up sales.csv and build a monthly summary sheet with totals.',
          zhCN: '整理 sales.csv，并生成一张带合计的月度汇总表。',
        },
      },
    ],
  }),
  anthropicSkill({
    skillId: 'pptx',
    category: 'design-content',
    name: { en: 'PowerPoint Decks', zhCN: 'PPT 演示文稿' },
    summary: {
      en: 'Create, edit and read .pptx slide decks.',
      zhCN: '创建、编辑和读取 .pptx 演示文稿。',
    },
    description: {
      en: 'Generates decks with pptxgenjs, edits existing presentations and templates, and renders slides for visual checks.',
      zhCN: '用 pptxgenjs 生成幻灯片，修改已有演示文稿与模板，并渲染页面做视觉检查。',
    },
    requirements: [
      {
        kind: 'command',
        value: 'node + python3',
        required: true,
        description: {
          en: 'Uses pptxgenjs and python-pptx on the Host; previews need LibreOffice.',
          zhCN: '在 Host 上使用 pptxgenjs 与 python-pptx；预览需要 LibreOffice。',
        },
      },
    ],
    examples: [
      {
        title: { en: 'Make a deck', zhCN: '做一份演示' },
        prompt: {
          en: 'Make a 6-slide deck summarizing this quarter\'s roadmap.',
          zhCN: '做一份 6 页的演示文稿，总结本季度路线图。',
        },
      },
    ],
  }),
];
