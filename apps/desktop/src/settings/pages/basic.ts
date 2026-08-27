/**
 * Chromium Settings "Basic" bundle: first-paint section only.
 */
import { registerSettingsSection } from '../section-registry';
import { GeneralPage } from './general-page';

registerSettingsSection('general', GeneralPage);
