/** Test-only JSONL encoding: mutations require the caller-owned key in a v1 envelope. */
export function encodeHostCommandFixture(command) {
  return `${JSON.stringify({
    v: 1,
    command,
    idempotencyKey: command.id,
  })}\n`;
}
