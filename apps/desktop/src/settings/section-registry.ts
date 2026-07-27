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
  | 'models'
  | 'agents'
  | 'rules'
  | 'skills'
  | 'extensions'
  | 'prompts'
  | 'tools'
  | 'web'
  | 'session'
  | 'memory'
  | 'automation'
  | 'pets';

export type SettingsGroupId =
  | 'application'
  | 'agent'
  | 'integrations'
  | 'system'
  | 'personalization';

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
  { id: 'appearance', group: 'application', labelKey: 'appearance' },
  { id: 'models', group: 'agent', labelKey: 'models' },
  { id: 'session', group: 'agent', labelKey: 'sessions' },
  { id: 'memory', group: 'agent', labelKey: 'memory', beta: true },
  { id: 'rules', group: 'agent', labelKey: 'rules' },
  { id: 'skills', group: 'integrations', labelKey: 'skills' },
  { id: 'web', group: 'integrations', labelKey: 'web' },
  { id: 'tools', group: 'integrations', labelKey: 'tools' },
  { id: 'extensions', group: 'integrations', labelKey: 'extensions', beta: true },
  { id: 'prompts', group: 'integrations', labelKey: 'prompts' },
  { id: 'automation', group: 'system', labelKey: 'automation', beta: true },
  { id: 'agents', group: 'system', labelKey: 'agents', beta: true },
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

export function getSettingsSection(
  id: SettingsSectionId,
): SettingsSectionComponent | undefined {
  return sectionComponents.get(id);
}
