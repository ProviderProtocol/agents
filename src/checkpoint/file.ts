/**
 * File-based Checkpoint Store
 *
 * Reference implementation of CheckpointStore using the filesystem.
 *
 * @see UAP-1.0 Spec Section 12.4.3
 */

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentStateJSON } from '../state/types.ts';
import type { CheckpointStore, FileCheckpointOptions, CheckpointMetadata } from './types.ts';
import { generateUUID } from '../utils/uuid.ts';

const DEFAULT_DIR = '.checkpoints';

/**
 * Create a file-based checkpoint store.
 *
 * Stores checkpoints as JSON files in a directory structure:
 * ```
 * {dir}/
 *   {sessionId}/
 *     checkpoint.json   # Latest state
 *     metadata.json     # Session metadata
 * ```
 *
 * @param options - Configuration options
 * @returns CheckpointStore implementation
 *
 * @example
 * ```typescript
 * import { fileCheckpoints } from '@providerprotocol/agents/checkpoint';
 *
 * const store = fileCheckpoints({ dir: './my-checkpoints' });
 *
 * // Save a checkpoint
 * await store.save('session-123', state.toJSON());
 *
 * // Load a checkpoint
 * const saved = await store.load('session-123');
 * ```
 */
export function fileCheckpoints(options: FileCheckpointOptions = {}): CheckpointStore {
  const dir = options.dir ?? DEFAULT_DIR;

  /**
   * Ensure session directory exists.
   */
  async function ensureSessionDir(sessionId: string): Promise<string> {
    const sessionDir = join(dir, sessionId);
    await mkdir(sessionDir, { recursive: true });
    return sessionDir;
  }

  /**
   * Get paths for checkpoint files.
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

      // Build metadata
      const metadata: CheckpointMetadata = {
        sessionId,
        checkpointId: generateUUID(),
        timestamp: new Date().toISOString(),
        step: state.step,
        agentId: state.metadata.agentId as string ?? 'unknown',
      };

      // Write checkpoint first, then metadata (sequential to avoid race conditions)
      await writeFile(checkpointPath, JSON.stringify(state, null, 2), 'utf-8');
      await writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
    },

    async load(sessionId: string): Promise<AgentStateJSON | null> {
      const { checkpointPath } = getPaths(sessionId);

      try {
        const content = await readFile(checkpointPath, 'utf-8');
        return JSON.parse(content) as AgentStateJSON;
      } catch {
        // File doesn't exist or is invalid
        return null;
      }
    },

    async delete(sessionId: string): Promise<void> {
      const sessionDir = join(dir, sessionId);
      try {
        await rm(sessionDir, { recursive: true, force: true });
      } catch {
        // Directory might not exist, ignore
      }
    },

    async list(): Promise<string[]> {
      try {
        // Ensure base directory exists
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
