import { generateUUID } from '../utils/uuid.ts';
import { AgentState } from '../state/index.ts';
import type { ThreadNodeJSON, ThreadTreeJSON } from './types.ts';

/**
 * A node in the thread tree representing a conversation state snapshot.
 *
 * Each ThreadNode captures a complete snapshot of the agent state at a specific
 * point in the conversation. Nodes form a tree structure where each node can
 * have multiple children, enabling branching conversations and exploration
 * of alternative dialogue paths.
 *
 * @remarks
 * Nodes store full state copies rather than deltas, which simplifies branch
 * switching at the cost of increased memory usage. This design choice makes
 * checkout operations O(1) rather than requiring path reconstruction.
 *
 * @see ThreadTree - The container class that manages collections of nodes
 *
 * @example
 * ```typescript
 * // Create a node manually (typically done via ThreadTree.branch())
 * const node = new ThreadNode(
 *   generateUUID(),
 *   parentNodeId,
 *   currentAgentState,
 *   'experiment-1'
 * );
 *
 * // Access node properties
 * console.log(node.id);        // UUIDv4 identifier
 * console.log(node.parentId);  // Parent's ID or null for root
 * console.log(node.children);  // Array of child node IDs
 * ```
 */
export class ThreadNode {
  /**
   * Unique identifier for this node (UUIDv4 format).
   */
  readonly id: string;

  /**
   * ID of the parent node, or null if this is the root node.
   */
  readonly parentId: string | null;

  /**
   * Complete agent state snapshot at this point in the conversation.
   * This is mutable to allow state updates on the current node.
   */
  state: AgentState;

  /**
   * Optional human-readable name for this branch.
   * Useful for identifying specific conversation paths.
   */
  name?: string;

  /**
   * IDs of all child nodes branching from this node.
   * Modified when new branches are created via ThreadTree.branch().
   */
  readonly children: string[];

  /**
   * Creates a new ThreadNode instance.
   *
   * @param id - Unique identifier for this node (typically a UUIDv4)
   * @param parentId - ID of the parent node, or null for root nodes
   * @param state - The agent state snapshot to store at this node
   * @param name - Optional human-readable name for the branch
   * @param children - Array of child node IDs (defaults to empty array)
   */
  constructor(
    id: string,
    parentId: string | null,
    state: AgentState,
    name?: string,
    children: string[] = [],
  ) {
    this.id = id;
    this.parentId = parentId;
    this.state = state;
    this.name = name;
    this.children = children;
  }

  /**
   * Serializes this node to a JSON-compatible object.
   *
   * @returns A plain object representation suitable for JSON.stringify()
   *
   * @example
   * ```typescript
   * const json = node.toJSON();
   * const serialized = JSON.stringify(json);
   * ```
   */
  toJSON(): ThreadNodeJSON {
    return {
      id: this.id,
      parentId: this.parentId,
      state: this.state.toJSON(),
      name: this.name,
      children: [...this.children],
    };
  }

  /**
   * Deserializes a ThreadNode from a JSON object.
   *
   * @param json - The serialized node data
   * @returns A new ThreadNode instance with the restored data
   *
   * @example
   * ```typescript
   * const json = JSON.parse(savedData) as ThreadNodeJSON;
   * const node = ThreadNode.fromJSON(json);
   * ```
   */
  static fromJSON(json: ThreadNodeJSON): ThreadNode {
    return new ThreadNode(
      json.id,
      json.parentId,
      AgentState.fromJSON(json.state),
      json.name,
      [...json.children],
    );
  }
}

/**
 * A tree-structured collection of conversation threads with branching support.
 *
 * ThreadTree provides a git-like branching model for conversations, where each
 * node represents a snapshot of the conversation state. Users can create branches
 * to explore alternative conversation paths, switch between branches, and maintain
 * multiple concurrent conversation histories.
 *
 * @remarks
 * Key concepts:
 * - **Root**: The initial node created when the tree is instantiated
 * - **Current**: The active node where new state updates are applied
 * - **Branch**: Creating a new child node from any existing node
 * - **Checkout**: Switching the active node to a different position in the tree
 *
 * The tree automatically manages node relationships and provides efficient
 * lookup via an internal Map structure.
 *
 * @see ThreadNode - The node class used within the tree
 *
 * @example
 * ```typescript
 * // Create a new thread tree
 * const tree = new ThreadTree();
 *
 * // Work with the current state
 * const state = tree.history();
 *
 * // Create a branch for experimentation
 * const branchId = tree.branch(tree.current.id, 'experiment');
 * tree.checkout(branchId);
 *
 * // Switch back to the original branch
 * tree.checkout(tree.root.id);
 *
 * // Persist and restore
 * const json = tree.toJSON();
 * const restored = ThreadTree.fromJSON(json);
 * ```
 */
