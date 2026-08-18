/**
 * Flashcard artifact detection and HTML builder for Desktop chat view.
 */
import type { FlashcardReviewCard } from '@piwin/contracts';

/**
 * Hint-only detection of flashcard artifact fences.
 * A fence is treated as a flashcard artifact when its source contains a
 * `data-card-id="..."` (or single-quoted) attribute.
 */
export function isFlashcardArtifactSource(source: string): boolean {
  return /data-card-id=(?:"[^"]+"|'[^']+')/.test(source);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function cssSafeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '_');
}

function hasSource(card: FlashcardReviewCard): boolean {
  return Boolean(card.sourceFolder || card.sourceNoteId);
}

const FLASHCARD_STYLES = `<style>
.piwin-flashcard {
  max-width: 600px;
  margin: 12px auto;
  font-family: var(--piwin-artifact-font, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif);
  color: var(--piwin-artifact-text, #f1f5f9);
  box-sizing: border-box;
}
.piwin-flashcard * { box-sizing: border-box; }

.piwin-flashcard-batch {
  display: flex;
  flex-direction: column;
  gap: 16px;
  font-family: var(--piwin-artifact-font, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
}

.fc-card-frame {
  position: relative;
  background: var(--piwin-artifact-surface);
  border: 1px solid var(--piwin-artifact-border);
  border-radius: var(--piwin-artifact-radius);
  padding: 20px 22px;
  cursor: pointer;
  box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255, 255, 255, 0.04) inset;
  transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1);
  overflow: hidden;
}

.fc-card-frame:hover {
  border-color: color-mix(in srgb, var(--piwin-artifact-accent, #60a5fa) 45%, var(--piwin-artifact-border, rgba(255, 255, 255, 0.15)));
  box-shadow: 0 8px 28px -4px rgba(0, 0, 0, 0.35), 0 0 0 1px color-mix(in srgb, var(--piwin-artifact-accent, #60a5fa) 20%, transparent) inset;
  transform: translateY(-2px);
}

.fc-card-frame.is-revealed {
  border-color: color-mix(in srgb, var(--piwin-artifact-accent, #60a5fa) 30%, var(--piwin-artifact-border, rgba(255, 255, 255, 0.12)));
}

.fc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  gap: 8px;
  flex-wrap: wrap;
}

.fc-header-left {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.fc-deck-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--piwin-artifact-accent, #60a5fa);
  background: color-mix(in srgb, var(--piwin-artifact-accent, #60a5fa) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--piwin-artifact-accent, #60a5fa) 25%, transparent);
  padding: 2px 8px;
  border-radius: 9999px;
  letter-spacing: 0.02em;
}

.fc-tag {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  color: var(--piwin-artifact-muted, #94a3b8);
  background: color-mix(in srgb, var(--piwin-artifact-muted, #94a3b8) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--piwin-artifact-muted, #94a3b8) 18%, transparent);
  padding: 1px 6px;
  border-radius: 4px;
}

.fc-hint {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--piwin-artifact-muted, #94a3b8);
  background: color-mix(in srgb, var(--piwin-artifact-muted, #94a3b8) 8%, transparent);
  padding: 3px 8px;
  border-radius: 6px;
  transition: all 0.2s ease;
  user-select: none;
}

.fc-card-frame:hover .fc-hint {
  color: var(--piwin-artifact-accent, #60a5fa);
  background: color-mix(in srgb, var(--piwin-artifact-accent, #60a5fa) 12%, transparent);
}

.fc-sparkle {
  font-size: 11px;
  color: var(--piwin-artifact-accent, #60a5fa);
}

.fc-front-label, .fc-back-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--piwin-artifact-muted, #94a3b8);
  text-transform: uppercase;
  margin-bottom: 6px;
  opacity: 0.75;
}

.fc-front-text {
  font-size: 16px;
  font-weight: 500;
  line-height: 1.6;
  color: var(--piwin-artifact-text, #f8fafc);
}

.fc-divider {
  height: 1px;
  margin: 16px 0 12px;
  background: linear-gradient(90deg, transparent, var(--piwin-artifact-border, rgba(255, 255, 255, 0.14)) 15%, var(--piwin-artifact-border, rgba(255, 255, 255, 0.14)) 85%, transparent);
}

.fc-back {
  animation: fc-slide-in 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes fc-slide-in {
  from { opacity: 0; transform: translateY(-6px); }
  to { opacity: 1; transform: translateY(0); }
}

.fc-back-text {
  font-size: 15px;
  line-height: 1.65;
  color: var(--piwin-artifact-text, #e2e8f0);
  white-space: pre-wrap;
}

.fc-footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
}

.fc-src-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--piwin-artifact-muted, #94a3b8);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid color-mix(in srgb, var(--piwin-artifact-muted, #94a3b8) 20%, transparent);
  background: color-mix(in srgb, var(--piwin-artifact-muted, #94a3b8) 6%, transparent);
  transition: all 0.15s ease;
}

.fc-src-badge:hover {
  color: var(--piwin-artifact-accent, #60a5fa);
  border-color: color-mix(in srgb, var(--piwin-artifact-accent, #60a5fa) 35%, transparent);
}

.fc-src-popover-box {
  margin-top: 10px;
  padding: 12px 14px;
  background: var(--piwin-artifact-bg, rgba(15, 17, 23, 0.95));
  border: 1px solid var(--piwin-artifact-border, rgba(255, 255, 255, 0.12));
  border-radius: 10px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--piwin-artifact-muted, #94a3b8);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
}

.fc-src-popover-box button {
  margin-top: 8px;
  padding: 4px 10px;
  border: 1px solid var(--piwin-artifact-border, rgba(255, 255, 255, 0.15));
  border-radius: 6px;
  background: transparent;
  color: var(--piwin-artifact-accent, #60a5fa);
  cursor: pointer;
  font-size: 11px;
  font-weight: 500;
  transition: all 0.15s ease;
}

.fc-src-popover-box button:hover {
  background: color-mix(in srgb, var(--piwin-artifact-accent, #60a5fa) 12%, transparent);
}

.fc-rate {
  margin-top: 12px;
  background: var(--piwin-artifact-surface, rgba(28, 29, 36, 0.85));
  border: 1px solid var(--piwin-artifact-border, rgba(255, 255, 255, 0.08));
  border-radius: 12px;
  padding: 12px 14px;
  animation: fc-fade-in 0.25s ease-out;
}

@keyframes fc-fade-in {
  from { opacity: 0; transform: scale(0.98); }
  to { opacity: 1; transform: scale(1); }
}

.fc-rate-header {
  font-size: 11px;
  color: var(--piwin-artifact-muted, #94a3b8);
  margin-bottom: 8px;
  text-align: center;
  font-weight: 500;
  letter-spacing: 0.02em;
}

.fc-rate-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.fc-rate-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 8px 4px;
  border-radius: 8px;
  border: 1px solid var(--piwin-artifact-border, rgba(255, 255, 255, 0.1));
  background: rgba(255, 255, 255, 0.02);
  cursor: pointer;
  transition: all 0.16s cubic-bezier(0.4, 0, 0.2, 1);
  outline: none;
}

.fc-rate-btn .fc-btn-label {
  font-size: 13px;
  font-weight: 600;
}

.fc-rate-btn .fc-btn-sub {
  font-size: 10px;
  opacity: 0.65;
  letter-spacing: 0.02em;
}

.fc-rate-btn-again { color: #f87171; }
.fc-rate-btn-again:hover {
  background: rgba(239, 68, 68, 0.12);
  border-color: rgba(239, 68, 68, 0.4);
  box-shadow: 0 4px 12px rgba(239, 68, 68, 0.2);
  transform: translateY(-1px);
}

.fc-rate-btn-hard { color: #fbbf24; }
.fc-rate-btn-hard:hover {
  background: rgba(245, 158, 11, 0.12);
  border-color: rgba(245, 158, 11, 0.4);
  box-shadow: 0 4px 12px rgba(245, 158, 11, 0.2);
  transform: translateY(-1px);
}

.fc-rate-btn-good { color: #60a5fa; }
.fc-rate-btn-good:hover {
  background: rgba(59, 130, 246, 0.12);
  border-color: rgba(59, 130, 246, 0.4);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.2);
  transform: translateY(-1px);
}

.fc-rate-btn-easy { color: #34d399; }
.fc-rate-btn-easy:hover {
  background: rgba(16, 185, 129, 0.12);
  border-color: rgba(16, 185, 129, 0.4);
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.2);
  transform: translateY(-1px);
}

.fc-done {
  margin-top: 10px;
  padding: 9px 14px;
  background: color-mix(in srgb, var(--piwin-artifact-accent, #60a5fa) 10%, var(--piwin-artifact-surface, rgba(28, 29, 36, 0.8)));
  border: 1px solid color-mix(in srgb, var(--piwin-artifact-accent, #60a5fa) 25%, transparent);
  border-radius: 8px;
  font-size: 13px;
  color: var(--piwin-artifact-text, #f1f5f9);
  text-align: center;
  font-weight: 500;
  animation: fc-fade-in 0.2s ease-out;
}
</style>`;

