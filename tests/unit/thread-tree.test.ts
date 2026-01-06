import { describe, test, expect, beforeEach } from 'bun:test';
import { UserMessage, AssistantMessage } from '@providerprotocol/ai';
import { ThreadTree, ThreadNode } from '../../src/thread-tree/index.ts';
import { AgentState } from '../../src/state/index.ts';

describe('ThreadNode', () => {
  test('creates node with provided properties', () => {
    const state = AgentState.initial();
    const node = new ThreadNode('node-1', null, state, 'root');

    expect(node.id).toBe('node-1');
    expect(node.parentId).toBeNull();
    expect(node.state).toBe(state);
    expect(node.name).toBe('root');
    expect(node.children).toEqual([]);
  });

  test('serializes to JSON', () => {
    const state = AgentState.initial().withMessage(new UserMessage('Hello'));
    const node = new ThreadNode('node-1', 'parent-1', state, 'branch', ['child-1']);

    const json = node.toJSON();

    expect(json.id).toBe('node-1');
    expect(json.parentId).toBe('parent-1');
    expect(json.name).toBe('branch');
    expect(json.children).toEqual(['child-1']);
    expect(json.state.messages).toHaveLength(1);
  });

  test('deserializes from JSON', () => {
    const state = AgentState.initial().withMessage(new UserMessage('Hello'));
    const original = new ThreadNode('node-1', 'parent-1', state, 'branch', ['child-1']);

    const json = original.toJSON();
    const restored = ThreadNode.fromJSON(json);

    expect(restored.id).toBe(original.id);
    expect(restored.parentId).toBe(original.parentId);
    expect(restored.name).toBe(original.name);
    expect(restored.children).toEqual(original.children);
    expect(restored.state.messages.length).toBe(original.state.messages.length);
  });
});

