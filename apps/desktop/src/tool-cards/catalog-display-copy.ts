/**
 * Chinese UI copy for first-party catalog rows. Model-facing SKILL.md /
 * extension comments stay English; the Settings list can show this instead.
 */
const CATALOG_DESCRIPTION_ZH: Readonly<Record<string, string>> = {
  'create-skill': '新建 Agent Skill（SKILL.md），写好 frontmatter 和面向结果的正文。',
  'executing-plans': '按已批准的计划逐步执行，每步都留证据。',
  'find-skill': '列出当前会话可用的 Agent Skill。',
  'generate-flashcards':
    '从笔记或知识库用 flashcard_batch_create 生成闪卡。文件夹/文档请走 Doc Cards 生成，不要走这条工具路径。',
  imagegen:
    '需要 AI 生成位图（照片、插画、贴图、sprite、样机、透明抠图）时，生成或编辑栅格图。输出应是位图资源，而不是仓库里的代码或矢量。已有 SVG / 矢量 / 代码资源、图标体系，或 HTML/CSS/canvas 能直接做的，不要用这个。',
  videogen: '用已配置的视频模型，从文本或参考图生成短视频。',
  'writing-plans':
    '摸清代码库上下文，用 piwin_plan_create 写成模块化 SessionPlan 供你审阅。可用 /writing-plans 或 /write-plan。',
  'optimize-prompt':
    '把系统提示、工具描述和 Agent 指令收成高密度、契约驱动、XML 结构的生产规格。可用 /optimize-prompt。',
  improve:
    '以顾问视角只读审代码库，产出给其他模型/Agent 执行的优先、自包含实现计划。用于审计、缺陷、安全、性能、测试、技术债、迁移、DX、路线图或交接。可用 /improve。',
  'systematic-debugging': '用证据优先的循环定位失败，并验证修复。',
  'verification-before-completion': '声称完成、修好或通过之前，必须有新的证据。',
  'requesting-code-review': '为一组改动写一份短、高信号的 review 请求。',
  'subagent-driven-development':
    '把已批准计划的独立步骤交给隔离子会话，再在父会话合并验证。可用 /subagent-driven-development 或计划执行闸门。',
  'llm-wiki':
    '按 Karpathy 的 LLM-Wiki 模式做知识管理、文档综合和概念图维护。用于摄入文章/文档/论文、创建或查询 wiki 概念、维护交叉链接或健康检查。',
  'web-research':
    '用 web_search 和 web_fetch 给出有出处的当前事实。先搜再抓；Host 可能合并多个已配置来源。',
  'using-git-worktrees': '用 git worktree 做隔离的并行或子 Agent 工作，不弄脏主工作树。',
  'path-guard': '拦截针对密钥类路径的写入/编辑（.env、密钥、凭证）。',
  goal: '自主目标执行循环与进度跟踪。',
  questionnaire: '通过 Pi 的 Extension UI 向用户提结构化问题。',
};

export function catalogDescription(
  id: string,
  fallback: string,
  locale: 'zh-CN' | 'en',
): string {
  if (locale !== 'zh-CN') return fallback;
  return CATALOG_DESCRIPTION_ZH[id] ?? fallback;
}
