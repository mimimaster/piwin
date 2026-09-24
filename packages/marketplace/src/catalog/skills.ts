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
    featured: true,
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
];
