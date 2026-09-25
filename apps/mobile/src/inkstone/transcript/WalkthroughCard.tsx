import { useState, type ReactElement } from 'react';
import type { WalkthroughArtifact } from '@piwin/contracts';
import { Icon } from '../icons.js';
import { MobileMarkdown } from '../../components/chat/MobileMarkdown.js';

/** 走查报告 under the turn it describes; the Host writes it, the phone reads it. */
export function WalkthroughCard({ artifact }: { artifact: WalkthroughArtifact }): ReactElement {
  const [open, setOpen] = useState(false);
  const state =
    artifact.status === 'generating' ? '正在生成' : artifact.status === 'error' ? '生成失败' : '已就绪';
  return (
    <div className={`walkthrough-card ${artifact.status}`}>
      <button
        className="walkthrough-head"
        type="button"
        aria-expanded={open}
        disabled={artifact.status !== 'ready'}
        onClick={() => setOpen(!open)}
      >
        {artifact.status === 'generating' ? <span className="grind" /> : <Icon name="file" />}
        <b>走查报告</b>
        <span className="walkthrough-state">{state}</span>
        {artifact.status === 'ready' ? <Icon name="chevd" extra="chev" /> : null}
      </button>
      {artifact.status === 'error' ? <p className="walkthrough-error">{artifact.error.message}</p> : null}
      {artifact.status === 'ready' && open ? (
        <div className="walkthrough-body">
          <MobileMarkdown content={artifact.markdown} isStreaming={false} />
          {artifact.truncated === true ? <p className="muted">报告较长，已按 Host 上限截断。</p> : null}
        </div>
      ) : null}
    </div>
  );
}
