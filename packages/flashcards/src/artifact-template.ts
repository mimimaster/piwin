/**
 * Flip-card HTML template for chat-embedded flashcards (ADR 0018 S5c, doc-flashcards §12).
 * Rendered inside the piwin artifact sandbox; rating buttons call
 * window.piwinArtifact.postAction('flashcard/rate', ...) which the desktop
 * validates and maps to the flashcards/rate HostCommand.
 *
 * Source interaction (doc-flashcards §12.1):
 * - Sourced cards (sourceFolder or sourceNoteId present): back face has a
 *   subtle indicator; clicking it toggles a popover with excerpt + path +
 *   line. If sourceFile is present, popover has an "Open file" button that
 *   posts 'flashcard/open-source'.
 * - Open cards: no indicator, no popover.
 *
 * Multi-card batch: `buildFlashcardBatchArtifactHtml` stacks flip units, each
 * with its own `cardId` in rate/open payloads.
 *
 * Pure string builder — no DOM. Inline styles only (artifact CSP allows
 * inline style/script, blocks all external resources). Style is hardcoded
 * in v1 (doc-flashcards §12.1, H1).
 */
import type { FlashcardRecord } from '@piwin/contracts';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Card id → JS identifier fragment (card ids are already sanitized). */
function cssSafeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '_');
}

/** Whether a card has source attribution (folder or note). */
function hasSource(card: FlashcardRecord): boolean {
  return Boolean(card.sourceFolder || card.sourceNoteId);
}

/**
 * Build a self-contained flip card. Click card → reveal answer + rating row;
 * rating click posts the whitelisted action and locks the card.
 */
export function buildFlashcardArtifactHtml(card: FlashcardRecord): string {
  return buildSingleCardHtml(card, 0);
}

/**
 * Build stacked flip cards for a batch. Each card is a self-contained unit
 * with its own `cardId` in rate/open payloads (doc-flashcards §9.3, §12.1).
 */
export function buildFlashcardBatchArtifactHtml(cards: FlashcardRecord[]): string {
  const cardsHtml = cards.map((card, index) => buildSingleCardHtml(card, index)).join('\n');
  return `<div class="piwin-flashcard-batch" style="display:flex;flex-direction:column;gap:16px;font-family:var(--piwin-artifact-font)">
${cardsHtml}
</div>`;
}

function buildSingleCardHtml(card: FlashcardRecord, index: number): string {
  const cardId = escapeHtml(card.id);
  const front = escapeHtml(card.front);
  const back = escapeHtml(card.back);
  const deck = escapeHtml(card.deck);
  const safeId = cssSafeId(card.id);
  const sourced = hasSource(card);
  const sourceFile = card.sourceFile ? escapeHtml(card.sourceFile) : '';
  const sourceLine = typeof card.sourceLine === 'number' ? card.sourceLine : 0;
  const sourceExcerpt = card.sourceExcerpt ? escapeHtml(card.sourceExcerpt) : '';
  const sourcePath = card.sourceFile
    ? `${sourceFile}${sourceLine > 0 ? `:${sourceLine}` : ''}`
    : card.sourceNoteId
      ? `note:${escapeHtml(card.sourceNoteId)}`
      : '';

  const indicatorHtml = sourced
    ? `<span class="fc-source-indicator" style="font-size:11px;color:var(--piwin-artifact-muted);cursor:pointer;text-decoration:underline dotted" onclick="fcSource_${safeId}(event)">📎</span>`
    : '';

  const popoverHtml = sourced
    ? `<div class="fc-source-popover" style="display:none;margin-top:8px;padding:10px;background:var(--piwin-artifact-bg);border:1px solid var(--piwin-artifact-border);border-radius:6px;font-size:12px;line-height:1.5;color:var(--piwin-artifact-muted)">
  <div style="font-weight:600;margin-bottom:4px">${sourcePath}</div>
  ${sourceExcerpt ? `<div style="white-space:pre-wrap">${sourceExcerpt}</div>` : ''}
  ${card.sourceFile ? `<button style="margin-top:6px;padding:4px 10px;border:1px solid var(--piwin-artifact-border);border-radius:4px;background:transparent;color:var(--piwin-artifact-accent);cursor:pointer;font-size:11px" onclick="fcOpenSource_${safeId}(event)">打开文件</button>` : ''}
</div>`
    : '';

  return `<div class="piwin-flashcard" data-card-id="${cardId}" style="max-width:560px;margin:0 auto">
  <div class="fc-shell" style="background:var(--piwin-artifact-surface);border:1px solid var(--piwin-artifact-border);border-radius:var(--piwin-artifact-radius);padding:20px;cursor:pointer" onclick="fcReveal_${safeId}()">
    <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--piwin-artifact-muted);margin-bottom:12px">
      <span>🃏 ${deck}</span><span class="fc-hint">点击查看答案</span>
    </div>
    <div style="font-size:17px;line-height:1.6">${front}</div>
    <div class="fc-back" style="display:none;margin-top:14px;padding-top:14px;border-top:1px dashed var(--piwin-artifact-border);font-size:15px;line-height:1.6;color:var(--piwin-artifact-text)">${back}</div>
    <div style="display:flex;justify-content:flex-end;margin-top:8px">${indicatorHtml}</div>
  </div>
  ${popoverHtml}
  <div class="fc-rate" style="display:none;gap:8px;margin-top:10px;justify-content:center">
    <button style="flex:1;padding:8px 0;border:1px solid var(--piwin-artifact-border);border-radius:6px;background:transparent;color:#e5484d;cursor:pointer" onclick="fcRate_${safeId}('again',this)">忘了</button>
    <button style="flex:1;padding:8px 0;border:1px solid var(--piwin-artifact-border);border-radius:6px;background:transparent;color:#f5a623;cursor:pointer" onclick="fcRate_${safeId}('hard',this)">较难</button>
    <button style="flex:1;padding:8px 0;border:1px solid var(--piwin-artifact-border);border-radius:6px;background:transparent;color:var(--piwin-artifact-accent);cursor:pointer" onclick="fcRate_${safeId}('good',this)">记住了</button>
    <button style="flex:1;padding:8px 0;border:1px solid var(--piwin-artifact-border);border-radius:6px;background:transparent;color:#30a46c;cursor:pointer" onclick="fcRate_${safeId}('easy',this)">简单</button>
  </div>
  <div class="fc-done" style="display:none;margin-top:10px;text-align:center;font-size:13px;color:var(--piwin-artifact-muted)"></div>
</div>
<script>
function fcReveal_${safeId}() {
  var root = document.querySelector('[data-card-id="${cardId}"]');
  if (!root) return;
  root.querySelector('.fc-back').style.display = 'block';
  root.querySelector('.fc-rate').style.display = 'flex';
  root.querySelector('.fc-hint').textContent = '';
}
function fcRate_${safeId}(rating, button) {
  var root = document.querySelector('[data-card-id="${cardId}"]');
  if (!root) return;
  var posted = window.piwinArtifact
    ? window.piwinArtifact.postAction('flashcard/rate', { cardId: '${cardId}', rating: rating })
    : false;
  root.querySelector('.fc-rate').style.display = 'none';
  var done = root.querySelector('.fc-done');
  done.style.display = 'block';
  done.textContent = posted
    ? '已记录：' + button.textContent + ' ✓'
    : '评分未发送（此环境不支持交互）';
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
