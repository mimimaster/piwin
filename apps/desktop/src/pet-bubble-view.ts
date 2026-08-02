/**
 * Stable, glanceable pet-bubble content (Codex-style).
 *
 * Unlike the chat splash phrases (which rotate for ambience), the overlay
 * bubble must show *what is happening right now* and update only when the
 * underlying activity changes — no cycling fluff.
 */
import type { PetRuntimeSnapshot } from '@piwin/contracts';
import { petToActivityInput } from './pet-activity-mapper.js';
import type { RunActivityInput } from './run-activity-types.js';
import { resolveActionCategory } from './run-activity-icon.js';

export type PetBubbleStatusKind =
  | 'thinking'
  | 'working'
  | 'waiting'
  | 'failed'
  | 'complete'
  | 'stopping'
  | 'preparing';

export type PetBubbleView = {
  /** Compact status chip label ("Thinking", "Running", …). */
  statusLabel: string;
  statusKind: PetBubbleStatusKind;
  /** Primary work line — always the most specific fact we have. */
  headline: string;
  /** Optional secondary line (path / command / query), mono-friendly. */
  detail?: string;
};

const DETAIL_MAX = 80;

/**
 * Build bubble content from a live pet snapshot. Returns `null` when idle
 * (caller hides the bubble).
 */
export function buildPetBubbleView(
  pet: PetRuntimeSnapshot,
  locale: 'zh-CN' | 'en' = 'zh-CN',
): PetBubbleView | null {
  const input = petToActivityInput(pet, locale);
  if (!input) return null;

  const isZh = locale === 'zh-CN';
  const statusKind = resolveStatusKind(input);
  const statusLabel = statusLabelFor(statusKind, isZh);
  const detail = clipDetail(input.detail);
  const verb = localizeVerb(input.actionVerb, isZh);
  const tool = input.activeToolName?.trim();

  // Prefer concrete work facts over ambient phrases.
  if (statusKind === 'waiting') {
    return {
      statusLabel,
      statusKind,
      headline: isZh ? '需要你确认' : 'Needs your approval',
      ...(detail ? { detail } : tool ? { detail: tool } : {}),
    };
  }

  if (statusKind === 'failed') {
    return {
      statusLabel,
      statusKind,
      headline: isZh ? '出错了' : 'Something went wrong',
      ...(detail ? { detail } : {}),
    };
  }

  if (statusKind === 'stopping') {
    return {
      statusLabel,
      statusKind,
      headline: isZh ? '正在停止…' : 'Stopping…',
    };
  }

  if (statusKind === 'complete') {
    return {
      statusLabel,
      statusKind,
      headline: isZh ? '完成了' : 'Done',
    };
  }

  // Working / thinking / preparing — show the live tool target when present.
  if (detail && verb) {
    return {
      statusLabel,
      statusKind,
      headline: `${verb}`,
      detail,
    };
  }
  if (detail && tool) {
    return {
      statusLabel,
      statusKind,
      headline: shortTool(tool),
      detail,
    };
  }
  if (detail) {
    return {
      statusLabel,
      statusKind,
      headline: statusKind === 'thinking' || statusKind === 'preparing'
        ? statusLabel
        : isZh
          ? '工作中'
          : 'Working',
      detail,
    };
  }
  if (tool) {
    return {
      statusLabel,
      statusKind,
      headline: isZh ? `运行 ${shortTool(tool)}` : `Running ${shortTool(tool)}`,
    };
  }

  // Phase-only (thinking / preparing / streaming with no tool yet).
  return {
    statusLabel,
    statusKind,
    headline: ambientHeadline(statusKind, isZh, input),
  };
}

function resolveStatusKind(input: RunActivityInput): PetBubbleStatusKind {
  if (input.kind === 'waiting-permission' || input.actionCategory === 'ask') {
    return 'waiting';
  }
  if (input.kind === 'failed') return 'failed';
  if (input.kind === 'stopping' || input.kind === 'stopped') return 'stopping';
  if (input.kind === 'complete') return 'complete';
  if (input.kind === 'preparing' || input.kind === 'connecting-model') {
    return 'preparing';
  }
  if (
    input.kind === 'waiting-first-token' ||
    input.kind === 'planning' ||
    input.kind === 'compacting'
  ) {
    return 'thinking';
  }
  // working with a tool, or category-based work
  const category = resolveActionCategory(input);
  if (category && category !== 'thinking' && category !== 'planning') {
    return 'working';
  }
  if (input.activeToolName || input.detail) return 'working';
  if (input.kind === 'working') return 'working';
  return 'thinking';
}

function statusLabelFor(kind: PetBubbleStatusKind, isZh: boolean): string {
  switch (kind) {
    case 'thinking':
      return isZh ? '思考中' : 'Thinking';
    case 'working':
      return isZh ? '运行中' : 'Running';
    case 'waiting':
      return isZh ? '等待确认' : 'Waiting';
    case 'failed':
      return isZh ? '失败' : 'Failed';
    case 'complete':
      return isZh ? '完成' : 'Done';
    case 'stopping':
      return isZh ? '停止中' : 'Stopping';
    case 'preparing':
      return isZh ? '准备中' : 'Preparing';
  }
}

function ambientHeadline(
  kind: PetBubbleStatusKind,
  isZh: boolean,
  input: RunActivityInput,
): string {
  if (kind === 'preparing') {
    return isZh ? '加载上下文…' : 'Loading context…';
  }
  if (kind === 'thinking') {
    if (input.kind === 'planning') {
      return isZh ? '规划下一步…' : 'Planning next moves…';
    }
    if (input.kind === 'compacting') {
      return isZh ? '压缩上下文…' : 'Trimming context…';
    }
    return isZh ? '整理思路…' : 'Thinking it over…';
  }
  return isZh ? '工作中…' : 'Working…';
}

function clipDetail(detail: string | undefined): string | undefined {
  if (!detail) return undefined;
  const compact = detail.replace(/\s+/g, ' ').trim();
  if (!compact) return undefined;
  if (compact.length <= DETAIL_MAX) return compact;
  if (compact.includes('/') || compact.includes('\\')) {
    return `…${compact.slice(-(DETAIL_MAX - 1))}`;
  }
  return `${compact.slice(0, DETAIL_MAX - 1)}…`;
}

function shortTool(toolName: string): string {
  return toolName.replace(/^mcp__?/, '').replace(/__/g, ' / ');
}

function localizeVerb(actionVerb: string | undefined, isZh: boolean): string | undefined {
  if (!actionVerb) return undefined;
  if (!isZh) return actionVerb;
  const key = actionVerb.trim().toLowerCase();
  const map: Record<string, string> = {
    read: '读取',
    edited: '编辑',
    edit: '编辑',
    'ran command': '执行',
    searched: '搜索',
    explored: '浏览',
    fetched: '获取',
    'generated image': '生成图片',
    'git status': 'Git 状态',
    'git diff': 'Git diff',
    'git log': 'Git log',
    'git commit': 'Git 提交',
    'git push': 'Git 推送',
    'git pull': 'Git 拉取',
    'git branch': 'Git 分支',
  };
  return map[key] ?? actionVerb;
}
