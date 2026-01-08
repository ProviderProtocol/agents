/**
 * Checkpoint Types
 *
 * Type definitions for step-level persistence and session resume.
 * These types define the contract for checkpoint storage implementations
 * used by agents to save and restore execution state.
 *
 * @remarks
 * Checkpointing enables crash recovery and session resume capabilities.
 * The agent automatically saves state after each step when a checkpoint
 * store is configured, allowing execution to resume from the last
 * successful step if interrupted.
 *
 * @see UAP-1.0 Spec Section 12.4
 * @packageDocumentation
 */

import type { AgentStateJSON } from '../state/types.ts';

/**
 * Interface for checkpoint storage implementations.
 *
 * Implementations handle persistence of agent state at step boundaries
 * for crash recovery and session resume. Each implementation can use
 * different storage backends (filesystem, database, cloud storage, etc.).
 *
 * @remarks
 * The checkpoint store is called by the agent after each successful step.
 * Implementations should be atomic - either the entire checkpoint is saved
 * successfully, or nothing is changed. This ensures consistent state
 * recovery even if a crash occurs during the save operation.
 *
 * @example
 * ```typescript
 * import { fileCheckpoints } from '@providerprotocol/agents/checkpoint';
 * import { AgentState } from '@providerprotocol/agents';
 *
 * const store = fileCheckpoints({ dir: './checkpoints' });
 *
 * // Save checkpoint after agent step
 * await store.save('session-123', state.toJSON());
 *
 * // Resume from checkpoint on restart
 * const saved = await store.load('session-123');
 * if (saved) {
 *   const restored = AgentState.fromJSON(saved);
 *   // Continue execution from restored state
 * }
 *
 * // Clean up when session is complete
 * await store.delete('session-123');
 * ```
 */
export interface CheckpointStore {
  /**
   * Saves a checkpoint of the current agent state.
   *
   * Persists the serialized agent state, overwriting any existing
   * checkpoint for the same session. The save operation should be
   * atomic to prevent corruption.
   *
   * @param sessionId - Unique identifier for the session. Used to organize
   *   and retrieve checkpoints. Should be consistent across restarts.
   * @param state - The serialized agent state from `AgentState.toJSON()`.
   *   Contains complete execution history and context.
   * @returns Promise that resolves when the checkpoint is persisted.
   *
   * @example
   * ```typescript
   * await store.save('user-123-task-456', agentState.toJSON());
   * ```
   */
  save(sessionId: string, state: AgentStateJSON): Promise<void>;

  /**
   * Loads the most recent checkpoint for a session.
   *
   * Retrieves the previously saved state, which can be used to create
   * an `AgentState` instance via `AgentState.fromJSON()`.
   *
   * @param sessionId - The session identifier to load.
   * @returns Promise resolving to the serialized state, or `null` if
   *   no checkpoint exists for this session.
   *
   * @example
   * ```typescript
   * const saved = await store.load('my-session');
   * if (saved) {
   *   const state = AgentState.fromJSON(saved);
   *   // Resume execution with restored state
   * } else {
   *   // Start fresh with initial state
   *   const state = AgentState.initial();
   * }
   * ```
   */
  load(sessionId: string): Promise<AgentStateJSON | null>;

  /**
   * Loads checkpoint metadata without loading the full state.
   *
   * Useful for displaying session information (timestamp, step count)
   * without the overhead of deserializing the complete state.
   *
   * @param sessionId - The session identifier to query.
   * @returns Promise resolving to checkpoint metadata, or `null` if
   *   no checkpoint exists for this session.
   *
   * @example
   * ```typescript
   * const meta = await store.loadMetadata('my-session');
   * if (meta) {
   *   console.log(`Session at step ${meta.step}, saved at ${meta.timestamp}`);
   * }
   * ```
   */
  loadMetadata(sessionId: string): Promise<CheckpointMetadata | null>;

  /**
   * Deletes all checkpoints for a session.
   *
   * Removes the checkpoint data and metadata for the specified session.
   * This should be called when a session is complete and no longer
   * needs recovery capability.
   *
   * @param sessionId - The session identifier to delete.
   * @returns Promise that resolves when deletion is complete.
   *   Does not throw if the session doesn't exist.
   *
   * @example
   * ```typescript
   * // Clean up after successful completion
   * await store.delete('completed-session');
   * ```
   */
  delete(sessionId: string): Promise<void>;

  /**
   * Lists all session IDs that have checkpoints.
   *
   * Returns identifiers for all sessions with saved checkpoints.
   * Useful for implementing session management UI or cleanup routines.
   *
   * @returns Promise resolving to an array of session identifiers.
   *   Returns an empty array if no checkpoints exist.
   *
   * @example
   * ```typescript
   * const sessions = await store.list();
   * console.log(`Found ${sessions.length} saved sessions`);
   *
   * // Clean up old sessions
   * for (const sessionId of sessions) {
   *   const meta = await store.loadMetadata(sessionId);
   *   if (isOlderThan(meta?.timestamp, '7d')) {
   *     await store.delete(sessionId);
   *   }
   * }
   * ```
   */
  list(): Promise<string[]>;
}

/**
 * Configuration options for the file-based checkpoint store.
 *
 * @see {@link fileCheckpoints} for the factory function that uses these options.
 */
export interface FileCheckpointOptions {
  /**
   * Directory path for storing checkpoint files.
   *
   * Each session gets its own subdirectory containing the checkpoint
   * and metadata files. The directory is created automatically if it
   * doesn't exist.
   *
   * @defaultValue ".checkpoints"
   *
   * @example
   * ```typescript
   * // Use project-relative directory
   * const store = fileCheckpoints({ dir: './data/checkpoints' });
   *
   * // Use absolute path
   * const store = fileCheckpoints({ dir: '/var/lib/agent/checkpoints' });
   * ```
   */
  dir?: string;
}

/**
 * Metadata about a checkpoint, stored separately from the full state.
 *
 * Contains lightweight information about the checkpoint for quick
 * retrieval without loading the complete state data.
 *
 * @remarks
 * Metadata is written after the checkpoint data to ensure consistency.
 * If a crash occurs between writing checkpoint and metadata, the
 * checkpoint is still valid and can be recovered.
 */
export interface CheckpointMetadata {
  /**
   * The session identifier this checkpoint belongs to.
   * Matches the `sessionId` parameter passed to `save()`.
   */
  sessionId: string;

  /**
   * Unique identifier for this specific checkpoint.
   * Generated automatically when the checkpoint is created.
   * Useful for debugging and audit trails.
   */
  checkpointId: string;

  /**
   * ISO 8601 timestamp when the checkpoint was created.
   * Example: "2025-01-07T14:30:00.000Z"
   */
  timestamp: string;

  /**
   * The step number at which this checkpoint was taken.
   * Corresponds to `AgentState.step` at save time.
   */
  step: number;

  /**
   * The agent instance ID that created this checkpoint.
   * Useful for tracking which agent configuration was used.
   */
  agentId: string;
}

/**
 * Complete checkpoint data combining metadata and state.
 *
 * Represents the full checkpoint as stored, including both the
 * serialized agent state and its associated metadata.
 *
 * @remarks
 * This type is primarily used internally by checkpoint store
 * implementations. Most consumers will use `CheckpointStore.load()`
 * which returns only the state, and `CheckpointStore.loadMetadata()`
 * which returns only the metadata.
 */
export interface CheckpointData {
  /**
   * Checkpoint metadata containing session info and timestamps.
   */
  metadata: CheckpointMetadata;

  /**
   * The serialized agent state that can be restored via
   * `AgentState.fromJSON()`.
   */
  state: AgentStateJSON;
}
