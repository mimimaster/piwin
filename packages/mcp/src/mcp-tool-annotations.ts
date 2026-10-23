/** `annotations.readOnlyHint` from a listed tool, kept only when it is exactly true. */
export function readOnlyHintOf(tool: object): boolean | undefined {
  if (!('annotations' in tool)) {
    return undefined;
  }
  const annotations = tool.annotations;
  if (!annotations || typeof annotations !== 'object' || !('readOnlyHint' in annotations)) {
    return undefined;
  }
  return annotations.readOnlyHint === true ? true : undefined;
}
