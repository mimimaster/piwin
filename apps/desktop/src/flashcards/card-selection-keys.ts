export type CardTutorInvokeSource = 'pointer' | 'keyboard';

function elementFrom(node: Node | null): Element | null {
  if (node instanceof Element) return node;
  return node?.parentElement ?? null;
}

function isForeignControl(node: Node): boolean {
  const el = elementFrom(node);
  if (!el) return false;
  if (el.closest('textarea, input, select, [contenteditable="true"]')) return true;
  const button = el.closest('button');
  if (button && !button.closest('[data-testid="card-selection-primary"]')) return true;
  return false;
}

/** Enter/Space invoke the popover only inside the card, popover, or a focused card. */
export function shouldHandleSelectionInvokeKey(
  event: KeyboardEvent,
  scope: Element | null,
): boolean {
  if (event.repeat) return false;
  if (event.key !== 'Enter' && event.key !== ' ') return false;
  const target = event.target;
  if (target instanceof Element && target.closest('[data-testid="card-selection-popover"]')) {
    return true;
  }
  if (!scope) return false;
  if (target instanceof Node && (target === scope || scope.contains(target))) {
    return !isForeignControl(target);
  }
  const active = document.activeElement;
  if (
    (target === document || target === document.body || target === document.documentElement) &&
    active instanceof Node &&
    (active === scope || scope.contains(active))
  ) {
    return !isForeignControl(active);
  }
  return false;
}