export function renderFlashcardHtml(card: FlashcardReviewCard): string {
  return `${FLASHCARD_STYLES}\n${buildSingleCardHtml(card, 0)}`;
}

export function renderFlashcardBatchHtml(cards: FlashcardReviewCard[]): string {
  const cardsHtml = cards.map((card, index) => buildSingleCardHtml(card, index)).join('\n');
  return `${FLASHCARD_STYLES}
<div class="piwin-flashcard-batch">
${cardsHtml}
</div>`;
}

function buildSingleCardHtml(card: FlashcardReviewCard, _index?: number): string {
  const cardId = escapeHtml(card.cardId);
  const front = escapeHtml(card.front);
  const back = escapeHtml(card.back);
  const deck = escapeHtml(card.deck || 'General');
  const safeId = cssSafeId(card.cardId);
  const sourced = hasSource(card);
  const sourceFile = card.sourceFile ? escapeHtml(card.sourceFile) : '';
  const sourceLine = typeof card.sourceLine === 'number' ? card.sourceLine : 0;
  const sourceExcerpt = card.sourceExcerpt ? escapeHtml(card.sourceExcerpt) : '';
  const sourcePath = card.sourceFile
    ? `${sourceFile}${sourceLine > 0 ? `:${sourceLine}` : ''}`
    : card.sourceNoteId
      ? `note:${escapeHtml(card.sourceNoteId)}`
      : '';

  const tagsHtml = Array.isArray(card.tags) && card.tags.length > 0
    ? card.tags.map((t) => `<span class="fc-tag">${escapeHtml(t)}</span>`).join(' ')
    : '';

  const indicatorHtml = sourced
    ? `<span class="fc-src-badge fc-source-indicator" onclick="fcSource_${safeId}(event)">📎 来源出处</span>`
    : '';

  const popoverHtml = sourced
    ? `<div class="fc-src-popover-box fc-source-popover" style="display:none">
  <div style="font-weight:600;margin-bottom:4px;color:var(--piwin-artifact-text)">${sourcePath}</div>
  ${sourceExcerpt ? `<div style="white-space:pre-wrap">${sourceExcerpt}</div>` : ''}
  ${card.sourceFile ? `<button onclick="fcOpenSource_${safeId}(event)">打开源文件</button>` : ''}
</div>`
    : '';

  return `<div class="piwin-flashcard" data-card-id="${cardId}">
  <div class="fc-card-frame" onclick="fcReveal_${safeId}()">
    <div class="fc-header">
      <div class="fc-header-left">
        <span class="fc-deck-badge">🎴 ${deck}</span>
        ${tagsHtml}
      </div>
      <span class="fc-hint"><span class="fc-sparkle">✦</span> 点击查看答案</span>
    </div>

    <div class="fc-front-label">QUESTION</div>
    <div class="fc-front-text">${front}</div>

    <div class="fc-back" style="display:none">
      <div class="fc-divider"></div>
      <div class="fc-back-label">ANSWER</div>
      <div class="fc-back-text">${back}</div>
    </div>

    ${indicatorHtml ? `<div class="fc-footer">${indicatorHtml}</div>` : ''}
  </div>
  ${popoverHtml}
  ${card.ordinal > 0 ? `<div class="fc-rate" style="display:none">
    <div class="fc-rate-header">本次复习掌握程度 (FSRS 评分)</div>
    <div class="fc-rate-grid">
      <button type="button" class="fc-rate-btn fc-rate-btn-again" onclick="fcRate_${safeId}('again',this)">
        <span class="fc-btn-label">忘了</span>
        <span class="fc-btn-sub">Again</span>
      </button>
      <button type="button" class="fc-rate-btn fc-rate-btn-hard" onclick="fcRate_${safeId}('hard',this)">
        <span class="fc-btn-label">较难</span>
        <span class="fc-btn-sub">Hard</span>
      </button>
      <button type="button" class="fc-rate-btn fc-rate-btn-good" onclick="fcRate_${safeId}('good',this)">
        <span class="fc-btn-label">记住了</span>
        <span class="fc-btn-sub">Good</span>
      </button>
      <button type="button" class="fc-rate-btn fc-rate-btn-easy" onclick="fcRate_${safeId}('easy',this)">
        <span class="fc-btn-label">简单</span>
        <span class="fc-btn-sub">Easy</span>
      </button>
    </div>
  </div>
  <div class="fc-done" style="display:none"></div>` : ''}
</div>
<script>
function fcReveal_${safeId}() {
  var root = document.querySelector('[data-card-id="${cardId}"]');
  if (!root) return;
  var frame = root.querySelector('.fc-card-frame');
  if (frame) frame.classList.add('is-revealed');
  var back = root.querySelector('.fc-back');
  if (back) back.style.display = 'block';
  var rate = root.querySelector('.fc-rate');
  if (rate) rate.style.display = 'block';
  var hint = root.querySelector('.fc-hint');
  if (hint) hint.style.display = 'none';
}
function fcRate_${safeId}(rating, button) {
  var root = document.querySelector('[data-card-id="${cardId}"]');
  if (!root) return;
  var label = button.querySelector('.fc-btn-label') ? button.querySelector('.fc-btn-label').textContent : rating;
  var posted = window.piwinArtifact
    ? window.piwinArtifact.postAction('flashcard/rate', { cardId: '${cardId}', rating: rating })
    : false;
  var rate = root.querySelector('.fc-rate');
  if (rate) rate.style.display = 'none';
  var done = root.querySelector('.fc-done');
  if (done) {
    done.style.display = 'block';
    done.textContent = posted
      ? '✓ 已记录评分：' + label + ' · 已同步至复习计划'
      : '评分未发送（此环境不支持交互）';
  }
}
${sourced ? `function fcSource_${safeId}(event) {
  event.stopPropagation();
  var root = document.querySelector('[data-card-id="${cardId}"]');
  if (!root) return;
  var popover = root.querySelector('.fc-source-popover');
  if (popover) {
    popover.style.display = popover.style.display === 'none' ? 'block' : 'none';
  }
}
${card.sourceFile ? `function fcOpenSource_${safeId}(event) {
  event.stopPropagation();
  var posted = window.piwinArtifact
    ? window.piwinArtifact.postAction('flashcard/open-source', { cardId: '${cardId}', openFile: true })
    : false;
  if (!posted) {
    alert('打开文件未发送（此环境不支持交互）');
  }
}` : ''}` : ''}
</script>`;
}
