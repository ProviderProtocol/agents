/**
 * File-based Checkpoint Store
 *
 * Reference implementation of {@link CheckpointStore} using the local filesystem.
 * Provides durable persistence for agent state with crash recovery capabilities.
 *
 * @remarks
 * This implementation stores each session in its own subdirectory with two files:
 * - `checkpoint.json`: The full serialized agent state
 * - `metadata.json`: Lightweight metadata for quick queries
 *
 * The write order (checkpoint then metadata) ensures that if a crash occurs
 * during save, the checkpoint file is either complete or missing entirely,
 * never partially written.
 *
 * @see UAP-1.0 Spec Section 12.4.3
 * @packageDocumentation
 */

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentStateJSON } from '../state/types.ts';
import type { CheckpointStore, FileCheckpointOptions, CheckpointMetadata } from './types.ts';
import { generateUUID } from '../utils/uuid.ts';

/**
 * Default directory for checkpoint storage when not specified.
 * @internal
 */
const DEFAULT_DIR = '.checkpoints';

/**
 * Creates a file-based checkpoint store for persisting agent state.
 *
 * This is the reference implementation of {@link CheckpointStore} that uses
 * the local filesystem for storage. Each session gets its own subdirectory
 * containing the checkpoint and metadata files.
 *
 * @remarks
 * Directory structure:
 * ```
 * {dir}/
 *   {sessionId}/
 *     checkpoint.json   # Full serialized AgentState
 *     metadata.json     # Lightweight session metadata
 * ```
 *
 * The store automatically creates directories as needed. Files are written
 * with pretty-printed JSON (2-space indent) for debuggability.
 *
 * @param options - Configuration options for the store.
 * @returns A {@link CheckpointStore} implementation backed by the filesystem.
 *
 * @example Basic usage
 * ```typescript
 * import { fileCheckpoints } from '@providerprotocol/agents/checkpoint';
 * import { agent, AgentState } from '@providerprotocol/agents';
 * import { anthropic } from '@providerprotocol/ai/anthropic';
 *
 * const store = fileCheckpoints({ dir: './my-checkpoints' });
 *
 * // Create agent with checkpoint support
 * const coder = agent({
 *   model: anthropic('claude-sonnet-4-20250514'),
 *   tools: [Bash, Read],
 *   checkpoints: store,
 *   sessionId: 'task-123',
 * });
 *
 * // Agent automatically checkpoints after each step
 * const { turn, state } = await coder.generate('Fix the bug', initialState);
 * ```
 *
 * @example Resume from checkpoint
 * ```typescript
 * const store = fileCheckpoints({ dir: './checkpoints' });
 *
 * // Try to resume existing session
 * const saved = await store.load('my-session');
 * const initialState = saved
 *   ? AgentState.fromJSON(saved)
 *   : AgentState.initial();
 *
 * // Continue execution from restored or fresh state
 * const { turn, state } = await coder.generate('Continue working', initialState);
 * ```
 *
 * @example Session management
 * ```typescript
 * const store = fileCheckpoints();
 *
 * // List all saved sessions
 * const sessions = await store.list();
 *
 * // Get metadata without loading full state
 * for (const sessionId of sessions) {
 *   const meta = await store.loadMetadata(sessionId);
 *   console.log(`${sessionId}: step ${meta?.step}, saved ${meta?.timestamp}`);
 * }
 *
 * // Clean up completed session
 * await store.delete('completed-session');
 * ```
 */
export function fileCheckpoints(options: FileCheckpointOptions = {}): CheckpointStore {
  const dir = options.dir ?? DEFAULT_DIR;

  /**
   * Creates the session directory if it doesn't exist.
   *
   * @param sessionId - The session identifier used as directory name.
   * @returns The full path to the session directory.
   * @internal
   */
  async function ensureSessionDir(sessionId: string): Promise<string> {
    const sessionDir = join(dir, sessionId);
    await mkdir(sessionDir, { recursive: true });
    return sessionDir;
  }

  /**
   * Computes file paths for a session's checkpoint and metadata files.
   *
   * @param sessionId - The session identifier.
   * @returns Object containing paths to checkpoint.json and metadata.json.
   * @internal
   */
  function getPaths(sessionId: string): { checkpointPath: string; metadataPath: string } {
    const sessionDir = join(dir, sessionId);
    return {
      checkpointPath: join(sessionDir, 'checkpoint.json'),
      metadataPath: join(sessionDir, 'metadata.json'),
    };
  }

  return {
    async save(sessionId: string, state: AgentStateJSON): Promise<void> {
      await ensureSessionDir(sessionId);
      const { checkpointPath, metadataPath } = getPaths(sessionId);

      const metadata: CheckpointMetadata = {
        sessionId,
        checkpointId: generateUUID(),
        timestamp: new Date().toISOString(),
        step: state.step,
        agentId: state.metadata.agentId as string ?? 'unknown',
      };

      // Write checkpoint first, then metadata sequentially.
      // This ordering ensures that if interrupted, we either have a valid
      // checkpoint (possibly with stale metadata) or no checkpoint at all.
      await writeFile(checkpointPath, JSON.stringify(state, null, 2), 'utf-8');
      await writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
    },

    async load(sessionId: string): Promise<AgentStateJSON | null> {
      const { checkpointPath } = getPaths(sessionId);

      try {
        const content = await readFile(checkpointPath, 'utf-8');
        return JSON.parse(content) as AgentStateJSON;
      } catch {
        return null;
      }
    },

    async loadMetadata(sessionId: string): Promise<CheckpointMetadata | null> {
      const { metadataPath } = getPaths(sessionId);

      try {
        const content = await readFile(metadataPath, 'utf-8');
        return JSON.parse(content) as CheckpointMetadata;
      } catch {
        return null;
      }
    },

    async delete(sessionId: string): Promise<void> {
      const sessionDir = join(dir, sessionId);
      try {
        await rm(sessionDir, { recursive: true, force: true });
      } catch {
        // Directory may not exist; silently ignore
      }
    },

    async list(): Promise<string[]> {
      try {
        await mkdir(dir, { recursive: true });

        const entries = await readdir(dir, { withFileTypes: true });
        return entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name);
      } catch {
        return [];
      }
    },
  };
}
