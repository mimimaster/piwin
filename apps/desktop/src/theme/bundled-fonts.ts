/**
 * Shipped default faces. File names under public/fonts/default carry no vendor
 * word; the CSS family is whatever the name table yields after sanitizing.
 */

export const BUNDLED_FONT_FILES = {
  sans: 'fonts/default/sans.ttf',
  mono: 'fonts/default/mono.ttf',
  serif: 'fonts/default/serif.ttf',
} as const;

export type BundledFontRole = keyof typeof BUNDLED_FONT_FILES;
