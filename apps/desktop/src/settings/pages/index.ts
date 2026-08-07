/**
 * Settings page registration. Importing this module registers every section
 * page; the registry covers all sections (no legacy fallback remains).
 */
import { registerSettingsSection } from '../section-registry';
import { GeneralPage } from './general-page';
import { AppearancePage } from './appearance-page';
import { PermissionsPage } from './permissions-page';
import { SessionPage } from './session-page';
import { SessionRuntimePage } from './session-runtime-page';
import { WebPage } from './web-page';
import { ModelsPage } from './models-page';
import { VisionPage } from './vision-page';
import { ImageGenerationPage } from './image-generation-page';
import { ArtifactPage } from './artifact-page';
import { ArtifactPlaygroundPage } from './artifact-playground-page';
import { ToolsPage } from './tools-page';
import { SkillsPage } from './skills-page';
import { ExtensionsPage } from './extensions-page';
import { PluginsPage } from './plugins-page';
import { PromptsPage } from './prompts-page';
import { AutomationPage } from './automation-page';
import { SubagentProfilesPage } from './subagents-page';
import { PetsPage } from './pets-page';
import { UsagePage } from './usage-page';
import { ShortcutsPage } from './shortcuts-page';

registerSettingsSection('general', GeneralPage);
registerSettingsSection('appearance', AppearancePage);
registerSettingsSection('permissions', PermissionsPage);
registerSettingsSection('session', SessionPage);
registerSettingsSection('runtime', SessionRuntimePage);
registerSettingsSection('web', WebPage);
registerSettingsSection('models', ModelsPage);
registerSettingsSection('vision', VisionPage);
registerSettingsSection('image-generation', ImageGenerationPage);
registerSettingsSection('artifact', ArtifactPage);
registerSettingsSection('artifact-playground', ArtifactPlaygroundPage);
registerSettingsSection('tools', ToolsPage);
registerSettingsSection('skills', SkillsPage);
registerSettingsSection('extensions', ExtensionsPage);
registerSettingsSection('plugins', PluginsPage);
registerSettingsSection('prompts', PromptsPage);
registerSettingsSection('automation', AutomationPage);
registerSettingsSection('subagents', SubagentProfilesPage);
registerSettingsSection('pets', PetsPage);
registerSettingsSection('usage', UsagePage);
registerSettingsSection('shortcuts', ShortcutsPage);
