import { useState, type ReactElement } from 'react';
import { IconClose, IconCheck, IconCopy } from '@piwin/ui-kit';
import { useHaptics } from '../../hooks/use-haptics.js';
import { MobileLayer } from '../../mobile-portal.js';
import type { MobileTranscriptMessage } from '../../hooks/use-mobile-host.js';

export type MobileShareModalProps = {
  isOpen: boolean;
  onClose: () => void;
  sessionTitle?: string | undefined;
  messages: MobileTranscriptMessage[];
};

function formatSessionAsMarkdown(title: string, messages: MobileTranscriptMessage[]): string {
  let output = `# ${title || 'Piwin 会话记录'}\n\n`;
  output += `> 导出时间：${new Date().toLocaleString()}\n\n---\n\n`;

  for (const msg of messages) {
    const roleName = msg.role === 'user' ? '👤 **User**' : '✨ **Piwin Agent**';
    output += `### ${roleName}\n\n${msg.text}\n\n`;
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      output += `> ⚙️ **执行工具**：${msg.toolCalls.map((t) => t.name).join(', ')}\n\n`;
    }
    output += `---\n\n`;
  }

  return output.trim();
}

export function MobileShareModal({
  isOpen,
  onClose,
  sessionTitle = '当前会话',
  messages,
}: MobileShareModalProps): ReactElement | null {
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const haptics = useHaptics();

  const markdownContent = formatSessionAsMarkdown(sessionTitle, messages);

  const handleCopyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(markdownContent);
      haptics.tap();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleNativeShare = async () => {
    haptics.tap();
    try {
      if (typeof navigator !== 'undefined' && 'share' in navigator) {
        await navigator.share({
          title: sessionTitle,
          text: markdownContent,
        });
        setShared(true);
        setTimeout(() => setShared(false), 2000);
      } else {
        await handleCopyMarkdown();
      }
    } catch {
      // user cancelled share
    }
  };

  const handleDownloadFile = () => {
    haptics.tap();
    const blob = new Blob([markdownContent], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${sessionTitle.replace(/[\s/\\:]/g, '_')}_transcript.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <MobileLayer isOpen={isOpen} onClose={onClose} overlayClassName="mobile-modal-overlay">
      <div className="mobile-share-sheet">
        {/* Header */}
        <div className="mobile-sheet-header">
          <div className="mobile-sheet-title-group">
            <span className="share-header-icon">📤</span>
            <div>
              <h3 className="mobile-sheet-title">导出与分享会话</h3>
              <p className="mobile-sheet-sub">{sessionTitle} · 共 {messages.length} 轮对话</p>
            </div>
          </div>
          <button
            type="button"
            className="mobile-drawer-close-btn"
            onClick={onClose}
            aria-label="关闭"
          >
            <IconClose size={18} />
          </button>
        </div>

        {/* Action Grid */}
        <div className="mobile-share-actions-list">
          <button
            type="button"
            className="mobile-share-action-card"
            onClick={() => void handleNativeShare()}
          >
            <div className="share-action-icon">🚀</div>
            <div className="share-action-info">
              <span className="share-action-name">系统原生分享</span>
              <span className="share-action-desc">发送到微信、Slack、备忘录或邮件</span>
            </div>
            {shared ? <IconCheck size={16} className="selected-check" /> : null}
          </button>

          <button
            type="button"
            className="mobile-share-action-card"
            onClick={() => void handleCopyMarkdown()}
          >
            <div className="share-action-icon">📋</div>
            <div className="share-action-info">
              <span className="share-action-name">复制完整 Markdown</span>
              <span className="share-action-desc">保留问答格式与代码块排版</span>
            </div>
            {copied ? <IconCheck size={16} className="selected-check" /> : <IconCopy size={16} />}
          </button>

          <button
            type="button"
            className="mobile-share-action-card"
            onClick={handleDownloadFile}
          >
            <div className="share-action-icon">💾</div>
            <div className="share-action-info">
              <span className="share-action-name">下载 .md 文件</span>
              <span className="share-action-desc">保存至手机本地文件系统</span>
            </div>
          </button>
        </div>
      </div>
    </MobileLayer>
  );
}
