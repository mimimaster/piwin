import { describe, expect, it } from 'vitest';
import { WEB_SEARCH_DIAGNOSTICS_DETAILS_KIND, type WebSearchDiagnostics } from '@piwin/contracts';
import { mapToolExecutionEndEvent } from './tool-event-map.js';
import { buildToolPresentation } from './tool-presentation.js';

const details: WebSearchDiagnostics = {
  kind: WEB_SEARCH_DIAGNOSTICS_DETAILS_KIND,
  providerId: 'aggregate:brave+tavily',
  hitCount: 5,
  durationMs: 1210,
  attempts: [
    { sourceId: 'brave', ok: false, hitCount: 0, durationMs: 5000, timedOut: true, error: 'timed out' },
    { sourceId: 'tavily', ok: true, hitCount: 5, durationMs: 1200 },
  ],
};

describe('web_search tool presentation', () => {
  it('attaches diagnostics from web_search details', () => {
    const presentation = buildToolPresentation({ toolName: 'web_search', details });
    expect(presentation.webSearch).toEqual(details);
  });

  it('ignores other tools and non-diagnostic details', () => {
    expect(buildToolPresentation({ toolName: 'web_fetch', details }).webSearch).toBeUndefined();
    expect(
      buildToolPresentation({ toolName: 'web_search', details: { kind: 'other' } }).webSearch,
    ).toBeUndefined();
  });

  it('carries diagnostics through tool/end event mapping', () => {
    const [event] = mapToolExecutionEndEvent({
      toolCallId: 'call-1',
      toolName: 'web_search',
      result: {
        content: [{ type: 'text', text: '{"hits":[]}' }],
        details: { byteSize: 11, ...details },
      },
    });
    if (event?.type !== 'tool/end') throw new Error('expected a tool/end event');
    expect(event.presentation?.webSearch?.attempts).toHaveLength(2);
    expect(event.presentation?.webSearch?.attempts[0]?.timedOut).toBe(true);
  });
});
