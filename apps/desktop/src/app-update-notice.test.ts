import { describe, expect, it, vi } from 'vitest';
import type { AppUpdateState } from './app-update-store.js';
import { describeAppUpdateNotice, type AppUpdateNoticeHandlers } from './app-update-notice.js';

vi.mock('./open-external-url.js', () => ({ openExternalUrl: vi.fn() }));

const UPDATE = { version: '0.2.8', currentVersion: '0.2.7' };

function handlers(): AppUpdateNoticeHandlers {
  return { install: vi.fn(), dismissPrompt: vi.fn(), openDownloadPage: vi.fn() };
}

function describeState(state: AppUpdateState, actions = handlers()) {
  return describeAppUpdateNotice(state, 'zh-CN', actions);
}

describe('describeAppUpdateNotice', () => {
  it('shows nothing while no newer version is published', () => {
    expect(describeState({ status: 'idle' })).toBeUndefined();
  });

  it('stays resident with "Update now" while an update is available', () => {
    const actions = handlers();
    const notice = describeState({ status: 'idle', update: UPDATE }, actions);
    expect(notice).toMatchObject({
      id: 'app-update',
      tone: 'info',
      title: 'piwin v0.2.8 可用',
      primaryAction: { label: '立即更新' },
    });
    expect(notice?.progress).toBeUndefined();
    notice?.primaryAction?.onSelect();
    expect(actions.install).toHaveBeenCalledWith(false);
  });

  it('shows download progress without actions', () => {
    const notice = describeState({
      status: 'downloading',
      update: UPDATE,
      progress: { downloaded: 42, total: 100, finished: false },
    });
    expect(notice).toMatchObject({ message: '正在下载更新 42%', progress: 42 });
    expect(notice?.primaryAction).toBeUndefined();
    expect(describeState({ status: 'preparing', update: UPDATE })?.progress).toBeNull();
    expect(describeState({ status: 'restarting', update: UPDATE })?.progress).toBe(100);
  });

  it('asks before interrupting busy sessions', () => {
    const actions = handlers();
    const notice = describeState(
      { status: 'busy', update: UPDATE, origin: 'notice', busySessionCount: 2 },
      actions,
    );
    expect(notice).toMatchObject({ tone: 'warning', primaryAction: { label: '仍然更新' } });
    expect(notice?.message).toContain('2 个会话');
    notice?.primaryAction?.onSelect();
    notice?.secondaryAction?.onSelect();
    expect(actions.install).toHaveBeenCalledWith(true);
    expect(actions.dismissPrompt).toHaveBeenCalled();
  });

  it('offers retry and the download page after a failure', () => {
    const actions = handlers();
    const notice = describeState(
      { status: 'failed', update: UPDATE, origin: 'notice', error: 'network down' },
      actions,
    );
    expect(notice).toMatchObject({ tone: 'error', message: '更新失败：network down' });
    notice?.primaryAction?.onSelect();
    notice?.secondaryAction?.onSelect();
    expect(actions.install).toHaveBeenCalledWith(false);
    expect(actions.openDownloadPage).toHaveBeenCalled();
  });

  it('follows the desktop locale', () => {
    const notice = describeAppUpdateNotice({ status: 'idle', update: UPDATE }, 'en', handlers());
    expect(notice).toMatchObject({
      title: 'piwin v0.2.8 is available',
      primaryAction: { label: 'Update now' },
    });
  });
});
