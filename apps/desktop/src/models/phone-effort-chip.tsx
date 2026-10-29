/**
 * Phone composer thinking-effort chip (option B): sits beside the model chip,
 * shows a bulb + the current level, and opens a small anchored popover listing
 * only the level names (one compact row each, no descriptions). The model sheet carries no effort control on phone.
 *
 * - no supported levels: renders nothing;
 * - exactly two levels: a plain toggle chip (still tap flips the level);
 * - otherwise: popover; a level is chosen on a still pointer-up (useTapSelect),
 *   the popover closes after a pick, and an outside tap closes it only when it
 *   is a still tap (a swipe that ends outside does nothing).
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import type { ThinkingLevel } from '@piwin/contracts';
import { formatThinkingLabel } from '../usage/usage-panel-statistics.js';
import { TAP_SLOP_PX, useTapSelect } from './use-tap-select';

type Props = {
  disabled: boolean;
  isZh: boolean;
  levels: readonly ThinkingLevel[];
  value: ThinkingLevel | undefined;
  modelName: string;
  onChange: (level: ThinkingLevel) => void;
};

const POP_GAP_PX = 8;
const POP_EDGE_PX = 12;
const POP_WIDTH_PX = 168;

function Bulb(): ReactElement {
  return (
    <svg className="pec-bulb" width="15" height="15" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M8 1.9a4.4 4.4 0 0 0-2.7 7.9c.5.4.8 1 .8 1.6v.5h3.8v-.5c0-.6.3-1.2.8-1.6A4.4 4.4 0 0 0 8 1.9ZM6.3 14h3.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PhoneEffortChip(props: Props): ReactElement | null {
  const { isZh, levels } = props;
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ left: number; bottom: number }>({ left: POP_EDGE_PX, bottom: 120 });
  const scrimStart = useRef<{ x: number; y: number } | null>(null);
  const tap = useTapSelect((level) => {
    props.onChange(level as ThinkingLevel);
    setOpen(false);
  });

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (levels.length === 0) return null;
  const current = props.value !== undefined && levels.includes(props.value) ? props.value : levels[0]!;
  const word = isZh ? '思考' : 'Thinking';
  const label = formatThinkingLabel(current, isZh);

  if (levels.length === 2) {
    const other = levels[0] === current ? levels[1]! : levels[0]!;
    const on = current !== 'off' && current === levels[levels.length - 1];
    return (
      <button
        type="button"
        className={on ? 'thinking-effort-trigger pec-chip is-on' : 'thinking-effort-trigger pec-chip'}
        data-testid="pec-toggle"
        aria-pressed={on}
        aria-label={`${word} ${label}`}
        disabled={props.disabled}
        onClick={() => props.onChange(other)}
      >
        <Bulb />
        <span className="pec-word">{word}</span>
        <span className="pec-level">{label}</span>
      </button>
    );
  }

  const openAt = (rect: DOMRect): void => {
    const left = Math.min(Math.max(POP_EDGE_PX, rect.left - 10), window.innerWidth - POP_WIDTH_PX - POP_EDGE_PX);
    setAnchor({ left: Math.max(POP_EDGE_PX, left), bottom: window.innerHeight - rect.top + POP_GAP_PX });
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        className="thinking-effort-trigger pec-chip"
        data-testid="pec-chip"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${word} ${label}`}
        disabled={props.disabled}
        onClick={(event) => (open ? setOpen(false) : openAt(event.currentTarget.getBoundingClientRect()))}
      >
        <Bulb />
        <span className="pec-word">{word}</span>
        <span className="pec-level">{label}</span>
      </button>
      {open
        ? createPortal(
            <div className="pec-layer" data-testid="pec-layer">
              <div
                className="pec-scrim"
                data-testid="pec-scrim"
                onPointerDown={(event) => {
                  scrimStart.current = { x: event.clientX, y: event.clientY };
                }}
                onPointerUp={(event) => {
                  const start = scrimStart.current;
                  scrimStart.current = null;
                  if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) <= TAP_SLOP_PX)
                    setOpen(false);
                }}
                onPointerCancel={() => {
                  scrimStart.current = null;
                }}
              />
              <div
                className="pec-pop"
                role="dialog"
                aria-label={isZh ? '思考强度' : 'Thinking effort'}
                data-testid="pec-pop"
                style={anchor}
              >
                <div className="pec-pop-title">
                  <span>{isZh ? '思考强度' : 'Thinking effort'}</span>
                  <small>{props.modelName}</small>
                </div>
                <div role="radiogroup" aria-label={isZh ? '思考强度' : 'Thinking effort'}>
                  {levels.map((level) => (
                    <button
                      key={level}
                      type="button"
                      role="radio"
                      aria-checked={level === current}
                      className={[
                        'pec-item',
                        level === current ? 'is-on' : '',
                        tap.pressedKey === level ? 'is-pressing' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      data-testid={`pec-level-${level}`}
                      {...tap.rowProps(level)}
                    >
                      <span className="pec-item-name">{formatThinkingLabel(level, isZh)}</span>
                      {level === current ? (
                        <svg className="pec-check" width="18" height="18" viewBox="0 0 20 20" aria-hidden>
                          <path
                            d="M4.5 10.5 8.3 14 15.5 6.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
