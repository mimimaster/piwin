/**
 * Phone composer model picker (plan B): one tall bottom sheet with a provider
 * filter strip, a "recent" group, every model grouped by provider under sticky
 * headers, no thinking effort (that lives in the composer chip beside it, see
 * phone-effort-chip.tsx), and search at the
 * bottom (thumb reach, rides the keyboard).
 *
 * Anti-misclick contract (see use-tap-select.ts):
 * - a row is chosen only on a still pointer-up; a swipe or list scroll never selects;
 * - choosing a model leaves the sheet open (the selected state moves);
 * - the sheet closes only by dragging the top 48px handle down > 120px or a
 *   still tap on the scrim.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import type { ThinkingLevel } from '@piwin/contracts';
import type { ThinkingEffortModelOption } from './ThinkingEffortControl';
import { getSupportedThinkingLevels } from './model-thinking-policy';
import { pushRecentModel, readRecentModels, RECENT_MODELS_SHOWN } from './recent-models';
import { TAP_SLOP_PX, useTapSelect } from './use-tap-select';
import { PhoneEffortChip } from './phone-effort-chip';
import './phone-model-sheet.css';
import './phone-effort-chip.css';

export const SHEET_DRAG_CLOSE_PX = 120;
const ALL = '__all__';

type Props = {
  disabled: boolean;
  isZh: boolean;
  modelLabel: string;
  ultraEnabled: boolean;
  value: ThinkingLevel;
  onChange: (level: ThinkingLevel) => void;
  models: ThinkingEffortModelOption[];
  selectedModelKey: string;
  onSelectModel?: (key: string) => void;
};

function modelName(model: ThinkingEffortModelOption): string {
  const parts = model.label.split(/\s*\/\s*/);
  return parts[parts.length - 1] || model.label;
}

function providerOf(model: ThinkingEffortModelOption, isZh: boolean): string {
  const fromLabel = model.label.includes('/') ? model.label.split(/\s*\/\s*/)[0] : undefined;
  return model.providerName?.trim() || fromLabel || model.providerId || (isZh ? '其他' : 'Other');
}

