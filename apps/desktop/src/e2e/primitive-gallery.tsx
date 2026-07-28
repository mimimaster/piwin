/**
 * E2E-only primitive gallery (plan: quiet-workbench P0-B).
 * Renders the deterministic ui-kit primitive state matrix for visual
 * regression capture. Reached only through the build-time gated fixture
 * route in DesktopThemeRoot (`VITE_PIWIN_E2E_FIXTURES` + `#/e2e/primitives`);
 * never part of product navigation.
 *
 * Theme changes must flow through the DesktopThemeRoot callback passed in
 * as `onApplyTheme` — this fixture never mutates document style/dataset and
 * never mounts its own PiwinUiProvider.
 */
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import type { ThemeManifest } from '@piwin/contracts';
import {
  Button,
  Field,
  FieldCheckbox,
  IconButton,
  ListRow,
  Popover,
  StatusBadge,
  Surface,
} from '@piwin/ui-kit';
import {
  PIWIN_APPEARANCE_DARK,
  PIWIN_APPEARANCE_LIGHT,
} from '../appearance-tokens';

export type PrimitiveGalleryProps = {
  /** Root theme application callback owned by DesktopThemeRoot. */
  onApplyTheme: (theme: ThemeManifest) => void;
};

/** Fixture-local layout only; visual chrome stays in primitive CSS. */
const galleryRootStyle: CSSProperties = {
  minHeight: '100vh',
  padding: '24px',
  background: 'var(--canvas)',
  color: 'var(--text)',
  fontFamily: 'var(--font)',
};

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  flexWrap: 'wrap',
};

function GallerySection(props: { title: string; children: ReactNode }): ReactElement {
  return (
    <section style={{ marginBottom: '20px' }}>
      <h3 style={{ margin: '0 0 8px', fontSize: '13px', color: 'var(--muted)' }}>
        {props.title}
      </h3>
      <div style={rowStyle}>{props.children}</div>
    </section>
  );
}

export function PrimitiveGallery(props: PrimitiveGalleryProps): ReactElement {
  return (
    <div style={galleryRootStyle} data-testid="primitive-gallery">
      <GallerySection title="Theme (routes through DesktopThemeRoot)">
        <Button
          data-testid="gallery-theme-dark"
          onClick={() => props.onApplyTheme(PIWIN_APPEARANCE_DARK)}
        >
          Dark
        </Button>
        <Button
          data-testid="gallery-theme-light"
          onClick={() => props.onApplyTheme(PIWIN_APPEARANCE_LIGHT)}
        >
          Light
        </Button>
      </GallerySection>

      <GallerySection title="Button">
        <Button variant="primary" data-testid="gallery-button-primary">
          Primary
        </Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
        <Button variant="secondary" disabled>
          Disabled
        </Button>
      </GallerySection>

      <GallerySection title="IconButton">
        <IconButton label="Default icon action">＋</IconButton>
        <IconButton label="Pressed icon action" aria-pressed>
          ◉
        </IconButton>
        <IconButton label="Disabled icon action" disabled>
          ✕
        </IconButton>
        {/* Page-load autofocus keeps the focus-visible ring deterministic
            for the dark capture without keyboard scripting. */}
        <IconButton label="Focused icon action" autoFocus data-testid="gallery-focus-target">
          ◎
        </IconButton>
      </GallerySection>

      <GallerySection title="Field">
        <Field label="Text input">
          <input defaultValue="Deterministic value" />
        </Field>
        <Field label="Invalid input" error="Value is required">
          <input defaultValue="" placeholder="Empty" />
        </Field>
        <Field label="Disabled input">
          <input defaultValue="Read only" disabled />
        </Field>
        <Field label="Select">
          <select defaultValue="two">
            <option value="one">Option one</option>
            <option value="two">Option two</option>
          </select>
        </Field>
      </GallerySection>

      <GallerySection title="Field checkbox">
        <FieldCheckbox label="Unchecked" checked={false} onCheckedChange={() => undefined} />
        <FieldCheckbox label="Checked" checked onCheckedChange={() => undefined} />
        <FieldCheckbox label="Disabled" checked={false} disabled onCheckedChange={() => undefined} />
      </GallerySection>

      <GallerySection title="ListRow">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '220px' }}>
          <ListRow>Default row</ListRow>
          <ListRow selected>Selected row</ListRow>
        </div>
      </GallerySection>

      <GallerySection title="Surface">
        <Surface tone="base" style={{ padding: '12px' }} data-testid="gallery-surface-base">
          Base
        </Surface>
        <Surface tone="inset" style={{ padding: '12px' }}>
          Inset
        </Surface>
        <Surface tone="raised" style={{ padding: '12px' }}>
          Raised
        </Surface>
        <Surface tone="selected" style={{ padding: '12px' }}>
          Selected
        </Surface>
      </GallerySection>

      <GallerySection title="StatusBadge">
        <StatusBadge tone="neutral" label="Neutral" />
        <StatusBadge tone="running" label="Running" />
        <StatusBadge tone="success" label="Success" />
        <StatusBadge tone="warning" label="Warning" />
        <StatusBadge tone="danger" label="Danger" />
      </GallerySection>

      <GallerySection title="Portal">
        <Popover
          trigger={
            <Button variant="secondary" data-testid="gallery-portal-trigger">
              Open popover
            </Button>
          }
          label="Gallery popover"
          testId="gallery-portal"
        >
          <div style={{ padding: '8px 12px' }} data-testid="gallery-portal-body">
            Portal content follows the active theme.
          </div>
        </Popover>
      </GallerySection>
    </div>
  );
}
