/**
 * Type definitions for the Pi Extension Marketplace.
 */
import type {
  ExtensionCompatibilityTier,
  ExtensionDegradationTag,
  ExtensionSource,
} from '@piwin/contracts';

export type MarketTab = 'extensions' | 'installed';

export type MarketCategory = 'all' | 'bundled' | 'workflow' | 'tools' | 'guard';

export type MarketExtensionSource = ExtensionSource | 'npm' | 'git';

export type MarketSecretRequirement = {
  name: string;
  label: string;
  required: boolean;
};

export type MarketExtensionItem = {
  id: string;
  name: string;
  version: string;
  source: MarketExtensionSource;
  author: string;
  category: 'workflow' | 'tools' | 'guard';
  bundled: boolean;
  installed: boolean;
  active: boolean;
  descriptionZh: string;
  descriptionEn: string;
  tools: string[];
  hooks: string[];
  tier: ExtensionCompatibilityTier;
  degradations: ExtensionDegradationTag[];
};

export type MarketPluginItem = {
  id: string;
  name: string;
  version: string;
  category: 'tools' | 'workflow';
  bundled: boolean;
  installed: boolean;
  descriptionZh: string;
  descriptionEn: string;
  skillsCount: number;
  mcpCount: number;
  secrets: MarketSecretRequirement[];
};

export type MarketplaceToast = {
  text: string;
  type: 'info' | 'success' | 'warning' | 'error';
};
