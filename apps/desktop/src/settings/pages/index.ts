/**
 * Settings page registration. Importing this module registers every canonical section
 * page; the registry covers all 7 core sections.
 */
import { registerSettingsSection } from '../section-registry';
import { GeneralPage } from './general-page';
import { PermissionsPage } from './permissions-page';
import { ModelsPage } from './models-page';
import { AgentPage } from './agent-page';
import { ExtensionsPage } from './extensions-page';
import { KnowledgePage } from './knowledge-page';
import { SessionPage } from './session-page';

registerSettingsSection('general', GeneralPage);
registerSettingsSection('permissions', PermissionsPage);
registerSettingsSection('models', ModelsPage);
registerSettingsSection('agent', AgentPage);
registerSettingsSection('extensions', ExtensionsPage);
registerSettingsSection('knowledge', KnowledgePage);
registerSettingsSection('session', SessionPage);

