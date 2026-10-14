import { describe, expect, it } from 'vitest';
import { selectAttentionVisibility } from './attention-visibility';

const base = {
  stageSessionIds: ['main'],
  activeSessionId: 'main',
  workspaceCovered: false,
  overlayOpen: false,
  visibleSideChatSessionId: null,
};

describe('selectAttentionVisibility', () => {
  it('leaves the stage visible when no drawer is open', () => {
    expect(selectAttentionVisibility(base)).toEqual({
      sessionIds: ['main'],
      conversationCovered: false,
    });
  });

  it('covers the stage while an overlay drawer is open', () => {
    expect(selectAttentionVisibility({ ...base, overlayOpen: true })).toEqual({
      sessionIds: [],
      conversationCovered: true,
    });
  });

  it('keeps a side chat visible when it is the drawer over the stage', () => {
    expect(
      selectAttentionVisibility({ ...base, overlayOpen: true, visibleSideChatSessionId: 'side' }),
    ).toEqual({ sessionIds: ['side'], conversationCovered: false });
  });

  it('adds the side chat beside the stage sessions', () => {
    expect(selectAttentionVisibility({ ...base, visibleSideChatSessionId: 'side' })).toEqual({
      sessionIds: ['main', 'side'],
      conversationCovered: false,
    });
  });

  it('spells out the active-session fallback once a side chat is in the set', () => {
    expect(
      selectAttentionVisibility({ ...base, stageSessionIds: [], visibleSideChatSessionId: 'side' }),
    ).toEqual({ sessionIds: ['main', 'side'], conversationCovered: false });
  });

  it('hides everything, side panel included, behind a sub-page or Settings', () => {
    expect(
      selectAttentionVisibility({ ...base, workspaceCovered: true, visibleSideChatSessionId: 'side' }),
    ).toEqual({ sessionIds: [], conversationCovered: true });
  });
});
