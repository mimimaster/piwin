type RecencyStamped = { readonly updatedAt?: string | undefined };

/**
 * A missing `updatedAt` means the row was just created and not yet stamped by
 * the Host, so it ranks newest. An unparseable stamp ranks oldest.
 */
export function sessionRecencyTime(updatedAt: string | undefined): number {
  if (!updatedAt) {
    return Number.POSITIVE_INFINITY;
  }
  const time = Date.parse(updatedAt);
  return Number.isNaN(time) ? 0 : time;
}

/** Newest first; 0 on ties so callers can apply their own tiebreak. */
export function compareSessionRecency(left: RecencyStamped, right: RecencyStamped): number {
  const leftTime = sessionRecencyTime(left.updatedAt);
  const rightTime = sessionRecencyTime(right.updatedAt);
  if (leftTime === rightTime) {
    return 0;
  }
  return leftTime > rightTime ? -1 : 1;
}
