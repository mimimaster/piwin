/** Knowledge base state copy: every state names what happened and what to do next. */
import type { StatusTone } from '@piwin/ui-kit';
import type { KnowledgeBaseState, KnowledgeBaseSummary } from '@piwin/contracts';

export type KnowledgeLocale = 'zh-CN' | 'en';

export type KnowledgeNextStep = 'ingest' | 'retry' | 'remove' | 'wait' | null;

export type KnowledgeStateCopy = {
  label: string;
  tone: StatusTone;
  /** Shown in the detail panel; null when the state needs no explanation. */
  explanation: string | null;
  nextStep: KnowledgeNextStep;
};

export function knowledgeStateCopy(
  base: KnowledgeBaseSummary,
  locale: KnowledgeLocale,
): KnowledgeStateCopy {
  const zh = locale === 'zh-CN';
  const state: KnowledgeBaseState = base.state;
  switch (state) {
    case 'ready':
      return { label: zh ? '可用' : 'Ready', tone: 'success', explanation: null, nextStep: null };
    case 'partial': {
      const failed = base.failedDocumentCount ?? 0;
      return {
        label: zh ? '部分失败' : 'Partly failed',
        tone: 'warning',
        explanation: zh
          ? `${failed} 个文件入库失败，其余内容可以正常检索。`
          : `${failed} file${failed === 1 ? '' : 's'} failed to ingest. Everything else is searchable.`,
        nextStep: 'retry',
      };
    }
    case 'indexing':
      return {
        label: zh ? '入库中' : 'Ingesting',
        tone: 'running',
        explanation: zh
          ? '正在解析和切分文件，完成后即可检索。'
          : 'Parsing and chunking files. Search opens when this finishes.',
        nextStep: 'wait',
      };
    case 'not-indexed':
      return {
        label: zh ? '未入库' : 'Not ingested',
        tone: 'neutral',
        explanation: zh
          ? '选择要入库的文件后，才能在对话里检索、查找原文或出卡。'
          : 'Pick files to ingest before this folder can be searched, cited, or turned into cards.',
        nextStep: 'ingest',
      };
    case 'missing':
      return {
        label: zh ? '找不到文件夹' : 'Folder missing',
        tone: 'danger',
        explanation: zh
          ? '这个文件夹已被移动或删除。移除后可以重新添加新位置。'
          : 'This folder was moved or deleted. Remove it and add the new location.',
        nextStep: 'remove',
      };
    case 'empty':
      if (base.kind === 'wiki') {
        return {
          label: zh ? '暂无词条' : 'No concepts yet',
          tone: 'neutral',
          explanation: zh
            ? '通过 /wiki 指令或让 Agent 提炼材料，生成的百科词条会自动进入这里。'
            : 'Ask the agent to ingest materials or create concepts with /wiki.',
          nextStep: null,
        };
      }
      return {
        label: zh ? '还没有笔记' : 'No notes yet',
        tone: 'neutral',
        explanation: zh
          ? '在对话里让 Agent 记笔记，笔记会自动进入这里。'
          : 'Ask the agent to take notes in a conversation; they land here automatically.',
        nextStep: null,
      };
  }
}

export function knowledgeBaseMeta(base: KnowledgeBaseSummary, locale: KnowledgeLocale): string {
  const zh = locale === 'zh-CN';
  const parts: string[] = [];
  if (base.kind === 'notes') {
    parts.push(zh ? `${base.documentCount} 篇笔记` : `${base.documentCount} notes`);
  } else if (base.kind === 'wiki') {
    parts.push(zh ? `${base.documentCount} 个词条` : `${base.documentCount} concepts`);
  } else {
    parts.push(zh ? `${base.documentCount} 个文件` : `${base.documentCount} files`);
    if (base.chunkCount !== undefined) {
      parts.push(zh ? `${base.chunkCount} 个片段` : `${base.chunkCount} chunks`);
    }
  }
  if (base.lastIndexedAt) {
    const date = new Date(base.lastIndexedAt);
    if (!Number.isNaN(date.getTime())) {
      const formatted = date.toLocaleDateString(zh ? 'zh-CN' : 'en-US', {
        month: 'short',
        day: 'numeric',
      });
      parts.push(zh ? `${formatted}入库` : `ingested ${formatted}`);
    }
  }
  return parts.join(' · ');
}
