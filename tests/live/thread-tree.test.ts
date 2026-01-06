import { describe, test, expect, setDefaultTimeout } from 'bun:test';
import { anthropic } from '@providerprotocol/ai/anthropic';
import { agent, ThreadTree } from '../../src/index.ts';

// Skip tests if no API key
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Increase timeout for live API tests (60 seconds)
setDefaultTimeout(60_000);

describe.skipIf(!ANTHROPIC_API_KEY)('ThreadTree (Live)', () => {
  describe('basic branching', () => {
    test('maintains separate contexts in branches', async () => {
      const a = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 100 },
      });

      const tree = new ThreadTree();

      // First conversation in root
      const result1 = await a.ask('My name is Alice.', tree.history());
      tree.current.state = result1.state;

      // Create branch 1 from root
      const branch1Id = tree.branch(tree.root.id, 'branch-1');
      tree.checkout(branch1Id);

      // In branch 1, say name is Bob
      const branch1Result = await a.ask('Actually, my name is Bob.', tree.history());
      tree.current.state = branch1Result.state;

      // Create branch 2 from root (not from branch 1)
      const branch2Id = tree.branch(tree.root.id, 'branch-2');
      tree.checkout(branch2Id);

      // In branch 2, say name is Charlie
      const branch2Result = await a.ask('Actually, my name is Charlie.', tree.history());
      tree.current.state = branch2Result.state;

      // Verify branch 1 remembers Bob
      tree.checkout(branch1Id);
      const branch1Check = await a.ask('What is my name?', tree.history());
      expect(branch1Check.turn.response.text.toLowerCase()).toContain('bob');

      // Verify branch 2 remembers Charlie
      tree.checkout(branch2Id);
      const branch2Check = await a.ask('What is my name?', tree.history());
      expect(branch2Check.turn.response.text.toLowerCase()).toContain('charlie');
    });

    test('branch inherits parent state', async () => {
      const a = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 100 },
      });

      const tree = new ThreadTree();

      // Establish context in root
      const result1 = await a.ask('My favorite color is green.', tree.history());
      tree.current.state = result1.state;

      // Create branch
      const branchId = tree.branch(tree.root.id, 'color-branch');
      tree.checkout(branchId);

      // Branch should remember the color from parent
      const branchResult = await a.ask('What is my favorite color?', tree.history());
      expect(branchResult.turn.response.text.toLowerCase()).toContain('green');
    });
  });

  describe('serialization with live data', () => {
    test('serializes and restores tree with conversation history', async () => {
      const a = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 100 },
      });

      const tree = new ThreadTree();

      // Build conversation
      const result1 = await a.ask('Remember the number 42.', tree.history());
      tree.current.state = result1.state;

      // Create branch
      const branchId = tree.branch(tree.root.id, 'number-branch');
      tree.checkout(branchId);

      const result2 = await a.ask('The number is now 99.', tree.history());
      tree.current.state = result2.state;

      // Serialize
      const json = tree.toJSON();

      // Restore
      const restored = ThreadTree.fromJSON(json);

      // Verify restored tree has correct structure
      expect(restored.nodes.size).toBe(tree.nodes.size);
      expect(restored.root.id).toBe(tree.root.id);

      // Checkout branch and verify context
      restored.checkout(branchId);
      const checkResult = await a.ask('What number did I mention last?', restored.history());
      expect(checkResult.turn.response.text).toContain('99');
    });
  });

  describe('multiple branches', () => {
    test('supports multiple simultaneous branches', async () => {
      const a = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 100 },
      });

      const tree = new ThreadTree();

      // Setup base context
      const result = await a.ask('I am thinking of a secret word.', tree.history());
      tree.current.state = result.state;

      // Create 3 branches with different secrets
      const branch1Id = tree.branch(tree.root.id, 'branch-apple');
      tree.checkout(branch1Id);
      const r1 = await a.ask('The secret word is apple.', tree.history());
      tree.current.state = r1.state;

      const branch2Id = tree.branch(tree.root.id, 'branch-banana');
      tree.checkout(branch2Id);
      const r2 = await a.ask('The secret word is banana.', tree.history());
      tree.current.state = r2.state;

      const branch3Id = tree.branch(tree.root.id, 'branch-cherry');
      tree.checkout(branch3Id);
      const r3 = await a.ask('The secret word is cherry.', tree.history());
      tree.current.state = r3.state;

      // Verify leaves
      const leaves = tree.getLeaves();
      expect(leaves.length).toBe(3);

      // Verify each branch has correct secret
      tree.checkout(branch1Id);
      const check1 = await a.ask('What is the secret word?', tree.history());
      expect(check1.turn.response.text.toLowerCase()).toContain('apple');

      tree.checkout(branch2Id);
      const check2 = await a.ask('What is the secret word?', tree.history());
      expect(check2.turn.response.text.toLowerCase()).toContain('banana');

      tree.checkout(branch3Id);
      const check3 = await a.ask('What is the secret word?', tree.history());
      expect(check3.turn.response.text.toLowerCase()).toContain('cherry');
    });
  });

  describe('branch naming', () => {
    test('retrieves branches by name', async () => {
      const a = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 50 },
      });

      const tree = new ThreadTree();

      // Build initial state
      const result = await a.ask('Hello', tree.history());
      tree.current.state = result.state;

      // Create named branches
      tree.branch(tree.root.id, 'experiment-a');
      tree.branch(tree.root.id, 'experiment-b');
      tree.branch(tree.root.id, 'experiment-c');

      const branches = tree.getBranches();

      // Should have 4 branches (root + 3 named)
      expect(branches.size).toBe(4);
      expect([...branches.values()]).toContain('experiment-a');
      expect([...branches.values()]).toContain('experiment-b');
      expect([...branches.values()]).toContain('experiment-c');
    });
  });
});
