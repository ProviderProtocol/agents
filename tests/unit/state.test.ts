import { describe, test, expect, beforeEach } from 'bun:test';
import { UserMessage, AssistantMessage } from '@providerprotocol/ai';
import { AgentState } from '../../src/state/index.ts';
import type { PlanStep } from '../../src/state/index.ts';

describe('AgentState', () => {
  describe('initial()', () => {
    test('creates state with empty messages', () => {
      const state = AgentState.initial();
      expect(state.messages).toEqual([]);
    });

    test('creates state with step 0', () => {
      const state = AgentState.initial();
      expect(state.step).toBe(0);
    });

    test('creates state with empty metadata', () => {
      const state = AgentState.initial();
      expect(state.metadata).toEqual({});
    });

    test('creates state with empty reasoning', () => {
      const state = AgentState.initial();
      expect(state.reasoning).toEqual([]);
    });

    test('creates state with undefined plan', () => {
      const state = AgentState.initial();
      expect(state.plan).toBeUndefined();
    });

    test('creates state with unique UUIDv4 id', () => {
      const state1 = AgentState.initial();
      const state2 = AgentState.initial();

      expect(state1.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(state1.id).not.toBe(state2.id);
    });
  });

  describe('withMessage()', () => {
    let state: AgentState;

    beforeEach(() => {
      state = AgentState.initial();
    });

    test('returns new state with message added', () => {
      const message = new UserMessage('Hello');
      const newState = state.withMessage(message);

      expect(newState.messages).toHaveLength(1);
      expect(newState.messages[0]).toBe(message);
    });

    test('does not modify original state', () => {
      const message = new UserMessage('Hello');
      state.withMessage(message);

      expect(state.messages).toHaveLength(0);
    });

    test('returns state with new id', () => {
      const message = new UserMessage('Hello');
      const newState = state.withMessage(message);

      expect(newState.id).not.toBe(state.id);
    });

    test('preserves other state properties', () => {
      const stateWithMeta = state.withMetadata('key', 'value').withStep(5);
      const message = new UserMessage('Hello');
      const newState = stateWithMeta.withMessage(message);

      expect(newState.metadata).toEqual({ key: 'value' });
      expect(newState.step).toBe(5);
    });
  });

  describe('withMessages()', () => {
    test('appends multiple messages', () => {
      const state = AgentState.initial();
      const messages = [
        new UserMessage('Hello'),
        new AssistantMessage('Hi there!'),
      ];

      const newState = state.withMessages(messages);

      expect(newState.messages).toHaveLength(2);
    });

    test('appends to existing messages', () => {
      const state = AgentState.initial()
        .withMessage(new UserMessage('First'));

      const newState = state.withMessages([
        new AssistantMessage('Response'),
        new UserMessage('Second'),
      ]);

      expect(newState.messages).toHaveLength(3);
    });
  });

  describe('withStep()', () => {
    test('updates step number', () => {
      const state = AgentState.initial();
      const newState = state.withStep(5);

      expect(newState.step).toBe(5);
    });

    test('does not modify original state', () => {
      const state = AgentState.initial();
      state.withStep(5);

      expect(state.step).toBe(0);
    });
  });

  describe('withMetadata()', () => {
    test('adds metadata entry', () => {
      const state = AgentState.initial();
      const newState = state.withMetadata('key', 'value');

      expect(newState.metadata).toEqual({ key: 'value' });
    });

    test('updates existing metadata entry', () => {
      const state = AgentState.initial()
        .withMetadata('key', 'old');

      const newState = state.withMetadata('key', 'new');

      expect(newState.metadata).toEqual({ key: 'new' });
    });

    test('preserves other metadata entries', () => {
      const state = AgentState.initial()
        .withMetadata('a', 1)
        .withMetadata('b', 2);

      const newState = state.withMetadata('c', 3);

      expect(newState.metadata).toEqual({ a: 1, b: 2, c: 3 });
    });
  });

  describe('withReasoning()', () => {
    test('appends reasoning trace', () => {
      const state = AgentState.initial();
      const newState = state.withReasoning('I should do X');

      expect(newState.reasoning).toEqual(['I should do X']);
    });

    test('appends to existing reasoning', () => {
      const state = AgentState.initial()
        .withReasoning('First thought');

      const newState = state.withReasoning('Second thought');

      expect(newState.reasoning).toEqual(['First thought', 'Second thought']);
    });
  });

  describe('withPlan()', () => {
    test('sets plan', () => {
      const state = AgentState.initial();
      const plan: PlanStep[] = [
        { id: '1', description: 'Step 1', dependsOn: [], status: 'pending' },
        { id: '2', description: 'Step 2', dependsOn: ['1'], status: 'pending' },
      ];

      const newState = state.withPlan(plan);

      expect(newState.plan).toHaveLength(2);
      expect(newState.plan?.[0]?.description).toBe('Step 1');
    });

    test('replaces existing plan', () => {
      const state = AgentState.initial()
        .withPlan([{ id: '1', description: 'Old', dependsOn: [], status: 'pending' }]);

      const newPlan: PlanStep[] = [
        { id: '2', description: 'New', dependsOn: [], status: 'pending' },
      ];

      const newState = state.withPlan(newPlan);

      expect(newState.plan).toHaveLength(1);
      expect(newState.plan?.[0]?.description).toBe('New');
    });
  });

  describe('serialization', () => {
    test('toJSON() serializes all properties', () => {
      const state = AgentState.initial()
        .withMessage(new UserMessage('Hello'))
        .withStep(3)
        .withMetadata('key', 'value')
        .withReasoning('Thinking...')
        .withPlan([{ id: '1', description: 'Step', dependsOn: [], status: 'pending' }]);

      const json = state.toJSON();

      expect(json.version).toBe('1.0.0');
      expect(json.id).toBe(state.id);
      expect(json.messages).toHaveLength(1);
      expect(json.step).toBe(3);
      expect(json.metadata).toEqual({ key: 'value' });
      expect(json.reasoning).toEqual(['Thinking...']);
      expect(json.plan).toHaveLength(1);
    });

    test('fromJSON() deserializes correctly', () => {
      const original = AgentState.initial()
        .withMessage(new UserMessage('Hello'))
        .withStep(3)
        .withMetadata('key', 'value')
        .withReasoning('Thinking...');

      const json = original.toJSON();
      const restored = AgentState.fromJSON(json);

      expect(restored.id).toBe(original.id);
      expect(restored.messages).toHaveLength(1);
      expect(restored.step).toBe(3);
      expect(restored.metadata).toEqual({ key: 'value' });
      expect(restored.reasoning).toEqual(['Thinking...']);
    });

    test('round-trip preserves data', () => {
      const original = AgentState.initial()
        .withMessage(new UserMessage('Hello'))
        .withMessage(new AssistantMessage('Hi'))
        .withStep(5)
        .withMetadata('count', 42)
        .withReasoning('First')
        .withReasoning('Second')
        .withPlan([
          { id: '1', description: 'A', dependsOn: [], status: 'completed' },
          { id: '2', description: 'B', dependsOn: ['1'], status: 'pending' },
        ]);

      const json = original.toJSON();
      const restored = AgentState.fromJSON(json);

      expect(restored.id).toBe(original.id);
      expect(restored.messages.length).toBe(original.messages.length);
      expect(restored.step).toBe(original.step);
      expect(restored.metadata).toEqual(original.metadata);
      expect(restored.reasoning).toEqual([...original.reasoning]);
      expect(restored.plan?.length).toBe(original.plan?.length);
    });

    test('fromJSON() throws on version mismatch', () => {
      const json = {
        version: '2.0.0',
        id: 'test',
        messages: [],
        step: 0,
        metadata: {},
        reasoning: [],
      };

      expect(() => AgentState.fromJSON(json)).toThrow('Unsupported UAP version');
    });
  });

  describe('immutability', () => {
    test('all operations return new instances', () => {
      const state = AgentState.initial();
      const operations = [
        () => state.withMessage(new UserMessage('test')),
        () => state.withMessages([new UserMessage('test')]),
        () => state.withStep(1),
        () => state.withMetadata('key', 'value'),
        () => state.withReasoning('thinking'),
        () => state.withPlan([{ id: '1', description: 'test', dependsOn: [], status: 'pending' }]),
      ];

      for (const op of operations) {
        const newState = op();
        expect(newState).not.toBe(state);
        expect(newState.id).not.toBe(state.id);
      }
    });

    test('each state has unique ID', () => {
      const ids = new Set<string>();
      let state = AgentState.initial();
      ids.add(state.id);

      for (let i = 0; i < 10; i++) {
        state = state.withStep(i);
        expect(ids.has(state.id)).toBe(false);
        ids.add(state.id);
      }

      expect(ids.size).toBe(11);
    });
  });
});
