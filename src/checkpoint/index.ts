/**
 * Checkpoint Module
 *
 * Provides step-level persistence for agent state, enabling crash recovery
 * and session resume capabilities. The agent automatically saves state after
 * each step when a checkpoint store is configured.
 *
 * @remarks
 * Checkpointing is essential for long-running agent tasks where interruption
 * (crash, timeout, user cancellation) could lose significant progress. By
 * checkpointing after each step, execution can resume from the last successful
 * state rather than starting over.
 *
 * The module provides:
 * - {@link CheckpointStore} - Interface for implementing custom storage backends
 * - {@link fileCheckpoints} - Reference implementation using the local filesystem
 * - {@link CheckpointMetadata} - Lightweight metadata for session management
 * - {@link CheckpointData} - Combined state and metadata type
 *
 * @example Basic checkpoint usage
 * ```typescript
 * import { fileCheckpoints } from '@providerprotocol/agents/checkpoint';
 * import { agent, AgentState } from '@providerprotocol/agents';
 * import { anthropic } from '@providerprotocol/ai/anthropic';
 *
 * const store = fileCheckpoints({ dir: './checkpoints' });
 *
 * // Resume from existing checkpoint or start fresh
 * const saved = await store.load('my-session');
 * const initialState = saved
 *   ? AgentState.fromJSON(saved)
 *   : AgentState.initial();
 *
 * // Execute with automatic checkpointing after each step
 * const coder = agent({
 *   model: anthropic('claude-sonnet-4-20250514'),
 *   tools: [Bash, Read],
 *   checkpoints: store,
 *   sessionId: 'my-session',
 * });
 *
 * const { turn, state } = await coder.generate('Fix the bug', initialState);
 * ```
 *
 * @example Custom checkpoint store implementation
 * ```typescript
 * import type { CheckpointStore } from '@providerprotocol/agents/checkpoint';
 *
 * // Example: Redis-backed checkpoint store
 * function redisCheckpoints(client: RedisClient): CheckpointStore {
 *   return {
 *     async save(sessionId, state) {
 *       await client.set(`checkpoint:${sessionId}`, JSON.stringify(state));
 *     },
 *     async load(sessionId) {
 *       const data = await client.get(`checkpoint:${sessionId}`);
 *       return data ? JSON.parse(data) : null;
 *     },
 *     // ... implement other methods
 *   };
 * }
 * ```
 *
 * @see UAP-1.0 Spec Section 12.4 for checkpoint protocol specification
 * @packageDocumentation
 */

export { fileCheckpoints } from './file.ts';

export type {
  CheckpointStore,
  FileCheckpointOptions,
  CheckpointMetadata,
  CheckpointData,
} from './types.ts';
