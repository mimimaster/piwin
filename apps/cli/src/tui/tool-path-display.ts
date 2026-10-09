/**
 * Tool lines name the files they touch by absolute Host path, which fills the
 * line before the part that matters. Inside the project the leading directory
 * carries no information, so it is dropped.
 */
export function shortenPaths(text: string, roots: readonly string[]): string {
  let shortened = text;
  // Longest root first: a worktree root nested in another root must win.
  for (const root of [...roots].sort((a, b) => b.length - a.length)) {
    shortened = dropRoot(shortened, root);
  }
  return shortened;
}

function dropRoot(text: string, root: string): string {
  const base = root.endsWith('/') ? root.slice(0, -1) : root;
  if (base.length === 0) return text;
  // A path that merely starts with the root's characters (`/a/proj-old`) is not inside it.
  const inside = new RegExp(`${escapeRegExp(base)}(?=/|$)(/?)`, 'g');
  return text.replace(inside, (_match, slash: string) => (slash === '/' ? '' : '.'));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
