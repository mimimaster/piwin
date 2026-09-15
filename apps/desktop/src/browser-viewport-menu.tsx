/**
 * Viewport preset menu, custom size editor, fit/100% zoom, and Agent-set note.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator, IconButton, NumberInput } from '@piwin/ui-kit';
import type { BrowserViewportConfig } from '@piwin/contracts';
import type { BrowserDisplayZoom } from './browser-display-box';
import { formatBrowserZoomPercent } from './browser-display-box';
import type { BrowserMirrorDensity } from './browser-mirror-density';
import {
  BROWSER_VIEWPORT_MENU_PRESETS,
  type BrowserViewportPresetId,
  type BrowserViewportSize,
} from './hooks/use-browser-viewport';
import { IconCheck, IconDeviceViewport } from './shell-icons';

export type BrowserViewportMenuCopy = {
  viewportTitle: string;
  viewportWidth: string;
  viewportHeight: string;
  viewportApply: string;
  viewportSetByAgent: string;
  viewportFit: string;
  viewportZoom100: string;
  densityLow: string;
  densityEncoded: string;
  densityRequired: string;
  densityProducer: string;
};

export type BrowserViewportPresetEntry = {
  id: BrowserViewportPresetId;
  label: string;
};

export type BrowserViewportMenuProps = {
  copy: BrowserViewportMenuCopy;
  interactEnabled: boolean;
  producer?: string | undefined;
  viewport: BrowserViewportConfig | undefined;
  viewportMode: BrowserViewportPresetId;
  viewportSize: BrowserViewportSize;
  viewportPresets: BrowserViewportPresetEntry[];
  displayZoom: BrowserDisplayZoom;
  displayScale: number;
  density: BrowserMirrorDensity;
  onSelectViewport: (preference: { id: BrowserViewportPresetId; width: number; height: number }) => void;
  onSelectDisplayZoom: (zoom: BrowserDisplayZoom) => void;
};

function densityTooltip(
  copy: BrowserViewportMenuCopy,
  density: BrowserMirrorDensity,
  producer: string,
): string {
  const parts = [copy.densityLow];
  if (density.widthRatio !== undefined && density.heightRatio !== undefined) {
    parts.push(
      `${copy.densityEncoded} ${String(Math.round(density.widthRatio * 100))}% · ${String(
        Math.round(density.heightRatio * 100),
      )}%`,
    );
  }
  if (density.requiredWidth !== undefined && density.requiredHeight !== undefined) {
    parts.push(
      `${copy.densityRequired} ${String(Math.round(density.requiredWidth))}×${String(
        Math.round(density.requiredHeight),
      )}`,
    );
  }
  if (producer.length > 0) parts.push(`${copy.densityProducer} ${producer}`);
  return parts.join(' · ');
}

export function BrowserViewportMenu(props: BrowserViewportMenuProps): ReactElement {
  const {
    copy,
    interactEnabled,
    producer,
    viewport,
    viewportMode,
    viewportSize,
    viewportPresets,
    displayZoom,
    displayScale,
    density,
    onSelectViewport,
    onSelectDisplayZoom,
  } = props;
  const [customWidth, setCustomWidth] = useState<number>(viewportSize.width);
  const [customHeight, setCustomHeight] = useState<number>(viewportSize.height);

  useEffect(() => {
    setCustomWidth(viewportSize.width);
    setCustomHeight(viewportSize.height);
  }, [viewportMode]);

  const follow = viewportMode === 'responsive';
  const chip =
    viewport === undefined
      ? null
      : follow
        ? `${String(viewport.width)}×${String(viewport.height)}`
        : `${String(viewport.width)}×${String(viewport.height)} · ${formatBrowserZoomPercent(displayScale)}`;

  return (
    <>
      <DropdownMenu
        testId="browser-session-viewport-menu"
        align="end"
        label={copy.viewportTitle}
        trigger={
          <IconButton
            className="browser-session-icon-btn"
            data-testid="browser-session-viewport-menu-btn"
            label={density.low ? densityTooltip(copy, density, producer ?? '') : copy.viewportTitle}
            size={28}
          >
            <>
              <IconDeviceViewport width={15} height={15} />
              {density.low ? (
                <span className="browser-session-density-dot" data-testid="browser-session-density-dot" />
              ) : null}
            </>
          </IconButton>
        }
      >
        {viewportPresets.map((preset) => (
          <DropdownMenuItem
            key={preset.id}
            testId={`browser-session-viewport-${preset.id}`}
            icon={
              viewportMode === preset.id ? (
                <IconCheck width={13} height={13} />
              ) : (
                <span className="browser-session-menu-spacer" />
              )
            }
            onSelect={() => {
              const size = BROWSER_VIEWPORT_MENU_PRESETS[preset.id];
              onSelectViewport({ id: preset.id, width: size.width, height: size.height });
            }}
          >
            {preset.label}
          </DropdownMenuItem>
        ))}
        {follow ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              testId="browser-session-viewport-fit"
              icon={
                displayZoom === 'fit' ? (
                  <IconCheck width={13} height={13} />
                ) : (
                  <span className="browser-session-menu-spacer" />
                )
              }
              onSelect={() => onSelectDisplayZoom('fit')}
            >
              {copy.viewportFit}
            </DropdownMenuItem>
            <DropdownMenuItem
              testId="browser-session-viewport-100"
              icon={
                displayZoom === '100' ? (
                  <IconCheck width={13} height={13} />
                ) : (
                  <span className="browser-session-menu-spacer" />
                )
              }
              onSelect={() => onSelectDisplayZoom('100')}
            >
              {copy.viewportZoom100}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenu>
      {viewportMode === 'custom' ? (
        <div className="browser-session-custom-viewport" data-testid="browser-session-custom-viewport">
          <NumberInput
            aria-label={copy.viewportWidth}
            testId="browser-session-custom-width"
            value={customWidth}
            min={200}
            max={3840}
            size="xs"
            onChange={(value) => {
              if (typeof value === 'number') setCustomWidth(value);
            }}
          />
          <NumberInput
            aria-label={copy.viewportHeight}
            testId="browser-session-custom-height"
            value={customHeight}
            min={200}
            max={2400}
            size="xs"
            onChange={(value) => {
              if (typeof value === 'number') setCustomHeight(value);
            }}
          />
          <IconButton
            className="browser-session-icon-btn"
            data-testid="browser-session-custom-apply"
            label={copy.viewportApply}
            size={24}
            disabled={!interactEnabled}
            onClick={() => {
              onSelectViewport({ id: 'custom', width: customWidth, height: customHeight });
            }}
          >
            <IconCheck width={13} height={13} />
          </IconButton>
        </div>
      ) : null}
      {chip ? (
        <span className="browser-session-viewport" data-testid="browser-session-viewport">
          {chip}
        </span>
      ) : null}
      {viewport?.setBy === 'agent' ? (
        <span className="browser-session-viewport-set-by" data-testid="browser-session-viewport-set-by">
          {copy.viewportSetByAgent}
        </span>
      ) : null}
    </>
  );
}
