import type { AgentStateJSON } from '../state/types.ts';

/**
 * Serialized form of a ThreadNode.
 */
export interface ThreadNodeJSON {
  /** Node ID */
  id: string;
  /** Parent node ID (null for root) */
  parentId: string | null;
  /** State snapshot at this node */
  state: AgentStateJSON;
  /** Optional branch name */
  name?: string;
  /** Child node IDs */
  children: string[];
}

/**
 * Serialized form of a ThreadTree.
 */
export interface ThreadTreeJSON {
  /** Root node ID */
  rootId: string;
  /** Current (active) node ID */
  currentId: string;
  /** All nodes */
  nodes: ThreadNodeJSON[];
}
