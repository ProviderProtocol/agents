/**
 * Checkpoint Types
 *
 * Type definitions for step-level persistence and session resume.
 *
 * @see UAP-1.0 Spec Section 12.4
 */

import type { AgentStateJSON } from '../state/types.ts';

/**
 * Checkpoint store interface.
 *
 * Implementations handle persistence of agent state at step boundaries
 * for crash recovery and session resume.
 *
 * @example
 * ```typescript
 * const store = fileCheckpoints({ dir: './checkpoints' });
 *
 * // Save checkpoint
 * await store.save('session-123', state.toJSON());
 *
 * // Load checkpoint
 * const saved = await store.load('session-123');
 * if (saved) {
 *   const restored = AgentState.fromJSON(saved);
 * }
 * ```
 */
export interface CheckpointStore {
  /**
   * Save a checkpoint at the current state.
   *
   * @param sessionId - Session identifier
   * @param state - Serialized agent state
   */
  save(sessionId: string, state: AgentStateJSON): Promise<void>;

  /**
   * Load the most recent checkpoint for a session.
   *
   * @param sessionId - Session identifier
   * @returns Serialized state or null if not found
   */
  load(sessionId: string): Promise<AgentStateJSON | null>;

  /**
   * Load metadata for a session without loading full state.
   *
   * @param sessionId - Session identifier
   * @returns Checkpoint metadata or null if not found
   */
  loadMetadata(sessionId: string): Promise<CheckpointMetadata | null>;

  /**
   * Delete all checkpoints for a session.
   *
   * @param sessionId - Session identifier
   */
  delete(sessionId: string): Promise<void>;

  /**
   * List all session IDs with checkpoints.
   *
   * @returns Array of session IDs
   */
  list(): Promise<string[]>;
}

/**
 * Options for file-based checkpoint store.
 */
export interface FileCheckpointOptions {
  /** Directory for checkpoint files. Default: ".checkpoints" */
  dir?: string;
}

/**
 * Checkpoint metadata stored alongside state.
 */
export interface CheckpointMetadata {
  /** Session identifier */
  sessionId: string;
  /** Unique checkpoint ID */
  checkpointId: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Step number at checkpoint */
  step: number;
  /** Agent instance ID */
  agentId: string;
}

/**
 * Full checkpoint data including state and metadata.
 */
export interface CheckpointData {
  /** Checkpoint metadata */
  metadata: CheckpointMetadata;
  /** Serialized agent state */
  state: AgentStateJSON;
}
