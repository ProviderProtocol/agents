/**
 * Generates a cryptographically secure UUIDv4 identifier.
 *
 * Uses the native `crypto.randomUUID()` API which is available in Bun,
 * modern Node.js (v14.17+), and all modern browsers.
 *
 * @returns A string containing a randomly generated UUIDv4 in the format
 *          `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`
 *
 * @example
 * ```typescript
 * import { generateUUID } from '@providerprotocol/agents/utils/uuid';
 *
 * const id = generateUUID();
 * console.log(id); // e.g., "550e8400-e29b-41d4-a716-446655440000"
 *
 * // Use for unique identifiers in agent state
 * const checkpoint = {
 *   id: generateUUID(),
 *   timestamp: Date.now(),
 *   state: agentState,
 * };
 * ```
 *
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID | MDN crypto.randomUUID()}
 */
export function generateUUID(): string {
  return globalThis.crypto.randomUUID();
}
