// @vitest-environment happy-dom
/**
 * Delete-confirm copy (ADR 0082).
 *
 * A non-Pi backend owns its own session catalog, so deleting locally also
 * removes the session there. The confirm text has to say so — otherwise the
 * user reads "transcript files will be removed" and loses the Grok thread.
 */
import { describe, expect, it } from 'vitest';
import { deleteDescription } from './app-dialogs';

describe('deleteDescription', () => {
  it('warns about the backend copy for a Grok session', () => {
    const text = deleteDescription({ sessionId: 's1', sessionName: 'Grok work', agentId: 'grok' }, false);
    // The English copy does not repeat the name; the dialog renders it from
    // `affectedObject`. Only the backend warning is added here.
    expect(text).toBe(
      'Transcript files will be removed. This cannot be undone. This session is also deleted from Grok.',
    );
  });

  it('stays generic for a Pi session', () => {
    const text = deleteDescription({ sessionId: 's1', sessionName: 'Pi work' }, false);
    expect(text).toBe('Transcript files will be removed. This cannot be undone.');
    expect(text).not.toContain('Grok');
  });

  it('does not name the backend when agentId is explicitly pi', () => {
    const text = deleteDescription({ sessionId: 's1', sessionName: 'Pi work', agentId: 'pi' }, false);
    expect(text).not.toContain('Grok');
  });

  it('carries the same warning in Chinese', () => {
    const text = deleteDescription({ sessionId: 's1', sessionName: 'Grok 任务', agentId: 'grok' }, true);
    expect(text).toContain('Grok 任务');
    expect(text).toContain('从 Grok 中删除');
  });

  it('handles a closed dialog without throwing', () => {
    expect(deleteDescription(null, false)).toBe(
      'Transcript files will be removed. This cannot be undone.',
    );
  });
});
