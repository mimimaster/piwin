/** Composed HostCommand union. Public IPC command type. */

import type { KnowledgeHostCommand } from './ipc-knowledge-commands.js';
import type { PlatformHostCommand } from './ipc-platform-commands.js';
import type { SessionHostCommand } from './ipc-session-commands.js';

export type { KnowledgeHostCommand, PlatformHostCommand, SessionHostCommand };

/** UI / external client → host */
export type HostCommand = SessionHostCommand | KnowledgeHostCommand | PlatformHostCommand;
