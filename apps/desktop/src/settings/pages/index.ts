/**
 * Settings page registration. Importing this module registers every canonical section.
 */
import { registerSettingsSection } from '../section-registry';
import { GeneralPage } from './general-page';
import { PermissionsPage } from './permissions-page';
import { ModelsPage } from './models-page';
import { AgentPage } from './agent-page';
import { ExtensionsPage } from './extensions-page';
import { KnowledgePage } from './knowledge-page';
import { WebPage } from './web-page';
import { SessionPage } from './session-page';
import { SessionColdStoragePage } from './session-cold-storage-page';
import { UsagePage } from './usage-page';
import { ArchivePage } from './archive-page';

registerSettingsSection('general', GeneralPage);
registerSettingsSection('permissions', PermissionsPage);
registerSettingsSection('models', ModelsPage);
registerSettingsSection('agent', AgentPage);
registerSettingsSection('extensions', ExtensionsPage);
registerSettingsSection('web', WebPage);
registerSettingsSection('knowledge', KnowledgePage);
registerSettingsSection('session', SessionPage);
registerSettingsSection('cold-storage', SessionColdStoragePage);
registerSettingsSection('usage', UsagePage);
registerSettingsSection('archive', ArchivePage);
