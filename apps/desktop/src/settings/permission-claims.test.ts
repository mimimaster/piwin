import { afterEach, describe, expect, it } from 'vitest';
import type { PermissionPromptUi } from '../conversation/chat-ui-types';
import {
  claimPermissionRequests,
  releasePermissionClaims,
  withoutClaimedPermissionPrompts,
} from './permission-claims';

function prompt(requestId: string): PermissionPromptUi {
  return {
    requestId,
    sessionId: 'session-1',
    action: 'bash',
    detail: 'ls',
    defaultDecision: 'ask',
  };
}

describe('permission claims', () => {
  const owners: object[] = [];
  function newOwner(): object {
    const owner = {};
    owners.push(owner);
    return owner;
  }

  afterEach(() => {
    for (const owner of owners.splice(0)) releasePermissionClaims(owner);
  });

  it('hides claimed prompts from the main bar until the claim is released', () => {
    const queue = [prompt('a'), prompt('b')];
    const pane = newOwner();

    claimPermissionRequests(pane, ['a']);
    expect(withoutClaimedPermissionPrompts(queue).map((item) => item.requestId)).toEqual(['b']);

    releasePermissionClaims(pane);
    expect(withoutClaimedPermissionPrompts(queue).map((item) => item.requestId)).toEqual([
      'a',
      'b',
    ]);
  });

  it("replaces an owner's claim set when its pending prompts change", () => {
    const pane = newOwner();
    claimPermissionRequests(pane, ['a', 'b']);
    claimPermissionRequests(pane, ['b']);

    expect(
      withoutClaimedPermissionPrompts([prompt('a'), prompt('b')]).map((item) => item.requestId),
    ).toEqual(['a']);
  });

  it('keeps a request claimed while any owner still holds it', () => {
    const first = newOwner();
    const second = newOwner();
    claimPermissionRequests(first, ['shared']);
    claimPermissionRequests(second, ['shared']);

    releasePermissionClaims(first);
    expect(withoutClaimedPermissionPrompts([prompt('shared')])).toEqual([]);

    releasePermissionClaims(second);
    expect(withoutClaimedPermissionPrompts([prompt('shared')])).toHaveLength(1);
  });

  it('treats an empty claim list as a release', () => {
    const pane = newOwner();
    claimPermissionRequests(pane, ['a']);
    claimPermissionRequests(pane, []);
    expect(withoutClaimedPermissionPrompts([prompt('a')])).toHaveLength(1);
  });
});
