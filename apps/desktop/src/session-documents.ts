/**
 * Session-document rail projection (extracted from App.tsx).
 *
 * This list is a convenience index of markdown / plan / walkthrough docs
 * already visible in the transcript. Trusted-config JSON/YAML files are
 * opened from tool-card targets, not scraped from message text.
 */
import type { SessionDocItem } from './DocPreviewPanel';
import { sessionPlanDisplayPath } from './plan-document-path.js';

export type SessionDocumentMessage = {
  text?: string | undefined;
};

export type SessionDocumentPlan = {
  sessionId: string;
  title?: string | undefined;
};

export type SessionDocumentActive = {
  title: string;
  filePath?: string | null | undefined;
};

export type SessionDocumentWalkthrough = {
  status?: string | undefined;
};

export type CollectSessionDocumentsInput = {
  sessionPlan?: SessionDocumentPlan | null | undefined;
  messages: readonly SessionDocumentMessage[];
  activeDocument?: SessionDocumentActive | null | undefined;
  walkthroughsByMessageId: Readonly<Record<string, SessionDocumentWalkthrough | undefined>>;
};

/** Markdown path chips scraped from assistant/user text. */
const MARKDOWN_PATH_REGEX =
  /(?:file:\/\/|\/|[A-Za-z]:[\\/]|(?:\.\.?\/))+[\w\u4e00-\u9fa5_./-]+\.md\b/g;

export function collectSessionDocuments(
  input: CollectSessionDocumentsInput,
): SessionDocItem[] {
  const items: SessionDocItem[] = [];
  const seenPaths = new Set<string>();

  const addDocument = (
    title: string,
    path?: string,
    iconKind?: 'doc' | 'book' | 'plan',
  ): void => {
    const cleanTitle = (title || 'Document').replace(/\.md$/i, '');
    const documentPath = path || title;
    if (seenPaths.has(documentPath)) {
      return;
    }
    seenPaths.add(documentPath);
    items.push({
      id: documentPath,
      title: cleanTitle,
      ...(path ? { path } : {}),
      iconKind:
        iconKind || (cleanTitle.toLowerCase().includes('walkthrough') ? 'book' : 'doc'),
    });
  };

  if (input.sessionPlan) {
    addDocument(
      input.sessionPlan.title || 'Implementation Plan',
      sessionPlanDisplayPath(input.sessionPlan.sessionId),
      'plan',
    );
  }

  for (const message of input.messages) {
    if (!message.text) {
      continue;
    }
    const markdownMatches = message.text.match(MARKDOWN_PATH_REGEX);
    if (!markdownMatches) {
      continue;
    }
    for (const fullPath of markdownMatches) {
      const baseName = fullPath.split(/[\\/]/).pop() || fullPath;
      addDocument(baseName, fullPath);
    }
  }

  if (input.activeDocument?.title) {
    addDocument(
      input.activeDocument.title,
      input.activeDocument.filePath ?? input.activeDocument.title,
    );
  }

  for (const messageId of Object.keys(input.walkthroughsByMessageId)) {
    const artifact = input.walkthroughsByMessageId[messageId];
    if (artifact && artifact.status === 'ready') {
      addDocument('Walkthrough', `walkthroughs/${messageId}.md`, 'book');
    }
  }

  return items;
}
