import type { AgentStateJSON } from '../state/types.ts';

/**
 * Serialized representation of a ThreadNode for JSON persistence.
 *
 * This interface defines the JSON structure used when serializing a ThreadNode
 * for storage or transmission. It captures all node data including the full
 * agent state snapshot at that point in the conversation tree.
 *
 * @see ThreadNode - The runtime class this interface serializes
 * @see ThreadTreeJSON - The parent tree structure containing these nodes
 */
export interface ThreadNodeJSON {
  /**
   * Unique identifier for this node (UUIDv4 format).
   */
  id: string;

  /**
   * ID of the parent node, or null if this is the root node.
   */
  parentId: string | null;

  /**
   * Complete agent state snapshot at this point in the conversation.
   * Contains messages, metadata, and all other state information.
   */
  state: AgentStateJSON;

  /**
   * Optional human-readable name for this branch.
   * Useful for identifying specific conversation paths (e.g., "refactor-attempt", "alternative-solution").
   */
  name?: string;

  /**
   * IDs of all child nodes branching from this node.
   * An empty array indicates this is a leaf node.
   */
  children: string[];
}

/**
 * Serialized representation of a ThreadTree for JSON persistence.
 *
 * This interface defines the complete JSON structure of a thread tree,
 * including all nodes and tracking information for the root and current
 * active position within the tree.
 *
 * @see ThreadTree - The runtime class this interface serializes
 *
 * @example
 * ```typescript
 * // Saving a thread tree to storage
 * const json: ThreadTreeJSON = tree.toJSON();
 * await Bun.write('conversation.json', JSON.stringify(json));
 *
 * // Restoring from storage
 * const data = await Bun.file('conversation.json').json();
 * const restored = ThreadTree.fromJSON(data as ThreadTreeJSON);
 * ```
 */
export interface ThreadTreeJSON {
  /**
   * ID of the root node in the tree.
   * The root represents the initial conversation state.
   */
  rootId: string;

  /**
   * ID of the currently active node.
   * This tracks which branch/position is currently being used for the conversation.
   */
  currentId: string;

  /**
   * Array of all nodes in the tree.
   * Includes the root, all branches, and all leaf nodes.
   */
  nodes: ThreadNodeJSON[];
}
