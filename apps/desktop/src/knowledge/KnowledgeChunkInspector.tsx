import type { ReactElement } from 'react';
import type { KnowledgeBaseSummary } from '@piwin/contracts';
import type { KnowledgeLocale } from './knowledge-base-copy.js';

export type KnowledgeChunkInspectorProps = {
  base: KnowledgeBaseSummary;
  locale: KnowledgeLocale;
  onSendToChat: (text: string) => void;
  onProduceFlashcards?: ((folderPath: string) => void) | undefined;
};

export function KnowledgeChunkInspector(props: KnowledgeChunkInspectorProps): ReactElement {
  const { base, locale } = props;
  const isZh = locale === 'zh-CN';
  const t = (en: string, cn: string) => (isZh ? cn : en);

  const isNotes = base.kind === 'notes';

  const chunks = isNotes
    ? [
        {
          id: '#NOTE-01',
          head: t('#NOTE-01 · Quick Note (2026-09-11)', '#NOTE-01 · 随手记 (2026-09-11)'),
          meta: t('Tokens: 95 · Cosine: 0.98', 'Tokens: 95 · 相似度: 0.98'),
          body: t(
            '“Architecture Note: Three-stage knowledge flywheel: Wiki (Concepts) -> Source Materials (Raw) -> Flashcards (FSRS spaced repetition).”',
            '“架构备忘：三阶心智飞轮收束：知识维基（熟肉概念）→ 信源资料（原始材料）→ 闪卡复习（FSRS 强化记忆）。”',
          ),
          quoteText: '> 架构备忘：三阶心智飞轮收束\n知识维基（熟肉概念）→ 信源资料（原始材料）→ 闪卡复习（FSRS 强化记忆）',
        },
      ]
    : [
        {
          id: '#CHUNK-0042',
          head: t(
            '#CHUNK-0042 · docs/AGENTS.md (Line 50-85)',
            '#CHUNK-0042 · docs/AGENTS.md (Line 50-85)',
          ),
          meta: t('Tokens: 380 · Cosine: 0.96', 'Tokens: 380 · 相似度: 0.96'),
          body: t(
            '“Hard cap: 1000 lines for any source file (.ts/.tsx/.rs/.css…). Split by responsibility before adding code to an oversized file... Proactive trigger: ~400 lines — plan the split when approaching it.”',
            '“Hard cap: 1000 lines for any source file (.ts/.tsx/.rs/.css…). Split by responsibility before adding code to an oversized file... Proactive trigger: ~400 lines — plan the split when approaching it.”',
          ),
          quoteText: '> docs/AGENTS.md (Line 50-85)\nHard cap: 1000 lines for any source file (.ts/.tsx/.rs/.css…)',
        },
        {
          id: '#CHUNK-0043',
          head: t(
            '#CHUNK-0043 · docs/adr/0003-dual-mode-host.md (Line 12-40)',
            '#CHUNK-0043 · docs/adr/0003-dual-mode-host.md (Line 12-40)',
          ),
          meta: t('Tokens: 410 · Cosine: 0.91', 'Tokens: 410 · 相似度: 0.91'),
          body: t(
            '“PiSdkAdapter and PiRpcAdapter implement the identical SessionBackend interface, isolating the UI shell completely from direct Pi dependencies.”',
            '“PiSdkAdapter and PiRpcAdapter implement the identical SessionBackend interface, isolating the UI shell completely from direct Pi dependencies.”',
          ),
          quoteText: '> docs/adr/0003-dual-mode-host.md (Line 12-40)\nPiSdkAdapter and PiRpcAdapter implement the identical SessionBackend interface',
        },
      ];

  return (
    <div className="chunk-inspector-section">
      <div
        style={{
          font: '600 12px var(--sans, sans-serif)',
          color: 'var(--text-2)',
          marginBottom: '10px',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>{t('Slices & Chunks Inspector', '切片检视器（Slices & Chunks Inspector）')}</span>
        <span style={{ fontSize: '11px', color: 'var(--text-4)' }}>
          {t(`Showing top ${chunks.length} representative slices`, `显示前 ${chunks.length} 个代表性切片`)}
        </span>
      </div>

      <div className="chunk-list" id="wb-chunk-list">
        {chunks.map((chunk) => (
          <div className="chunk-card" key={chunk.id}>
            <div className="chunk-head">
              <span>{chunk.head}</span>
              <span style={{ color: 'var(--pine, #3d7c5e)' }}>{chunk.meta}</span>
            </div>
            <div className="chunk-body">{chunk.body}</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                className="btn sm"
                onClick={() => props.onSendToChat(chunk.quoteText)}
              >
                {t('Bring to chat', '带到对话')}
              </button>
              {base.folderPath && props.onProduceFlashcards ? (
                <button
                  type="button"
                  className="btn sm pri"
                  onClick={() => props.onProduceFlashcards!(base.folderPath!)}
                >
                  {t('Make flashcard', '生成闪卡')}
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
