/**
 * Hint-only detection of flashcard artifact fences.
 *
 * A fence is treated as a flashcard artifact when its source contains a
 * `data-card-id="..."` (or single-quoted) attribute. This unlocks the
 * per-fence Preview card affordance (design §6) when the global
 * `artifactPreviewEnabled` preference is off.
 *
 * This is NOT a security boundary. Action validation in `ArtifactFrame`
 * requires the real `data-card-id="${cardId}"` substring to be present in
 * the actual (non-commented) source and the action name to be whitelisted
 * (design §11). A forged match only grants a Preview button, not privilege.
 */
export function isFlashcardArtifactSource(source: string): boolean {
  return /data-card-id=(?:"[^"]+"|'[^']+')/.test(source);
}
