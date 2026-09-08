/** Fired after Skills install/enable so the composer slash catalog can refresh. */
export const SKILLS_CHANGED_EVENT = 'piwin:skills-changed';

export function notifySkillsChanged(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new Event(SKILLS_CHANGED_EVENT));
}
