/**
 * Settings section registry — single source of truth for section ids, nav
 * grouping, and label lookup. The settings shell nav and the shell-navigation
 * routes both read this table; adding a section means adding one row here
 * plus its page component.
 *
 * Section components: Basic (`general`) registers with the shell; Advanced
 * pages register through `ensureSettingsLazyLoaded()` (Chromium lazy_load).
 */
import type { ComponentType } from 'react';
import type { DesktopTranslator } from '../desktop-locale';

export type SettingsSectionId =
  | 'general'
  | 'notifications'
  | 'permissions'
  | 'models'
  | 'oauth'
  | 'hooks'
  | 'subagents'
  | 'agent'
  | 'extensions'
  | 'web'
  | 'knowledge'
  | 'session'
  | 'cold-storage'
  | 'usage'
  | 'archive';

/** Legacy settings deep links that now redirect to a canonical section. */
export const LEGACY_SETTINGS_REDIRECTS: Readonly<Record<string, SettingsSectionId>> = {
  // Alias redirects
  rules: 'extensions',
  agents: 'agent',
  'image-generation': 'models',

  // Consolidated sections into General
  appearance: 'general',
  shortcuts: 'general',
  pets: 'general',
  animations: 'general',

  // Consolidated sections into Models
  vision: 'models',

  // Consolidated sections into Extensions
  skills: 'extensions',
  tools: 'extensions',
  plugins: 'extensions',
  prompts: 'extensions',

  // Consolidated sections into Agent
  automation: 'agent',
  artifact: 'agent',
  'artifact-playground': 'agent',

  // Consolidated sections into Session
  runtime: 'session',
} as const;

export type LegacySettingsSectionId = keyof typeof LEGACY_SETTINGS_REDIRECTS;

export type SettingsGroupId = 'application' | 'agent' | 'integrations' | 'system';

export type SettingsSectionMeta = {
  id: SettingsSectionId;
  group: SettingsGroupId;
  /** Key into translator.settings.nav — not always equal to the section id. */
  labelKey: keyof DesktopTranslator['settings']['nav'];
  beta?: boolean;
};

/** Nav order within each group follows array order. */
export const SETTINGS_SECTIONS: readonly SettingsSectionMeta[] = [
  { id: 'general', group: 'application', labelKey: 'general' },
  { id: 'notifications', group: 'application', labelKey: 'notifications' },
  { id: 'permissions', group: 'application', labelKey: 'permissions' },
  { id: 'models', group: 'agent', labelKey: 'models' },
  { id: 'oauth', group: 'agent', labelKey: 'oauth' },
  { id: 'hooks', group: 'agent', labelKey: 'hooks' },
  { id: 'subagents', group: 'agent', labelKey: 'subagents' },
  { id: 'agent', group: 'agent', labelKey: 'agent' },
  { id: 'extensions', group: 'integrations', labelKey: 'extensions' },
  { id: 'web', group: 'integrations', labelKey: 'web' },
  { id: 'knowledge', group: 'integrations', labelKey: 'knowledge' },
  { id: 'session', group: 'system', labelKey: 'session' },
  { id: 'cold-storage', group: 'system', labelKey: 'coldStorage' },
  { id: 'usage', group: 'system', labelKey: 'usage' },
  { id: 'archive', group: 'system', labelKey: 'archive' },
] as const;

/** Group display order for the settings nav. */
export const SETTINGS_GROUPS: readonly {
  id: SettingsGroupId;
  labelKey: keyof Pick<
    DesktopTranslator['settings'],
    'application' | 'agent' | 'integrations' | 'system'
  >;
}[] = [
  { id: 'application', labelKey: 'application' },
  { id: 'agent', labelKey: 'agent' },
  { id: 'integrations', labelKey: 'integrations' },
  { id: 'system', labelKey: 'system' },
] as const;

export function isSettingsSectionId(value: string): value is SettingsSectionId {
  return SETTINGS_SECTIONS.some((section) => section.id === value);
}

export function isLegacySettingsSectionId(value: string): value is LegacySettingsSectionId {
  return Object.prototype.hasOwnProperty.call(LEGACY_SETTINGS_REDIRECTS, value);
}

/** Resolve legacy deep links (e.g. `rules`, `agents`) to their canonical section. */
export function normalizeSettingsSection(value: string): SettingsSectionId {
  const redirect = LEGACY_SETTINGS_REDIRECTS[value];
  if (redirect) {
    return redirect;
  }
  if (isSettingsSectionId(value)) {
    return value;
  }
  return 'general';
}

export function sectionsForGroup(group: SettingsGroupId): SettingsSectionMeta[] {
  return SETTINGS_SECTIONS.filter((section) => section.group === group);
}

/**
 * Section page components, registered per migration wave. Pages read their
 * dependencies via useSettings() — no props are passed through the registry.
 */
export type SettingsSectionComponent = ComponentType;

const sectionComponents = new Map<SettingsSectionId, SettingsSectionComponent>();

export function registerSettingsSection(
  id: SettingsSectionId,
  component: SettingsSectionComponent,
): void {
  sectionComponents.set(id, component);
}

export function getSettingsSection(id: SettingsSectionId): SettingsSectionComponent | undefined {
  return sectionComponents.get(id);
}
