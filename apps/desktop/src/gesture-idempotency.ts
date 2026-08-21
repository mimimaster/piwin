export function createGestureIdempotencyKey(): string {
  return crypto.randomUUID();
}
