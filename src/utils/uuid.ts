/**
 * Generate a UUIDv4 identifier.
 * Uses the native crypto.randomUUID() which is available in Bun and modern Node.js.
 */
export function generateUUID(): string {
  return globalThis.crypto.randomUUID();
}
