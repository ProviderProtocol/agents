import { generateUUID } from '../utils/uuid.ts';
import { AgentState } from '../state/index.ts';
import type { ThreadNodeJSON, ThreadTreeJSON } from './types.ts';

/**
 * A node in the thread tree representing a conversation state snapshot.
 */
export class ThreadNode {
  /** Node ID (UUIDv4) */
  readonly id: string;

  /** Parent node ID (null for root) */
  readonly parentId: string | null;

  /** State snapshot at this node */
  state: AgentState;

  /** Optional branch name */
  name?: string;

  /** Child node IDs */
  readonly children: string[];

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
   * Serialize to JSON.
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
   * Deserialize from JSON.
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
 * A tree-structured collection of conversation threads with parent-child relationships.
 * Enables branching conversations and easy switching between alternative paths.
 */
export class ThreadTree {
  /** Root node */
  readonly root: ThreadNode;

  /** Currently active node */
  private currentNode: ThreadNode;

  /** All nodes by ID */
  readonly nodes: Map<string, ThreadNode>;

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
   * Get the currently active node.
   */
  get current(): ThreadNode {
    return this.currentNode;
  }

  /**
   * Create a branch from a node.
   *
   * @param fromId - ID of the node to branch from
   * @param name - Optional name for the branch
   * @returns ID of the new node
   */
  branch(fromId: string, name?: string): string {
    const parent = this.nodes.get(fromId);
    if (!parent) {
      throw new Error(`Node not found: ${fromId}`);
    }

    const newNode = new ThreadNode(
      generateUUID(),
      fromId,
      parent.state, // Copy parent's state
      name,
    );

    // Add to parent's children
    parent.children.push(newNode.id);

    // Add to nodes map
    this.nodes.set(newNode.id, newNode);

    return newNode.id;
  }

  /**
   * Switch to a different node.
   *
   * @param nodeId - ID of the node to switch to
   */
  checkout(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    this.currentNode = node;
  }

  /**
   * Get the AgentState representing the full history from root to current node.
   * Since nodes store full state snapshots, this returns the current node's state.
   *
   * @returns AgentState with combined history
   */
  history(): AgentState {
    return this.currentNode.state
      .withMetadata('_threadTreeNodeId', this.currentNode.id);
  }

  /**
   * Get all leaf nodes (nodes with no children).
   *
   * @returns Array of leaf node IDs
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
   * Get all branch names.
   *
   * @returns Map of node IDs to branch names
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
   * Serialize to JSON.
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
   * Deserialize from JSON.
   */
  static fromJSON(json: ThreadTreeJSON): ThreadTree {
    // First, create all nodes
    const nodesMap = new Map<string, ThreadNode>();

    for (const nodeJson of json.nodes) {
      const node = ThreadNode.fromJSON(nodeJson);
      nodesMap.set(node.id, node);
    }

    // Find root and current nodes
    const root = nodesMap.get(json.rootId);
    const current = nodesMap.get(json.currentId);

    if (!root) {
      throw new Error(`Root node not found: ${json.rootId}`);
    }

    if (!current) {
      throw new Error(`Current node not found: ${json.currentId}`);
    }

    // Create tree with root
    const tree = new ThreadTree(root);

    // Replace the nodes map
    tree.nodes.clear();
    for (const [id, node] of nodesMap) {
      tree.nodes.set(id, node);
    }

    // Set current node
    tree.checkout(current.id);

    return tree;
  }
}

export type { ThreadNodeJSON, ThreadTreeJSON } from './types.ts';
