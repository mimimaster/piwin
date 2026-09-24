import { describe, expect, it, vi } from 'vitest';
import {
  hostResolvesDocumentPaths,
  parseResolution,
  requestDocumentPathResolution,
} from './document-path-resolve.js';

describe('hostResolvesDocumentPaths', () => {
  it('is true for a Host that omits its command ceiling', () => {
    expect(hostResolvesDocumentPaths({ request: vi.fn(), supportsCommand: () => true })).toBe(true);
  });

  it('is false for a Host that does not advertise the command', () => {
    expect(hostResolvesDocumentPaths({ request: vi.fn(), supportsCommand: () => false })).toBe(
      false,
    );
    // Test doubles without the seam must not trigger a doomed round-trip.
    expect(hostResolvesDocumentPaths({ request: vi.fn() })).toBe(false);
  });
});

describe('parseResolution', () => {
  it('reads a resolved logical target with its attempts', () => {
    expect(
      parseResolution({
        status: 'resolved',
        target: { kind: 'project-file', relativePath: 'docs/a.md', displayRef: 'docs/a.md' },
        attempts: [{ route: 'project', reason: 'inside-project-root', detail: 'docs/a.md' }],
      }),
    ).toEqual({
      kind: 'resolved',
      target: { kind: 'project-file', relativePath: 'docs/a.md', displayRef: 'docs/a.md' },
      attempts: [{ route: 'project', reason: 'inside-project-root', detail: 'docs/a.md' }],
    });
  });

  it('reads a refusal as a specific reason', () => {
    expect(
      parseResolution({
        status: 'unresolved',
        reason: 'remote-local-path-denied',
        attempts: [{ route: 'local-file', reason: 'channel-denied-by-remote-shell' }],
      }),
    ).toMatchObject({ kind: 'unresolved', reason: 'remote-local-path-denied' });
  });

  it('treats an unknown reason, kind, or shape as unsupported', () => {
    expect(parseResolution({ status: 'unresolved', reason: 'made-up' })).toEqual({
      kind: 'unsupported',
    });
    expect(parseResolution({ status: 'resolved', target: { kind: 'nonsense' } })).toEqual({
      kind: 'unsupported',
    });
    expect(parseResolution({ status: 'resolved', target: { kind: 'local-file' } })).toEqual({
      kind: 'unsupported',
    });
    expect(parseResolution(null)).toEqual({ kind: 'unsupported' });
  });
});

describe('requestDocumentPathResolution', () => {
  it('sends the raw path once and never expands it client-side', async () => {
    const request = vi.fn(async () => ({
      type: 'response' as const,
      command: 'preview/resolve-path',
      success: true as const,
      data: {
        status: 'unresolved',
        reason: 'not-found',
        attempts: [{ route: 'local-file', reason: 'no-such-file' }],
      },
    }));

    const result = await requestDocumentPathResolution(
      { request },
      { rawPath: '~/notes/plan.md', projectPath: '/workspace', sessionId: 's1' },
    );

    expect(request).toHaveBeenCalledWith({
      type: 'preview/resolve-path',
      input: { rawPath: '~/notes/plan.md', projectPath: '/workspace', sessionId: 's1' },
    });
    expect(result).toEqual({
      kind: 'unresolved',
      reason: 'not-found',
      attempts: [{ route: 'local-file', reason: 'no-such-file' }],
    });
  });

  it('falls back to the local planner when the Host rejects the command', async () => {
    const request = vi.fn(async () => {
      throw new Error('Unhandled command');
    });
    expect(await requestDocumentPathResolution({ request }, { rawPath: 'a.md' })).toEqual({
      kind: 'unsupported',
    });

    const failing = vi.fn(async () => ({
      type: 'response' as const,
      command: 'preview/resolve-path',
      success: false as const,
      error: 'Unhandled command',
    }));
    expect(await requestDocumentPathResolution({ request: failing }, { rawPath: 'a.md' })).toEqual({
      kind: 'unsupported',
    });
  });
});
