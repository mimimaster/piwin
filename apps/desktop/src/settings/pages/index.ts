/**
 * Settings page registration. Importing this module registers every section
 * page; the registry covers all sections (no legacy fallback remains).
 */
import { registerSettingsSection } from '../section-registry';
import { GeneralPage } from './general-page';
import { AppearancePage } from './appearance-page';
import { PermissionsPage } from './permissions-page';
import { SessionPage } from './session-page';
import { WebPage } from './web-page';
import { ModelsPage } from './models-page';
import { ToolsPage } from './tools-page';
import { SkillsPage } from './skills-page';
import { ExtensionsPage } from './extensions-page';
import { PromptsPage } from './prompts-page';
import { AutomationPage } from './automation-page';
import { PetsPage } from './pets-page';
import { UsagePage } from './usage-page';

registerSettingsSection('general', GeneralPage);
registerSettingsSection('appearance', AppearancePage);
registerSettingsSection('permissions', PermissionsPage);
registerSettingsSection('session', SessionPage);
registerSettingsSection('web', WebPage);
registerSettingsSection('models', ModelsPage);
registerSettingsSection('tools', ToolsPage);
registerSettingsSection('skills', SkillsPage);
registerSettingsSection('extensions', ExtensionsPage);
registerSettingsSection('prompts', PromptsPage);
registerSettingsSection('automation', AutomationPage);
registerSettingsSection('pets', PetsPage);
registerSettingsSection('usage', UsagePage);
