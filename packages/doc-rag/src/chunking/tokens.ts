import { getEncoding } from 'js-tiktoken';

const encoding = getEncoding('cl100k_base');

export function countTokens(text: string): number {
  return encoding.encode(text).length;
}
