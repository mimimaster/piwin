/**
 * Settings section registry — single source of truth for section ids, nav
 * grouping, and label lookup. The settings shell nav and the shell-navigation
 * routes both read this table; adding a section means adding one row here
 * plus its page component.
 *
 * Section components are registered lazily (registerSettingsSection) as the
 * SettingsPanel monolith is migrated wave by wave; until a section has a
 * registered page the shell falls back to the legacy panel branch.
 */
import type { ComponentType } from 'react';
import type { DesktopTranslator } from '../desktop-locale';

export type SettingsSectionId =
  | 'general'
  | 'appearance'
  | 'permissions'
  | 'models'
  | 'image-generation'
  | 'skills'
  | 'extensions'
  | 'prompts'
  | 'tools'
  | 'web'
  | 'session'
  | 'automation'
  | 'subagents'
  | 'pets'
  | 'usage';

/** Legacy settings deep links that now redirect to a canonical section. */
export const LEGACY_SETTINGS_REDIRECTS: Readonly<Record<string, SettingsSectionId>> = {
  rules: 'skills',
  agents: 'automation',
} as const;

export type LegacySettingsSectionId = keyof typeof LEGACY_SETTINGS_REDIRECTS;

export type SettingsGroupId =
  'application' | 'agent' | 'integrations' | 'system' | 'personalization';

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
  { id: 'permissions', group: 'application', labelKey: 'permissions' },
  { id: 'appearance', group: 'application', labelKey: 'appearance' },
  { id: 'models', group: 'agent', labelKey: 'models' },
  { id: 'image-generation', group: 'agent', labelKey: 'imageGeneration' },
  { id: 'session', group: 'agent', labelKey: 'sessions' },
  { id: 'skills', group: 'integrations', labelKey: 'skills' },
  { id: 'web', group: 'integrations', labelKey: 'web' },
  { id: 'tools', group: 'integrations', labelKey: 'tools' },
  { id: 'extensions', group: 'integrations', labelKey: 'extensions', beta: true },
  { id: 'prompts', group: 'integrations', labelKey: 'prompts' },
  { id: 'automation', group: 'system', labelKey: 'automation', beta: true },
  { id: 'subagents', group: 'system', labelKey: 'subagents', beta: true },
  { id: 'usage', group: 'system', labelKey: 'usage' },
  { id: 'pets', group: 'personalization', labelKey: 'pets' },
] as const;

/** Group display order for the settings nav. */
export const SETTINGS_GROUPS: readonly {
  id: SettingsGroupId;
  labelKey: keyof Pick<
    DesktopTranslator['settings'],
    'application' | 'agent' | 'integrations' | 'system' | 'personalization'
  >;
}[] = [
  { id: 'application', labelKey: 'application' },
  { id: 'agent', labelKey: 'agent' },
  { id: 'integrations', labelKey: 'integrations' },
  { id: 'system', labelKey: 'system' },
  { id: 'personalization', labelKey: 'personalization' },
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
