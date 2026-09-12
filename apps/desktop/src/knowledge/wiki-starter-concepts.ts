import type { WikiConceptDetail, WikiConceptItem } from '@piwin/contracts';

export const STARTER_CONCEPTS: WikiConceptItem[] = [
  {
    slug: 'llm-wiki',
    title: 'Andrej Karpathy LLM-Wiki',
    summary: '生熟知识分离，以个人百科作为核心交付物。',
    tags: ['核心架构', '知识体系'],
    updatedAt: '2026-09-11T12:00:00Z',
    relativePath: 'concepts/llm-wiki.md',
  },
  {
    slug: 'dual-mode-host',
    title: 'Dual Mode Host 架构',
    summary: 'PiSdk 与 PiRpc 双模式同构接入，进程解耦。',
    tags: ['核心架构', 'Host'],
    updatedAt: '2026-09-11T12:00:00Z',
    relativePath: 'concepts/dual-mode-host.md',
  },
  {
    slug: 'fsrs-algorithm',
    title: 'FSRS 自由间隔重复算法',
    summary: '基于记忆留存率的现代遗忘曲线调度引擎。',
    tags: ['算法', '记忆'],
    updatedAt: '2026-09-11T12:00:00Z',
    relativePath: 'concepts/fsrs-algorithm.md',
  },
];

export const STARTER_CONCEPT_DETAILS: Record<string, WikiConceptDetail> = {
  'llm-wiki': {
    slug: 'llm-wiki',
    title: 'Andrej Karpathy LLM-Wiki',
    summary: '生熟知识分离，以个人百科作为核心交付物。',
    tags: ['核心架构', '知识体系'],
    updatedAt: '2026-09-11T12:00:00Z',
    aliases: ['Karpathy Wiki', 'Personal Wiki'],
    links: ['fsrs-algorithm', 'dual-mode-host'],
    relativePath: 'concepts/llm-wiki.md',
    content: `**LLM-Wiki** 是一种将大型语言模型作为编纂者、将个人百科全书作为核心沉淀的现代知识管理范式。它主张彻底打破传统 RAG 仅对文本做浅层 Embedding 切片的局限性，将原始“生肉资料”经过提炼、去重、交叉验证后，沉淀为拥有严密定义的百科概念。

在 piwin 的实践中，维基正文通过双括号实现无缝的概念漫游。例如，通过 [[FSRS 自由间隔重复算法]] 实现对关键技术结论的强化记忆，并通过 [[Dual Mode Host 架构]] 保证本地运行环境与外部沙箱的无缝隔离。`,
  },
  'dual-mode-host': {
    slug: 'dual-mode-host',
    title: 'Dual Mode Host 架构',
    summary: 'PiSdk 与 PiRpc 双模式同构接入，进程解耦。',
    tags: ['核心架构', 'Host'],
    updatedAt: '2026-09-11T12:00:00Z',
    aliases: ['Dual Mode'],
    links: ['llm-wiki'],
    relativePath: 'concepts/dual-mode-host.md',
    content: `**Dual Mode Host 架构** 是 piwin 的核心进程隔离与扩展模型。系统通过抽象统一的 \`SessionBackend\` 契约，支持在极轻量级内联 SDK 模式（\`PiSdkAdapter\`）与进程隔离的 RPC 模式（\`PiRpcAdapter\`）之间无缝切换。

该架构彻底保证了 UI 层绝不直接依赖底层 Pi 执行核心，从而使得桌面端、CLI 端及远端 Web 端能够以完全同构的方式调度工具、运行模型及管理沙箱权限。`,
  },
  'fsrs-algorithm': {
    slug: 'fsrs-algorithm',
    title: 'FSRS 自由间隔重复算法',
    summary: '基于记忆留存率的现代遗忘曲线调度引擎。',
    tags: ['算法', '记忆'],
    updatedAt: '2026-09-11T12:00:00Z',
    aliases: ['FSRS'],
    links: ['llm-wiki'],
    relativePath: 'concepts/fsrs-algorithm.md',
    content: `**FSRS (Free Spaced Repetition Scheduler)** 是一种基于现代认知心理学与遗忘曲线模型的记忆调度算法。相比传统 SM-2 算法，FSRS 能根据用户对难度的动态评估，精确推算出达到目标记忆留存率（如 90%）所需的最佳复习间隔。

在知识中心中，FSRS 算法与 [[Andrej Karpathy LLM-Wiki]] 的概念萃取卡紧密配合，实现生肉阅读到长期记忆的彻底转化。`,
  },
};