describe('ThreadTree', () => {
  let tree: ThreadTree;

  beforeEach(() => {
    tree = new ThreadTree();
  });

  describe('constructor', () => {
    test('creates tree with root node', () => {
      expect(tree.root).toBeDefined();
      expect(tree.root.parentId).toBeNull();
      expect(tree.root.name).toBe('root');
    });

    test('sets current to root initially', () => {
      expect(tree.current).toBe(tree.root);
    });

    test('adds root to nodes map', () => {
      expect(tree.nodes.has(tree.root.id)).toBe(true);
      expect(tree.nodes.get(tree.root.id)).toBe(tree.root);
    });
  });

  describe('branch()', () => {
    test('creates new node from specified parent', () => {
      const newId = tree.branch(tree.root.id, 'feature-1');

      expect(newId).toBeDefined();
      expect(tree.nodes.has(newId)).toBe(true);
    });

    test('sets parent ID correctly', () => {
      const newId = tree.branch(tree.root.id);
      const newNode = tree.nodes.get(newId);

      expect(newNode?.parentId).toBe(tree.root.id);
    });

    test('adds child to parent', () => {
      const newId = tree.branch(tree.root.id);

      expect(tree.root.children).toContain(newId);
    });

    test('copies parent state to child', () => {
      tree.root.state = tree.root.state.withMessage(new UserMessage('Hello'));
      const newId = tree.branch(tree.root.id);
      const newNode = tree.nodes.get(newId);

      expect(newNode?.state.messages.length).toBe(tree.root.state.messages.length);
    });

    test('sets branch name', () => {
      const newId = tree.branch(tree.root.id, 'my-branch');
      const newNode = tree.nodes.get(newId);

      expect(newNode?.name).toBe('my-branch');
    });

    test('throws on invalid parent ID', () => {
      expect(() => tree.branch('invalid-id')).toThrow('Node not found');
    });
  });

  describe('checkout()', () => {
    test('switches current node', () => {
      const newId = tree.branch(tree.root.id, 'branch');
      tree.checkout(newId);

      expect(tree.current.id).toBe(newId);
    });

    test('throws on invalid node ID', () => {
      expect(() => tree.checkout('invalid-id')).toThrow('Node not found');
    });
  });

  describe('history()', () => {
    test('returns empty state for root with no messages', () => {
      const state = tree.history();

      expect(state.messages).toHaveLength(0);
    });

    test('returns root messages when at root', () => {
      tree.root.state = tree.root.state.withMessage(new UserMessage('Root message'));
      const state = tree.history();

      expect(state.messages).toHaveLength(1);
    });

    test('merges messages from root to current', () => {
      // Add message to root
      tree.root.state = tree.root.state.withMessage(new UserMessage('Root'));

      // Create branch and add message
      const branchId = tree.branch(tree.root.id);
      tree.checkout(branchId);
      tree.current.state = tree.current.state.withMessage(new AssistantMessage('Branch'));

      // Create child of branch and add message
      const childId = tree.branch(branchId);
      tree.checkout(childId);
      tree.current.state = tree.current.state.withMessage(new UserMessage('Child'));

      const state = tree.history();

      // Should have messages from root + branch + child
      // Note: Branch starts with copy of root's messages, so we have:
      // root: [Root]
      // branch: [Root, Branch] (inherited Root + added Branch)
      // child: [Root, Branch, Child] (inherited [Root, Branch] + added Child)
      expect(state.messages.length).toBeGreaterThanOrEqual(3);
    });

    test('preserves current node metadata', () => {
      const branchId = tree.branch(tree.root.id);
      tree.checkout(branchId);
      tree.current.state = tree.current.state.withStep(5);

      const state = tree.history();

      expect(state.step).toBe(5);
    });
  });

  describe('getLeaves()', () => {
    test('returns root as only leaf initially', () => {
      const leaves = tree.getLeaves();

      expect(leaves).toHaveLength(1);
      expect(leaves).toContain(tree.root.id);
    });

    test('returns only leaf nodes', () => {
      const branch1 = tree.branch(tree.root.id);
      const branch2 = tree.branch(tree.root.id);
      tree.branch(branch1); // child of branch1

      const leaves = tree.getLeaves();

      expect(leaves).toHaveLength(2); // branch1's child and branch2
      expect(leaves).not.toContain(tree.root.id);
      expect(leaves).not.toContain(branch1);
      expect(leaves).toContain(branch2);
    });
  });

  describe('getBranches()', () => {
    test('returns named branches', () => {
      tree.branch(tree.root.id, 'feature-1');
      tree.branch(tree.root.id, 'feature-2');
      tree.branch(tree.root.id); // unnamed

      const branches = tree.getBranches();

      expect(branches.size).toBeGreaterThanOrEqual(3); // includes root
    });
  });

  describe('serialization', () => {
    test('toJSON() serializes entire tree', () => {
      const branch1 = tree.branch(tree.root.id, 'b1');
      tree.branch(tree.root.id, 'b2'); // Create second branch for the test
      tree.checkout(branch1);

      const json = tree.toJSON();

      expect(json.rootId).toBe(tree.root.id);
      expect(json.currentId).toBe(branch1);
      expect(json.nodes).toHaveLength(3);
    });

    test('fromJSON() restores tree', () => {
      tree.root.state = tree.root.state.withMessage(new UserMessage('Root'));
      const branch1 = tree.branch(tree.root.id, 'b1');
      tree.checkout(branch1);
      tree.current.state = tree.current.state.withMessage(new AssistantMessage('Branch'));

      const json = tree.toJSON();
      const restored = ThreadTree.fromJSON(json);

      expect(restored.root.id).toBe(tree.root.id);
      expect(restored.current.id).toBe(branch1);
      expect(restored.nodes.size).toBe(tree.nodes.size);
    });

    test('round-trip preserves structure', () => {
      const b1 = tree.branch(tree.root.id, 'branch-1');
      const b2 = tree.branch(tree.root.id, 'branch-2');
      const b1c1 = tree.branch(b1, 'branch-1-child');
      tree.checkout(b1c1);

      const json = tree.toJSON();
      const restored = ThreadTree.fromJSON(json);

      expect(restored.root.children).toContain(b1);
      expect(restored.root.children).toContain(b2);
      expect(restored.nodes.get(b1)?.children).toContain(b1c1);
      expect(restored.current.id).toBe(b1c1);
    });
  });
});