export class ThreadTree {
  /**
   * The root node of the tree, representing the initial conversation state.
   * This node has no parent (parentId is null).
   */
  readonly root: ThreadNode;

  /**
   * The currently active node in the tree.
   * State updates and new branches are relative to this node.
   */
  private currentNode: ThreadNode;

  /**
   * Map of all nodes in the tree, keyed by node ID.
   * Provides O(1) lookup for branch and checkout operations.
   */
  readonly nodes: Map<string, ThreadNode>;

  /**
   * Creates a new ThreadTree instance.
   *
   * If no root node is provided, creates a fresh tree with a new root node
   * containing an initial (empty) agent state.
   *
   * @param root - Optional existing root node to use. If omitted, a new root
   *               with initial state is created automatically.
   *
   * @example
   * ```typescript
   * // Create a fresh tree
   * const tree = new ThreadTree();
   *
   * // Create from an existing root (used by fromJSON)
   * const existingRoot = new ThreadNode(id, null, state, 'root');
   * const tree = new ThreadTree(existingRoot);
   * ```
   */
  constructor(root?: ThreadNode) {
    if (root) {
      this.root = root;
      this.currentNode = root;
      this.nodes = new Map([[root.id, root]]);
    } else {
      const rootNode = new ThreadNode(
        generateUUID(),
        null,
        AgentState.initial(),
        'root',
      );
      this.root = rootNode;
      this.currentNode = rootNode;
      this.nodes = new Map([[rootNode.id, rootNode]]);
    }
  }

  /**
   * Gets the currently active node in the tree.
   *
   * The current node is where state updates are applied and serves as the
   * default parent for new branches.
   *
   * @returns The currently active ThreadNode
   *
   * @example
   * ```typescript
   * const currentState = tree.current.state;
   * const currentId = tree.current.id;
   * ```
   */
  get current(): ThreadNode {
    return this.currentNode;
  }

  /**
   * Creates a new branch from an existing node.
   *
   * The new node inherits a copy of the parent node's state and is automatically
   * registered in the tree. The parent's children array is updated to include
   * the new node.
   *
   * @param fromId - ID of the node to branch from
   * @param name - Optional human-readable name for the new branch
   * @returns The ID of the newly created node
   * @throws Error if the specified parent node does not exist
   *
   * @remarks
   * This method does not automatically checkout the new branch. Call
   * {@link checkout} with the returned ID to switch to the new branch.
   *
   * @example
   * ```typescript
   * // Create a named branch from current position
   * const branchId = tree.branch(tree.current.id, 'try-different-approach');
   *
   * // Switch to the new branch
   * tree.checkout(branchId);
   *
   * // Create an unnamed branch from root
   * const altBranchId = tree.branch(tree.root.id);
   * ```
   */
  branch(fromId: string, name?: string): string {
    const parent = this.nodes.get(fromId);
    if (!parent) {
      throw new Error(`Node not found: ${fromId}`);
    }

    const newNode = new ThreadNode(
      generateUUID(),
      fromId,
      parent.state,
      name,
    );

    parent.children.push(newNode.id);
    this.nodes.set(newNode.id, newNode);

    return newNode.id;
  }

  /**
   * Switches the active node to a different position in the tree.
   *
   * After checkout, the tree's current property will point to the specified
   * node, and subsequent state operations will apply to that node.
   *
   * @param nodeId - ID of the node to switch to
   * @throws Error if the specified node does not exist
   *
   * @example
   * ```typescript
   * // Switch to a specific branch
   * tree.checkout(branchId);
   *
   * // Switch back to root
   * tree.checkout(tree.root.id);
   *
   * // Switch to a leaf node
   * const leaves = tree.getLeaves();
   * tree.checkout(leaves[0]);
   * ```
   */
  checkout(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    this.currentNode = node;
  }

