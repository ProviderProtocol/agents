/**
 * Checkpoint Module
 *
 * Step-level persistence for crash recovery and session resume.
 *
 * @example
 * ```typescript
 * import { fileCheckpoints } from '@providerprotocol/agents/checkpoint';
 * import { agent, AgentState } from '@providerprotocol/agents';
 *
 * const store = fileCheckpoints({ dir: './checkpoints' });
 *
 * // Resume or start fresh
 * const saved = await store.load('my-session');
 * const initialState = saved
 *   ? AgentState.fromJSON(saved)
 *   : AgentState.initial();
 *
 * // Execute with checkpointing
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
 * @packageDocumentation
 */

export { fileCheckpoints } from './file.ts';

export type {
  CheckpointStore,
  FileCheckpointOptions,
  CheckpointMetadata,
  CheckpointData,
} from './types.ts';
