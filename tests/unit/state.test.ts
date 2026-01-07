import { describe, test, expect, beforeEach } from 'bun:test';
import { UserMessage, AssistantMessage } from '@providerprotocol/ai';
import { AgentState } from '../../src/state/index.ts';
import type { PlanStep, SubagentExecutionTrace } from '../../src/state/index.ts';

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

    test('creates state with empty subagentTraces', () => {
      const state = AgentState.initial();
      expect(state.subagentTraces).toEqual([]);
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

  describe('withContext()', () => {
    test('replaces all messages', () => {
      const state = AgentState.initial()
        .withMessage(new UserMessage('First'))
        .withMessage(new AssistantMessage('Response'))
        .withMessage(new UserMessage('Second'));

      const newMessages = [
        new UserMessage('Replacement'),
      ];

      const newState = state.withContext(newMessages);

      expect(newState.messages).toHaveLength(1);
      expect(newState.messages[0]).toBe(newMessages[0]);
    });

    test('does not modify original state', () => {
      const originalMessage = new UserMessage('Original');
      const state = AgentState.initial()
        .withMessage(originalMessage);

      state.withContext([new UserMessage('Replacement')]);

      expect(state.messages).toHaveLength(1);
      expect(state.messages[0]).toBe(originalMessage);
    });

    test('returns state with new id', () => {
      const state = AgentState.initial()
        .withMessage(new UserMessage('Hello'));

      const newState = state.withContext([new UserMessage('New')]);

      expect(newState.id).not.toBe(state.id);
    });

    test('preserves other state properties', () => {
      const state = AgentState.initial()
        .withMessage(new UserMessage('Original'))
        .withStep(5)
        .withMetadata('key', 'value')
        .withReasoning('Some reasoning');

      const newState = state.withContext([new UserMessage('Replaced')]);

      expect(newState.step).toBe(5);
      expect(newState.metadata).toEqual({ key: 'value' });
      expect(newState.reasoning).toEqual(['Some reasoning']);
    });

    test('can replace with empty messages array', () => {
      const state = AgentState.initial()
        .withMessage(new UserMessage('First'))
        .withMessage(new AssistantMessage('Second'));

      const newState = state.withContext([]);

      expect(newState.messages).toHaveLength(0);
    });

    test('enables context window management patterns', () => {
      // Simulate pruning old tool outputs
      const state = AgentState.initial()
        .withMessage(new UserMessage('Query 1'))
        .withMessage(new AssistantMessage('Long tool output response 1'))
        .withMessage(new UserMessage('Query 2'))
        .withMessage(new AssistantMessage('Long tool output response 2'))
        .withMessage(new UserMessage('Query 3'));

      // Prune to keep only last 2 messages (simulating context management)
      const prunedMessages = state.messages.slice(-2);
      const newState = state.withContext([...prunedMessages]);

      expect(newState.messages).toHaveLength(2);
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

  describe('withSubagentTrace()', () => {
    test('adds subagent trace', () => {
      const state = AgentState.initial();
      const trace: SubagentExecutionTrace = {
        subagentId: 'agent-123',
        subagentType: 'explorer',
        parentToolCallId: 'tool-456',
        prompt: 'Find all TypeScript files',
        startTime: 1000,
        endTime: 2000,
        success: true,
        result: 'Found 10 files',
        toolExecutions: [
          {
            toolName: 'Glob',
            toolCallId: 'glob-001',
            arguments: { pattern: '**/*.ts' },
            result: 'file1.ts, file2.ts',
            duration: 50,
          },
        ],
      };

      const newState = state.withSubagentTrace(trace);

      expect(newState.subagentTraces).toHaveLength(1);
      expect(newState.subagentTraces[0]).toEqual(trace);
    });

    test('appends to existing traces', () => {
      const trace1: SubagentExecutionTrace = {
        subagentId: 'agent-1',
        subagentType: 'explorer',
        parentToolCallId: 'tool-1',
        prompt: 'First task',
        startTime: 1000,
        endTime: 1500,
        success: true,
      };

      const trace2: SubagentExecutionTrace = {
        subagentId: 'agent-2',
        subagentType: 'planner',
        parentToolCallId: 'tool-2',
        prompt: 'Second task',
        startTime: 2000,
        endTime: 2500,
        success: true,
      };

      const state = AgentState.initial()
        .withSubagentTrace(trace1);
      const newState = state.withSubagentTrace(trace2);

      expect(newState.subagentTraces).toHaveLength(2);
      expect(newState.subagentTraces[0]?.subagentId).toBe('agent-1');
      expect(newState.subagentTraces[1]?.subagentId).toBe('agent-2');
    });

    test('does not modify original state', () => {
      const state = AgentState.initial();
      const trace: SubagentExecutionTrace = {
        subagentId: 'agent-123',
        subagentType: 'explorer',
        parentToolCallId: 'tool-456',
        prompt: 'Test',
        startTime: 1000,
        endTime: 2000,
        success: true,
      };

      state.withSubagentTrace(trace);

      expect(state.subagentTraces).toHaveLength(0);
    });

    test('preserves other state properties', () => {
      const state = AgentState.initial()
        .withMessage(new UserMessage('Hello'))
        .withStep(3)
        .withMetadata('key', 'value');

      const trace: SubagentExecutionTrace = {
        subagentId: 'agent-123',
        subagentType: 'explorer',
        parentToolCallId: 'tool-456',
        prompt: 'Test',
        startTime: 1000,
        endTime: 2000,
        success: true,
      };

      const newState = state.withSubagentTrace(trace);

      expect(newState.messages).toHaveLength(1);
      expect(newState.step).toBe(3);
      expect(newState.metadata).toEqual({ key: 'value' });
    });
  });

  describe('serialization', () => {
    test('toJSON() serializes all properties', () => {
      const trace: SubagentExecutionTrace = {
        subagentId: 'agent-123',
        subagentType: 'explorer',
        parentToolCallId: 'tool-456',
        prompt: 'Test prompt',
        startTime: 1000,
        endTime: 2000,
        success: true,
        result: 'Test result',
        toolExecutions: [{ toolName: 'Glob', arguments: {}, result: 'files' }],
      };

      const state = AgentState.initial()
        .withMessage(new UserMessage('Hello'))
        .withStep(3)
        .withMetadata('key', 'value')
        .withReasoning('Thinking...')
        .withPlan([{ id: '1', description: 'Step', dependsOn: [], status: 'pending' }])
        .withSubagentTrace(trace);

      const json = state.toJSON();

      expect(json.version).toBe('1.0.0');
      expect(json.id).toBe(state.id);
      expect(json.messages).toHaveLength(1);
      expect(json.step).toBe(3);
      expect(json.metadata).toEqual({ key: 'value' });
      expect(json.reasoning).toEqual(['Thinking...']);
      expect(json.plan).toHaveLength(1);
      expect(json.subagentTraces).toHaveLength(1);
      expect(json.subagentTraces?.[0]?.subagentId).toBe('agent-123');
    });

    test('toJSON() omits subagentTraces when empty', () => {
      const state = AgentState.initial();
      const json = state.toJSON();

      expect(json.subagentTraces).toBeUndefined();
    });

    test('fromJSON() deserializes correctly', () => {
      const trace: SubagentExecutionTrace = {
        subagentId: 'agent-123',
        subagentType: 'explorer',
        parentToolCallId: 'tool-456',
        prompt: 'Test',
        startTime: 1000,
        endTime: 2000,
        success: true,
      };

      const original = AgentState.initial()
        .withMessage(new UserMessage('Hello'))
        .withStep(3)
        .withMetadata('key', 'value')
        .withReasoning('Thinking...')
        .withSubagentTrace(trace);

      const json = original.toJSON();
      const restored = AgentState.fromJSON(json);

      expect(restored.id).toBe(original.id);
      expect(restored.messages).toHaveLength(1);
      expect(restored.step).toBe(3);
      expect(restored.metadata).toEqual({ key: 'value' });
      expect(restored.reasoning).toEqual(['Thinking...']);
      expect(restored.subagentTraces).toHaveLength(1);
      expect(restored.subagentTraces[0]?.subagentId).toBe('agent-123');
    });

    test('fromJSON() handles missing subagentTraces', () => {
      const json = {
        version: '1.0.0',
        id: 'test-id',
        messages: [],
        step: 0,
        metadata: {},
        reasoning: [],
        // No subagentTraces field
      };

      const restored = AgentState.fromJSON(json);
      expect(restored.subagentTraces).toEqual([]);
    });

    test('round-trip preserves data', () => {
      const trace: SubagentExecutionTrace = {
        subagentId: 'agent-roundtrip',
        subagentType: 'explorer',
        parentToolCallId: 'tool-rt',
        prompt: 'Round trip test',
        startTime: 1000,
        endTime: 2000,
        success: true,
        result: 'Found it',
        toolExecutions: [
          {
            toolName: 'Glob',
            toolCallId: 'glob-rt',
            arguments: { pattern: '*.ts' },
            result: 'file.ts',
            duration: 100,
          },
        ],
      };

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
        ])
        .withSubagentTrace(trace);

      const json = original.toJSON();
      const restored = AgentState.fromJSON(json);

      expect(restored.id).toBe(original.id);
      expect(restored.messages.length).toBe(original.messages.length);
      expect(restored.step).toBe(original.step);
      expect(restored.metadata).toEqual(original.metadata);
      expect(restored.reasoning).toEqual([...original.reasoning]);
      expect(restored.plan?.length).toBe(original.plan?.length);
      expect(restored.subagentTraces.length).toBe(original.subagentTraces.length);
      expect(restored.subagentTraces[0]?.subagentId).toBe('agent-roundtrip');
      expect(restored.subagentTraces[0]?.toolExecutions?.[0]?.toolName).toBe('Glob');
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
        () => state.withContext([new UserMessage('test')]),
        () => state.withStep(1),
        () => state.withMetadata('key', 'value'),
        () => state.withReasoning('thinking'),
        () => state.withPlan([{ id: '1', description: 'test', dependsOn: [], status: 'pending' }]),
        () => state.withSubagentTrace({
          subagentId: 'test',
          subagentType: 'explorer',
          parentToolCallId: 'tool-1',
          prompt: 'test',
          startTime: 1000,
          endTime: 2000,
          success: true,
        }),
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
