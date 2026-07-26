/**
 * Flip-card HTML template for chat-embedded flashcards (ADR 0018 S5c).
 * Rendered inside the piwin artifact sandbox; rating buttons call
 * window.piwinArtifact.postAction('flashcard/rate', ...) which the desktop
 * validates and maps to the flashcards/rate HostCommand.
 *
 * Pure string builder — no DOM. Inline styles only (artifact CSP allows
 * inline style/script, blocks all external resources).
 */
import type { FlashcardRecord } from '@piwin/contracts';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * Build a self-contained flip card. Click card → reveal answer + rating row;
 * rating click posts the whitelisted action and locks the card.
 */
export function buildFlashcardArtifactHtml(card: FlashcardRecord): string {
  const cardId = escapeHtml(card.id);
  const front = escapeHtml(card.front);
  const back = escapeHtml(card.back);
  const deck = escapeHtml(card.deck);

  return `<div class="piwin-flashcard" data-card-id="${cardId}" style="max-width:560px;margin:0 auto;font-family:var(--piwin-artifact-font)">
  <div class="fc-shell" style="background:var(--piwin-artifact-surface);border:1px solid var(--piwin-artifact-border);border-radius:var(--piwin-artifact-radius);padding:20px;cursor:pointer" onclick="fcReveal_${cssSafeId(card.id)}()">
    <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--piwin-artifact-muted);margin-bottom:12px">
      <span>🃏 ${deck}</span><span class="fc-hint">点击查看答案</span>
    </div>
    <div style="font-size:17px;line-height:1.6">${front}</div>
    <div class="fc-back" style="display:none;margin-top:14px;padding-top:14px;border-top:1px dashed var(--piwin-artifact-border);font-size:15px;line-height:1.6;color:var(--piwin-artifact-text)">${back}</div>
  </div>
  <div class="fc-rate" style="display:none;gap:8px;margin-top:10px;justify-content:center">
    <button style="flex:1;padding:8px 0;border:1px solid var(--piwin-artifact-border);border-radius:6px;background:transparent;color:#e5484d;cursor:pointer" onclick="fcRate_${cssSafeId(card.id)}('again',this)">忘了</button>
    <button style="flex:1;padding:8px 0;border:1px solid var(--piwin-artifact-border);border-radius:6px;background:transparent;color:#f5a623;cursor:pointer" onclick="fcRate_${cssSafeId(card.id)}('hard',this)">较难</button>
    <button style="flex:1;padding:8px 0;border:1px solid var(--piwin-artifact-border);border-radius:6px;background:transparent;color:var(--piwin-artifact-accent);cursor:pointer" onclick="fcRate_${cssSafeId(card.id)}('good',this)">记住了</button>
    <button style="flex:1;padding:8px 0;border:1px solid var(--piwin-artifact-border);border-radius:6px;background:transparent;color:#30a46c;cursor:pointer" onclick="fcRate_${cssSafeId(card.id)}('easy',this)">简单</button>
  </div>
  <div class="fc-done" style="display:none;margin-top:10px;text-align:center;font-size:13px;color:var(--piwin-artifact-muted)"></div>
</div>
<script>
function fcReveal_${cssSafeId(card.id)}() {
  var root = document.querySelector('[data-card-id="${cardId}"]');
  if (!root) return;
  root.querySelector('.fc-back').style.display = 'block';
  root.querySelector('.fc-rate').style.display = 'flex';
  root.querySelector('.fc-hint').textContent = '';
}
function fcRate_${cssSafeId(card.id)}(rating, button) {
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
</script>`;
}

/** Card id → JS identifier fragment (card ids are already sanitized). */
function cssSafeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '_');
}