  /**
   * Gets the agent state for the current node with tree metadata attached.
   *
   * Since nodes store complete state snapshots, this simply returns the
   * current node's state with an additional metadata field containing
   * the current node's ID for reference.
   *
   * @returns The current node's AgentState with `_threadTreeNodeId` metadata
   *
   * @example
   * ```typescript
   * const state = tree.history();
   * const messages = state.messages;
   * const nodeId = state.metadata['_threadTreeNodeId'];
   * ```
   */
  history(): AgentState {
    return this.currentNode.state
      .withMetadata('_threadTreeNodeId', this.currentNode.id);
  }

  /**
   * Gets all leaf nodes in the tree.
   *
   * Leaf nodes are nodes with no children, representing the endpoints
   * of various conversation branches. These are typically the most recent
   * points in each conversation path.
   *
   * @returns Array of node IDs for all leaf nodes
   *
   * @example
   * ```typescript
   * const leaves = tree.getLeaves();
   * console.log(`Tree has ${leaves.length} active branches`);
   *
   * // Visit each leaf
   * for (const leafId of leaves) {
   *   tree.checkout(leafId);
   *   console.log(tree.current.name);
   * }
   * ```
   */
  getLeaves(): string[] {
    const leaves: string[] = [];

    for (const [id, node] of this.nodes) {
      if (node.children.length === 0) {
        leaves.push(id);
      }
    }

    return leaves;
  }

  /**
   * Gets all named branches in the tree.
   *
   * Returns a map of node IDs to their branch names for nodes that have
   * been given explicit names. Useful for displaying a list of available
   * branches to users.
   *
   * @returns Map of node IDs to branch names (undefined values excluded from result)
   *
   * @example
   * ```typescript
   * const branches = tree.getBranches();
   * for (const [id, name] of branches) {
   *   console.log(`Branch "${name}": ${id}`);
   * }
   * ```
   */
  getBranches(): Map<string, string | undefined> {
    const branches = new Map<string, string | undefined>();

    for (const [id, node] of this.nodes) {
      if (node.name) {
        branches.set(id, node.name);
      }
    }

    return branches;
  }

  /**
   * Serializes the entire tree to a JSON-compatible object.
   *
   * The serialized form includes all nodes, the root ID, and the current
   * node ID, allowing complete tree reconstruction via fromJSON().
   *
   * @returns A plain object representation suitable for JSON.stringify()
   *
   * @example
   * ```typescript
   * const json = tree.toJSON();
   * await Bun.write('conversation-tree.json', JSON.stringify(json, null, 2));
   * ```
   */
  toJSON(): ThreadTreeJSON {
    const nodes: ThreadNodeJSON[] = [];

    for (const node of this.nodes.values()) {
      nodes.push(node.toJSON());
    }

    return {
      rootId: this.root.id,
      currentId: this.currentNode.id,
      nodes,
    };
  }

  /**
   * Deserializes a ThreadTree from a JSON object.
   *
   * Reconstructs the complete tree structure including all nodes,
   * parent-child relationships, and restores the current node position.
   *
   * @param json - The serialized tree data
   * @returns A new ThreadTree instance with the restored structure
   * @throws Error if the root node ID is not found in the nodes array
   * @throws Error if the current node ID is not found in the nodes array
   *
   * @example
   * ```typescript
   * const data = await Bun.file('conversation-tree.json').json();
   * const tree = ThreadTree.fromJSON(data as ThreadTreeJSON);
   *
   * // Tree is fully restored with same current position
   * console.log(tree.current.id);
   * ```
   */
  static fromJSON(json: ThreadTreeJSON): ThreadTree {
    const nodesMap = new Map<string, ThreadNode>();

    for (const nodeJson of json.nodes) {
      const node = ThreadNode.fromJSON(nodeJson);
      nodesMap.set(node.id, node);
    }

    const root = nodesMap.get(json.rootId);
    const current = nodesMap.get(json.currentId);

    if (!root) {
      throw new Error(`Root node not found: ${json.rootId}`);
    }

    if (!current) {
      throw new Error(`Current node not found: ${json.currentId}`);
    }

    const tree = new ThreadTree(root);

    tree.nodes.clear();
    for (const [id, node] of nodesMap) {
      tree.nodes.set(id, node);
    }

    tree.checkout(current.id);

    return tree;
  }
}

export type { ThreadNodeJSON, ThreadTreeJSON } from './types.ts';
