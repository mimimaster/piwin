/**
 * Chromium Settings `lazy_load.ts`: Advanced pages and subpages.
 * Imported only through `ensureSettingsLazyLoaded()`.
 */
import { registerSettingsSection } from '../section-registry';
import { NotificationsPage } from './notifications-page';
import { PermissionsPage } from './permissions-page';
import { ModelsPage } from './models-page';
import { OauthPage } from './oauth-page';
import { HooksPage } from './hooks-page';
import { AgentPage } from './agent-page';
import { ArtifactSettingsPage } from './artifact-settings-page';
import { SubagentProfilesPage } from './subagents-page';
import { ExtensionsPage } from './extensions-page';
import { KnowledgePage } from './knowledge-page';
import { WebPage } from './web-page';
import { CodeSearchPage } from './code-search-page';
import { SessionPage } from './session-page';
import { SessionColdStoragePage } from './session-cold-storage-page';
import { UsagePage } from './usage-page';
import { ArchivePage } from './archive-page';

registerSettingsSection('notifications', NotificationsPage);
registerSettingsSection('permissions', PermissionsPage);
registerSettingsSection('models', ModelsPage);
registerSettingsSection('oauth', OauthPage);
registerSettingsSection('hooks', HooksPage);
registerSettingsSection('subagents', SubagentProfilesPage);
registerSettingsSection('agent', AgentPage);
registerSettingsSection('artifact', ArtifactSettingsPage);
registerSettingsSection('extensions', ExtensionsPage);
registerSettingsSection('web', WebPage);
registerSettingsSection('code-search', CodeSearchPage);
registerSettingsSection('knowledge', KnowledgePage);
registerSettingsSection('session', SessionPage);
registerSettingsSection('cold-storage', SessionColdStoragePage);
registerSettingsSection('usage', UsagePage);
registerSettingsSection('archive', ArchivePage);
