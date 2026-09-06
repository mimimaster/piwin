/** Head-row icon mapping for tool-call cards (behavior id → verb → name → kind). */
import type { ReactElement } from 'react';
import type { ToolKind } from '@piwin/contracts';
import type { BehaviorActivityId } from './behavior-activity.js';
import { COMPACTION_TOOL_NAME } from './compaction-tool-row.js';
import {
  ChainIconEdit,
  ChainIconGit,
  ChainIconMcp,
  ChainIconMedia,
  ChainIconRead,
  ChainIconSearch,
  ChainIconShell,
  ChainIconTool,
  ChainIconWeb,
} from './inkstone-chain-icons.js';
import { IconBrain, IconCompress } from './shell-icons';

const KIND_CLASS = 'tool-call-kind-icon';

/** Map action verb / kind / tool name → head-row icon. Prefer presentation verb. */
export function toolCallKindIcon(
  kind: ToolKind | 'unknown',
  toolName?: string,
  actionVerb?: string,
  behaviorId?: BehaviorActivityId,
): ReactElement {
  switch (behaviorId) {
    case 'mcp.server.connect':
    case 'mcp.discovery':
    case 'mcp.call':
      return <ChainIconMcp className={KIND_CLASS} />;
    case 'web.search':
    case 'web.fetch':
    case 'browser':
      return <ChainIconWeb className={KIND_CLASS} />;
    case 'search':
    case 'explore':
      return <ChainIconSearch className={KIND_CLASS} />;
    case 'read':
      return <ChainIconRead className={KIND_CLASS} />;
    case 'edit':
      return <ChainIconEdit className={KIND_CLASS} />;
    case 'shell':
    case 'test':
    case 'build':
    case 'process':
      return <ChainIconShell className={KIND_CLASS} />;
    case 'git':
      return <ChainIconGit className={KIND_CLASS} />;
    case 'image':
    case 'video':
      return <ChainIconMedia className={KIND_CLASS} />;
    default:
      break;
  }
  const verb = (actionVerb ?? '').toLowerCase();
  const name = (toolName ?? '').toLowerCase();

  // Exact synthetic identities resolve before the verb/name heuristics below,
  // which are deliberately fuzzy and would otherwise claim these rows.
  if (name === COMPACTION_TOOL_NAME) {
    return <IconCompress className={KIND_CLASS} />;
  }

  if (verb.startsWith('searched') || verb.startsWith('explored')) {
    return <ChainIconSearch className={KIND_CLASS} />;
  }
  if (verb.startsWith('edited') || verb === 'write_file' || verb.includes('write')) {
    return <ChainIconEdit className={KIND_CLASS} />;
  }
  if (verb.startsWith('read')) {
    return <ChainIconRead className={KIND_CLASS} />;
  }
  if (verb.startsWith('ran command') || verb === 'bash') {
    return <ChainIconShell className={KIND_CLASS} />;
  }
  if (verb.startsWith('ran test') || verb.startsWith('built')) {
    return <ChainIconShell className={KIND_CLASS} />;
  }
  if (verb.startsWith('git')) {
    return <ChainIconGit className={KIND_CLASS} />;
  }
  if (verb.startsWith('fetched') || verb.includes('web')) {
    return <ChainIconWeb className={KIND_CLASS} />;
  }
  if (verb.startsWith('mcp') || verb.includes('mcp')) {
    return <ChainIconMcp className={KIND_CLASS} />;
  }
  if (verb.includes('image') || verb.includes('generated') || verb.includes('video')) {
    return <ChainIconMedia className={KIND_CLASS} />;
  }
  if (verb.includes('think') || name.includes('think')) {
    return <IconBrain className={KIND_CLASS} />;
  }

  if (
    name.includes('web') ||
    name.includes('url') ||
    name.includes('fetch') ||
    name.includes('http')
  ) {
    return <ChainIconWeb className={KIND_CLASS} />;
  }
  if (
    name.includes('search') ||
    name.includes('grep') ||
    name.includes('glob') ||
    name.includes('find')
  ) {
    return <ChainIconSearch className={KIND_CLASS} />;
  }
  if (name.includes('write') || name.includes('edit') || name.includes('patch') || name.includes('replace')) {
    return <ChainIconEdit className={KIND_CLASS} />;
  }
  if (name.includes('read') || name.includes('view')) {
    return <ChainIconRead className={KIND_CLASS} />;
  }
  if (
    name.includes('bash') ||
    name.includes('command') ||
    name.includes('exec') ||
    name.includes('test') ||
    name.includes('build') ||
    name === 'shell'
  ) {
    return <ChainIconShell className={KIND_CLASS} />;
  }
  if (name.includes('git')) {
    return <ChainIconGit className={KIND_CLASS} />;
  }
  if (name.includes('mcp') || name.startsWith('mcp__')) {
    return <ChainIconMcp className={KIND_CLASS} />;
  }
  if (name.startsWith('goal') || name.includes('image') || name.includes('video')) {
    return <ChainIconMedia className={KIND_CLASS} />;
  }

  switch (kind) {
    case 'filesystem':
      return <ChainIconRead className={KIND_CLASS} />;
    case 'shell':
    case 'process':
      return <ChainIconShell className={KIND_CLASS} />;
    case 'git':
      return <ChainIconGit className={KIND_CLASS} />;
    case 'web':
      return <ChainIconWeb className={KIND_CLASS} />;
    case 'mcp':
      return <ChainIconMcp className={KIND_CLASS} />;
    case 'image':
    case 'video':
      return <ChainIconMedia className={KIND_CLASS} />;
    case 'other':
      return <ChainIconTool className={KIND_CLASS} />;
    default:
      return <ChainIconTool className={KIND_CLASS} />;
  }
}
