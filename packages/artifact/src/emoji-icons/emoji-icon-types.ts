/** One flat SVG shape of a Tabler glyph: element name + attributes. */
export type EmojiIconGlyphNode = readonly [tag: string, attributes: Readonly<Record<string, string>>];

/** A run of text split around emoji that have an icon. */
export type EmojiTextSegment =
  | { kind: 'text'; text: string }
  | { kind: 'icon'; emoji: string; icon: string };