export function PhoneModelSheet(props: Props): ReactElement {
  const { isZh, models } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState(ALL);
  const [recentKeys, setRecentKeys] = useState<string[]>(() => readRecentModels());
  const selected = models.find((model) => model.key === props.selectedModelKey);
  const levels = getSupportedThinkingLevels(selected, props.ultraEnabled);
  const effort = levels.includes(props.value) ? props.value : levels[0];

  const groups = useMemo(() => {
    const map = new Map<string, ThinkingEffortModelOption[]>();
    for (const model of models) {
      const key = providerOf(model, isZh);
      map.set(key, [...(map.get(key) ?? []), model]);
    }
    return map;
  }, [models, isZh]);

  const recent = useMemo(() => {
    const keys = recentKeys.filter((key) => models.some((model) => model.key === key));
    if (selected && !keys.includes(selected.key)) keys.unshift(selected.key);
    return keys
      .slice(0, RECENT_MODELS_SHOWN)
      .map((key) => models.find((model) => model.key === key))
      .filter((model): model is ThinkingEffortModelOption => model !== undefined);
  }, [recentKeys, models, selected]);

  const choose = (key: string): void => {
    setRecentKeys(pushRecentModel(key));
    props.onSelectModel?.(key);
    // Stays open on purpose: the operator closes it with the handle or the scrim.
  };
  const tap = useTapSelect(choose);

  const close = (): void => {
    tap.cancel();
    setOpen(false);
    setQuery('');
    setProvider(ALL);
  };

  // Drag-to-close lives on the 48px handle only, never on the list.
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ id: number; y: number; dy: number } | null>(null);
  const onHandleDown = (event: PointerEvent<HTMLDivElement>): void => {
    drag.current = { id: event.pointerId, y: event.clientY, dy: 0 };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onHandleMove = (event: PointerEvent<HTMLDivElement>): void => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId || !sheetRef.current) return;
    current.dy = Math.max(0, event.clientY - current.y);
    sheetRef.current.style.transform = current.dy > 0 ? `translateY(${current.dy}px)` : '';
  };
  const onHandleEnd = (): void => {
    const current = drag.current;
    drag.current = null;
    if (sheetRef.current) sheetRef.current.style.transform = '';
    if (current && current.dy > SHEET_DRAG_CLOSE_PX) close();
  };

  // Scrim closes on a still tap only: a swipe that ends on it does nothing.
  const scrimStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const q = query.trim().toLocaleLowerCase();
  const hits = q
    ? models.filter((model) =>
        `${model.label} ${providerOf(model, isZh)} ${model.key}`.toLocaleLowerCase().includes(q),
      )
    : [];

  const row = (
    model: ThinkingEffortModelOption,
    section: string,
    showProvider: boolean,
  ): ReactElement => {
    const on = model.key === selected?.key;
    const tags = [
      model.reasoning ? (isZh ? '推理' : 'Reasoning') : null,
      model.supportsImage ? (isZh ? '图像' : 'Vision') : null,
    ].filter((tag): tag is string => tag !== null);
    return (
      <div key={`${section}:${model.key}`} className={on ? 'pms-rowwrap is-on' : 'pms-rowwrap'}>
        <button
          type="button"
          role="option"
          aria-selected={on}
          className={tap.pressedKey === model.key ? 'pms-row is-pressing' : 'pms-row'}
          data-testid="pms-row"
          data-key={model.key}
          disabled={props.disabled}
          {...tap.rowProps(model.key)}
        >
          <span className="pms-row-main">
            <span className="pms-row-name">{modelName(model)}</span>
            {showProvider || tags.length > 0 ? (
              <span className="pms-row-meta">
                {showProvider ? <span>{providerOf(model, isZh)}</span> : null}
                {tags.map((tag) => (
                  <i key={tag} className="pms-tag">
                    {tag}
                  </i>
                ))}
              </span>
            ) : null}
          </span>
          {on ? (
            <svg className="pms-check" width="20" height="20" viewBox="0 0 20 20" aria-hidden>
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
      </div>
    );
  };

  const pillName = selected
    ? modelName(selected)
    : props.modelLabel || (isZh ? '选择模型' : 'Model');
  const pill = (
    <button
      type="button"
      className="thinking-effort-trigger pms-pill"
      data-testid="thinking-effort-trigger"
      disabled={props.disabled}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={`Model ${pillName}`}
      onClick={() => setOpen(true)}
    >
      <span className="thinking-effort-model pms-pill-name">{pillName}</span>
      <span className="thinking-effort-chevron" aria-hidden />
    </button>
  );

  const list = q ? (
    <section className="pms-group">
      {hits.map((model) => row(model, 'hits', true))}
      {hits.length === 0 ? (
        <div className="pms-empty">
          {isZh ? `没有匹配「${query.trim()}」的模型` : `No models match “${query.trim()}”`}
        </div>
      ) : null}
    </section>
  ) : (
    <>
      {provider === ALL && recent.length > 0 ? (
        <section className="pms-group" data-testid="pms-recent">
          <div className="pms-sec">{isZh ? '最近使用' : 'Recent'}</div>
          {recent.map((model) => row(model, 'recent', true))}
        </section>
      ) : null}
      {[...groups.entries()]
        .filter(([name]) => provider === ALL || name === provider)
        .map(([name, items]) => (
          <section key={name} className="pms-group">
            <div className="pms-sec">
              {name}
              <span>{items.length}</span>
            </div>
            {items.map((model) => row(model, name, false))}
          </section>
        ))}
    </>
  );

  const layer = open
    ? createPortal(
        <div className="pms-layer" data-testid="pms-layer">
          <div
            className="pms-scrim"
            data-testid="pms-scrim"
            onPointerDown={(event) => {
              scrimStart.current = { x: event.clientX, y: event.clientY };
            }}
            onPointerUp={(event) => {
              const start = scrimStart.current;
              scrimStart.current = null;
              if (
                start &&
                Math.hypot(event.clientX - start.x, event.clientY - start.y) <= TAP_SLOP_PX
              )
                close();
            }}
            onPointerCancel={() => {
              scrimStart.current = null;
            }}
          />
          <div
            className="pms-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={isZh ? '模型' : 'Model'}
            data-testid="pms-sheet"
            ref={sheetRef}
          >
            <div
              className="pms-handle"
              data-testid="pms-handle"
              onPointerDown={onHandleDown}
              onPointerMove={onHandleMove}
              onPointerUp={onHandleEnd}
              onPointerCancel={onHandleEnd}
            >
              <span className="pms-grab" aria-hidden />
              <span className="pms-title">{isZh ? '模型' : 'Model'}</span>
            </div>
            {q ? null : (
              <div className="pms-filter" role="tablist" aria-label={isZh ? '提供商' : 'Provider'}>
                {[ALL, ...groups.keys()].map((name) => (
                  <button
                    key={name}
                    type="button"
                    role="tab"
                    aria-selected={name === provider}
                    className={name === provider ? 'is-on' : ''}
                    onClick={() => setProvider(name)}
                  >
                    {name === ALL ? `${isZh ? '全部' : 'All'} ${models.length}` : name}
                  </button>
                ))}
              </div>
            )}
            <div
              className="pms-list"
              role="listbox"
              aria-label={isZh ? '模型' : 'Model'}
              data-testid="pms-list"
              onScroll={tap.cancel}
            >
              {models.length === 0 ? (
                <div className="pms-empty">{isZh ? '未配置模型' : 'No models configured'}</div>
              ) : (
                list
              )}
            </div>
            <label className="pms-search">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                <circle cx="7" cy="7" r="4.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <path
                  d="m10.6 10.6 3 3"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={
                  isZh ? `搜索 ${models.length} 个模型` : `Search ${models.length} models`
                }
                aria-label={isZh ? '搜索模型' : 'Search models'}
                data-testid="pms-search"
                spellCheck={false}
                autoComplete="off"
              />
            </label>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <div className="thinking-effort-control pms-control">
      {pill}
      <PhoneEffortChip
        disabled={props.disabled}
        isZh={isZh}
        levels={levels}
        value={effort}
        modelName={pillName}
        onChange={props.onChange}
      />
      {layer}
    </div>
  );
}
