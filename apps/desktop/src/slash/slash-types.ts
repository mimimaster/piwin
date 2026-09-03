/**
 * Composer slash menu item shapes (commands · modes · skills).
 */

import type { AgentModeId } from '../agent-mode';

export type SlashItemKind = 'command' | 'mode' | 'skill';

export type SlashGroupLabel = 'Command' | 'Mode' | 'Skill';

export type SlashItem = {
  id: string;
  kind: SlashItemKind;
  /** Token without leading slash (e.g. "compact", "plan", "create-skill"). */
  name: string;
  /** Alternate tokens that resolve to this item (e.g. summarize → compact). */
  aliases?: string[];
  label: string;
  description: string;
  keywords?: string[];
  groupLabel: SlashGroupLabel;
  /** Skills: false when disabled in registry. */
  enabled?: boolean;
  available: boolean;
  unavailableReason?: string;
  /** Commands that accept trailing free-text args (compact). */
  acceptsArgs?: boolean;
};

export type ActiveSlashToken = {
  /** Full token including leading slash, e.g. "/comp". */
  raw: string;
  /** Query after `/` (may be empty). */
  query: string;
  /** Start index of `/` in full composer text. */
  startIndex: number;
  /** End index exclusive (caret when active). */
  endIndex: number;
};

export type ParsedSlashSubmit =
  | { kind: 'none' }
  | {
      kind: 'command';
      commandId: 'compact';
      /** Primary name used (may be an alias). */
      name: string;
      args: string;
    }
  | {
      kind: 'mode';
      modeId: AgentModeId;
      name: string;
      /** Extra text after mode name; empty when mode-only. */
      args: string;
    }
  | {
      kind: 'skill';
      skillId: string;
      skillName: string;
      args: string;
    }
  | {
      kind: 'scheme';
      /** off | ultra-code | custom id */
      schemeId: string;
      name: string;
      args: string;
    }
  | {
      kind: 'knowledge';
      subTab: 'doccards' | 'cards' | 'wiki';
      name: string;
      args: string;
    }
  | {
      kind: 'cards-panel';
      name: string;
      args: string;
    }
  | {
      kind: 'unknown';
      name: string;
      args: string;
    };
