import { ARTIFACT_TRAILING_MARKDOWN } from './types.js';

export function wrapArtifactMarkdown(language: string, source: string): string {
  return `\`\`\`${language}\n${source}\n\`\`\`\n\n${ARTIFACT_TRAILING_MARKDOWN}\n`;
}
