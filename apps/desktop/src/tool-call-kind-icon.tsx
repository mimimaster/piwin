/** Head-row icon mapping for tool-call cards (behavior id → verb → name → kind). */
import type { ReactElement } from 'react';
import type { ToolKind } from '@piwin/contracts';
import type { BehaviorActivityId } from './behavior-activity.js';
import {
  IconActivity,
  IconBook,
  IconBrowser,
  IconFile,
  IconGit,
  IconPlug,
  IconSearch,
  IconSpark,
  IconTerminal,
} from './shell-icons';

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
      return <IconPlug className="tool-call-kind-icon" />;
    case 'web.search':
    case 'web.fetch':
    case 'browser':
      return <IconBrowser className="tool-call-kind-icon" />;
    case 'search':
    case 'explore':
      return <IconSearch className="tool-call-kind-icon" />;
    case 'read':
    case 'edit':
      return <IconFile className="tool-call-kind-icon" />;
    case 'shell':
    case 'test':
    case 'build':
    case 'process':
      return <IconTerminal className="tool-call-kind-icon" />;
    case 'git':
      return <IconGit className="tool-call-kind-icon" />;
    case 'image':
    case 'video':
      return <IconSpark className="tool-call-kind-icon" />;
    default:
      break;
  }
  const verb = (actionVerb ?? '').toLowerCase();
  const name = (toolName ?? '').toLowerCase();

  if (verb.startsWith('searched') || verb.startsWith('explored')) {
    return <IconSearch className="tool-call-kind-icon" />;
  }
  if (verb.startsWith('read') || verb.startsWith('edited')) {
    return <IconFile className="tool-call-kind-icon" />;
  }
  if (verb.startsWith('ran command') || verb === 'bash') {
    return <IconTerminal className="tool-call-kind-icon" />;
  }
  if (verb.startsWith('ran test') || verb.startsWith('built')) {
    return <IconTerminal className="tool-call-kind-icon" />;
  }
  if (verb.startsWith('git')) {
    return <IconGit className="tool-call-kind-icon" />;
  }
  if (verb.startsWith('fetched') || verb.startsWith('searched') || verb.includes('web')) {
    return <IconBrowser className="tool-call-kind-icon" />;
  }
  if (verb.startsWith('mcp') || verb.includes('mcp')) {
    return <IconPlug className="tool-call-kind-icon" />;
  }
  if (verb.includes('image') || verb.includes('generated')) {
    return <IconSpark className="tool-call-kind-icon" />;
  }

  if (
    name.includes('web') ||
    name.includes('url') ||
    name.includes('fetch') ||
    name.includes('http')
  ) {
    return <IconBrowser className="tool-call-kind-icon" />;
  }
  if (
    name.includes('search') ||
    name.includes('grep') ||
    name.includes('glob') ||
    name.includes('find')
  ) {
    return <IconSearch className="tool-call-kind-icon" />;
  }
  if (
    name.includes('read') ||
    name.includes('view') ||
    name.includes('write') ||
    name.includes('edit')
  ) {
    return <IconFile className="tool-call-kind-icon" />;
  }
  if (
    name.includes('bash') ||
    name.includes('command') ||
    name.includes('exec') ||
    name.includes('test') ||
    name.includes('build') ||
    name === 'shell'
  ) {
    return <IconTerminal className="tool-call-kind-icon" />;
  }
  if (name.includes('git')) {
    return <IconGit className="tool-call-kind-icon" />;
  }
  if (name.startsWith('goal')) {
    return <IconSpark className="tool-call-kind-icon" />;
  }

  switch (kind) {
    case 'filesystem':
      return <IconFile className="tool-call-kind-icon" />;
    case 'shell':
    case 'process':
      return <IconTerminal className="tool-call-kind-icon" />;
    case 'git':
      return <IconGit className="tool-call-kind-icon" />;
    case 'web':
      return <IconBrowser className="tool-call-kind-icon" />;
    case 'mcp':
      return <IconPlug className="tool-call-kind-icon" />;
    case 'image':
    case 'video':
      return <IconSpark className="tool-call-kind-icon" />;
    case 'other':
      return <IconActivity className="tool-call-kind-icon" />;
    default:
      return <IconBook className="tool-call-kind-icon" />;
  }
}
