import { describe, test, expect } from 'bun:test';
import { UserMessage, AssistantMessage } from '@providerprotocol/ai';
import type { Turn, Tool, ModelReference, LLMInstance } from '@providerprotocol/ai';
import { agent } from '../../src/agent/index.ts';
import { AgentState } from '../../src/state/index.ts';
import type { ExecutionStrategy } from '../../src/execution/types.ts';
import type { Middleware } from '../../src/middleware/types.ts';

// Mock model reference - use unknown cast for unit tests
const mockModel = {
  provider: 'mock',
  modelId: 'mock-model',
} as unknown as ModelReference;

// Mock Turn factory
function createMockTurn(text: string = 'Response'): Turn {
  const response = new AssistantMessage(text);
  return {
    response,
    messages: [response],
    toolExecutions: [],
    usage: {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
    },
    cycles: 1,
  } as unknown as Turn;
}

// Mock LLM instance for testing
const mockLLM = {
  generate: async () => createMockTurn(),
  stream: () => ({
    async *[Symbol.asyncIterator] () {},
    turn: Promise.resolve(createMockTurn()),
  }),
} as unknown as LLMInstance;

describe('agent()', () => {
  describe('creation', () => {
    test('creates agent with unique ID', () => {
      // Create a custom execution strategy for testing
      const mockStrategy: ExecutionStrategy = {
        name: 'mock',
        async execute() {
          return {
            turn: createMockTurn(),
            state: AgentState.initial(),
          };
        },
        stream() {
          return {
            async *[Symbol.asyncIterator] () {},
            result: Promise.resolve({
              turn: createMockTurn(),
              state: AgentState.initial(),
            }),
            abort: () => {},
          };
        },
      };

      const agent1 = agent({
        model: mockModel,
        execution: mockStrategy,
        _llmInstance: mockLLM,
      });

      const agent2 = agent({
        model: mockModel,
        execution: mockStrategy,
        _llmInstance: mockLLM,
      });

      expect(agent1.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(agent1.id).not.toBe(agent2.id);
    });

    test('stores model reference', () => {
      const mockStrategy: ExecutionStrategy = {
        name: 'mock',
        async execute() {
          return {
            turn: createMockTurn(),
            state: AgentState.initial(),
          };
        },
        stream() {
          return {
            async *[Symbol.asyncIterator] () {},
            result: Promise.resolve({
              turn: createMockTurn(),
              state: AgentState.initial(),
            }),
            abort: () => {},
          };
        },
      };

      const a = agent({
        model: mockModel,
        execution: mockStrategy,
        _llmInstance: mockLLM,
      });

      expect(a.model).toBe(mockModel);
    });

    test('stores tools', () => {
      const mockTool: Tool = {
        name: 'test_tool',
        description: 'A test tool',
        parameters: { type: 'object', properties: {} },
        run: async () => 'result',
      };

      const mockStrategy: ExecutionStrategy = {
        name: 'mock',
        async execute() {
          return {
            turn: createMockTurn(),
            state: AgentState.initial(),
          };
        },
        stream() {
          return {
            async *[Symbol.asyncIterator] () {},
            result: Promise.resolve({
              turn: createMockTurn(),
              state: AgentState.initial(),
            }),
            abort: () => {},
          };
        },
      };

      const a = agent({
        model: mockModel,
        tools: [mockTool],
        execution: mockStrategy,
        _llmInstance: mockLLM,
      });

      expect(a.tools).toHaveLength(1);
      expect(a.tools[0]).toBe(mockTool);
    });

    test('stores system prompt', () => {
      const mockStrategy: ExecutionStrategy = {
        name: 'mock',
        async execute() {
          return {
            turn: createMockTurn(),
            state: AgentState.initial(),
          };
        },
        stream() {
          return {
            async *[Symbol.asyncIterator] () {},
            result: Promise.resolve({
              turn: createMockTurn(),
              state: AgentState.initial(),
            }),
            abort: () => {},
          };
        },
      };

      const a = agent({
        model: mockModel,
        system: 'You are a helpful assistant.',
        execution: mockStrategy,
        _llmInstance: mockLLM,
      });

      expect(a.system).toBe('You are a helpful assistant.');
    });

    test('defaults to empty tools array', () => {
      const mockStrategy: ExecutionStrategy = {
        name: 'mock',
        async execute() {
          return {
            turn: createMockTurn(),
            state: AgentState.initial(),
          };
        },
        stream() {
          return {
            async *[Symbol.asyncIterator] () {},
            result: Promise.resolve({
              turn: createMockTurn(),
              state: AgentState.initial(),
            }),
            abort: () => {},
          };
        },
      };

      const a = agent({
        model: mockModel,
        execution: mockStrategy,
        _llmInstance: mockLLM,
      });

      expect(a.tools).toEqual([]);
    });
  });

  describe('generate()', () => {
    test('accepts string input', async () => {
      let capturedInput: unknown;

      const mockStrategy: ExecutionStrategy = {
        name: 'mock',
        async execute(ctx) {
          capturedInput = ctx.input;
          return {
            turn: createMockTurn(),
            state: ctx.state,
          };
        },
        stream() {
          return {
            async *[Symbol.asyncIterator] () {},
            result: Promise.resolve({
              turn: createMockTurn(),
              state: AgentState.initial(),
            }),
            abort: () => {},
          };
        },
      };

      const a = agent({
        model: mockModel,
        execution: mockStrategy,
        _llmInstance: mockLLM,
      });

      await a.generate('Hello', AgentState.initial());

      expect(capturedInput).toBeInstanceOf(UserMessage);
    });

    test('accepts Message input', async () => {
      let capturedInput: unknown;
      const inputMessage = new UserMessage('Hello');

      const mockStrategy: ExecutionStrategy = {
        name: 'mock',
        async execute(ctx) {
          capturedInput = ctx.input;
          return {
            turn: createMockTurn(),
            state: ctx.state,
          };
        },
        stream() {
          return {
            async *[Symbol.asyncIterator] () {},
            result: Promise.resolve({
              turn: createMockTurn(),
              state: AgentState.initial(),
            }),
            abort: () => {},
          };
        },
      };

      const a = agent({
        model: mockModel,
        execution: mockStrategy,
        _llmInstance: mockLLM,
      });

      await a.generate(inputMessage, AgentState.initial());

      expect(capturedInput).toBe(inputMessage);
    });

    test('returns turn and state', async () => {
      const mockTurn = createMockTurn('Test response');
      const mockState = AgentState.initial().withStep(1);

      const mockStrategy: ExecutionStrategy = {
        name: 'mock',
        async execute() {
          return {
            turn: mockTurn,
            state: mockState,
          };
        },
        stream() {
          return {
            async *[Symbol.asyncIterator] () {},
            result: Promise.resolve({
              turn: mockTurn,
              state: mockState,
            }),
            abort: () => {},
          };
        },
      };

      const a = agent({
        model: mockModel,
        execution: mockStrategy,
        _llmInstance: mockLLM,
      });

      const result = await a.generate('Hello', AgentState.initial());

      expect(result.turn).toBe(mockTurn);
      expect(result.state).toBe(mockState);
    });

    test('passes state to execution strategy', async () => {
      let capturedState: AgentState | undefined;
      const inputState = AgentState.initial()
        .withStep(5)
        .withMetadata('test', 'value');

      const mockStrategy: ExecutionStrategy = {
        name: 'mock',
        async execute(ctx) {
          capturedState = ctx.state;
          return {
            turn: createMockTurn(),
            state: ctx.state,
          };
        },
        stream() {
          return {
            async *[Symbol.asyncIterator] () {},
            result: Promise.resolve({
              turn: createMockTurn(),
              state: AgentState.initial(),
            }),
            abort: () => {},
          };
        },
      };

      const a = agent({
        model: mockModel,
        execution: mockStrategy,
        _llmInstance: mockLLM,
      });

      await a.generate('Hello', inputState);

      expect(capturedState?.step).toBe(5);
      expect(capturedState?.metadata).toEqual({ test: 'value' });
    });
  });

  describe('ask()', () => {
    test('preserves conversation history', async () => {
      let callCount = 0;

      const mockStrategy: ExecutionStrategy = {
        name: 'mock',
        async execute(ctx) {
          callCount++;
          return {
            turn: createMockTurn(`Response ${callCount}`),
            state: ctx.state.withStep(callCount),
          };
        },
        stream() {
          return {
            async *[Symbol.asyncIterator] () {},
            result: Promise.resolve({
              turn: createMockTurn(),
              state: AgentState.initial(),
            }),
            abort: () => {},
          };
        },
      };

      const a = agent({
        model: mockModel,
        execution: mockStrategy,
        _llmInstance: mockLLM,
      });

      const state0 = AgentState.initial();
      const result1 = await a.ask('First message', state0);

      // State should have the input message added
      expect(result1.state.messages.length).toBeGreaterThan(0);

      const result2 = await a.ask('Second message', result1.state);

      // State should have accumulated messages
      expect(result2.state.messages.length).toBeGreaterThan(result1.state.messages.length);
    });
  });

  describe('query()', () => {
    test('is stateless', async () => {
      const mockStrategy: ExecutionStrategy = {
        name: 'mock',
        async execute(ctx) {
          // State should be fresh
          expect(ctx.state.messages).toHaveLength(0);
          expect(ctx.state.step).toBe(0);

          return {
            turn: createMockTurn(),
            state: ctx.state,
          };
        },
        stream() {
          return {
            async *[Symbol.asyncIterator] () {},
            result: Promise.resolve({
              turn: createMockTurn(),
              state: AgentState.initial(),
            }),
            abort: () => {},
          };
        },
      };

      const a = agent({
        model: mockModel,
        execution: mockStrategy,
        _llmInstance: mockLLM,
      });

      const turn = await a.query('Question');

      expect(turn).toBeDefined();
      expect(turn.response.text).toBe('Response');
    });

    test('returns only Turn, not state', async () => {
      const mockStrategy: ExecutionStrategy = {
        name: 'mock',
        async execute(ctx) {
          return {
            turn: createMockTurn('Answer'),
            state: ctx.state,
          };
        },
        stream() {
          return {
            async *[Symbol.asyncIterator] () {},
            result: Promise.resolve({
              turn: createMockTurn(),
              state: AgentState.initial(),
            }),
            abort: () => {},
          };
        },
      };

      const a = agent({
        model: mockModel,
        execution: mockStrategy,
        _llmInstance: mockLLM,
      });

      const turn = await a.query('Question');

      // Should return Turn, not GenerateResult
      expect(turn.response).toBeDefined();
      expect(turn.response.text).toBe('Answer');
      expect((turn as unknown as { state?: unknown }).state).toBeUndefined();
    });
  });

  describe('middleware', () => {
    test('runs before middleware in order', async () => {
      const order: string[] = [];

      const mw1: Middleware = {
        name: 'first',
        async before(ctx) {
          order.push('first-before');
          return ctx;
        },
      };

      const mw2: Middleware = {
        name: 'second',
        async before(ctx) {
          order.push('second-before');
          return ctx;
        },
      };

      const mockStrategy: ExecutionStrategy = {
        name: 'mock',
        async execute(ctx) {
          order.push('execute');
          return {
            turn: createMockTurn(),
            state: ctx.state,
          };
        },
        stream() {
          return {
            async *[Symbol.asyncIterator] () {},
            result: Promise.resolve({
              turn: createMockTurn(),
              state: AgentState.initial(),
            }),
            abort: () => {},
          };
        },
      };

      const a = agent({
        model: mockModel,
        middleware: [mw1, mw2],
        execution: mockStrategy,
        _llmInstance: mockLLM,
      });

      await a.generate('Hello', AgentState.initial());

      expect(order).toEqual(['first-before', 'second-before', 'execute']);
    });

    test('runs after middleware in reverse order', async () => {
      const order: string[] = [];

      const mw1: Middleware = {
        name: 'first',
        async after(ctx, result) {
          order.push('first-after');
          return result;
        },
      };

      const mw2: Middleware = {
        name: 'second',
        async after(ctx, result) {
          order.push('second-after');
          return result;
        },
      };

      const mockStrategy: ExecutionStrategy = {
        name: 'mock',
        async execute(ctx) {
          order.push('execute');
          return {
            turn: createMockTurn(),
            state: ctx.state,
          };
        },
        stream() {
          return {
            async *[Symbol.asyncIterator] () {},
            result: Promise.resolve({
              turn: createMockTurn(),
              state: AgentState.initial(),
            }),
            abort: () => {},
          };
        },
      };

      const a = agent({
        model: mockModel,
        middleware: [mw1, mw2],
        execution: mockStrategy,
        _llmInstance: mockLLM,
      });

      await a.generate('Hello', AgentState.initial());

      expect(order).toEqual(['execute', 'second-after', 'first-after']);
    });

    test('middleware can modify result', async () => {
      const mw: Middleware = {
        name: 'modifier',
        async after(ctx, result) {
          return {
            ...result,
            state: result.state.withMetadata('modified', true),
          };
        },
      };

      const mockStrategy: ExecutionStrategy = {
        name: 'mock',
        async execute(ctx) {
          return {
            turn: createMockTurn(),
            state: ctx.state,
          };
        },
        stream() {
          return {
            async *[Symbol.asyncIterator] () {},
            result: Promise.resolve({
              turn: createMockTurn(),
              state: AgentState.initial(),
            }),
            abort: () => {},
          };
        },
      };

      const a = agent({
        model: mockModel,
        middleware: [mw],
        execution: mockStrategy,
        _llmInstance: mockLLM,
      });

      const result = await a.generate('Hello', AgentState.initial());

      expect(result.state.metadata).toEqual({ modified: true });
    });
  });

  describe('stream()', () => {
    test('returns AgentStreamResult', async () => {
      const mockStrategy: ExecutionStrategy = {
        name: 'mock',
        async execute(ctx) {
          return {
            turn: createMockTurn(),
            state: ctx.state,
          };
        },
        stream() {
          return {
            async *[Symbol.asyncIterator] () {
              yield { source: 'uap' as const, uap: { type: 'step_start' as const, step: 1, agentId: 'test', data: {} } };
            },
            result: Promise.resolve({
              turn: createMockTurn(),
              state: AgentState.initial(),
            }),
            abort: () => {},
          };
        },
      };

      const a = agent({
        model: mockModel,
        execution: mockStrategy,
        _llmInstance: mockLLM,
      });

      const stream = a.stream('Hello', AgentState.initial());

      expect(stream[Symbol.asyncIterator]).toBeDefined();
      expect(stream.result).toBeInstanceOf(Promise);
      expect(typeof stream.abort).toBe('function');
    });

    test('yields events from strategy', async () => {
      const mockStrategy: ExecutionStrategy = {
        name: 'mock',
        async execute(ctx) {
          return {
            turn: createMockTurn(),
            state: ctx.state,
          };
        },
        stream() {
          return {
            async *[Symbol.asyncIterator] () {
              yield { source: 'uap' as const, uap: { type: 'step_start' as const, step: 1, agentId: 'test', data: {} } };
              yield { source: 'uap' as const, uap: { type: 'step_end' as const, step: 1, agentId: 'test', data: {} } };
            },
            result: Promise.resolve({
              turn: createMockTurn(),
              state: AgentState.initial(),
            }),
            abort: () => {},
          };
        },
      };

      const a = agent({
        model: mockModel,
        execution: mockStrategy,
        _llmInstance: mockLLM,
      });

      const stream = a.stream('Hello', AgentState.initial());
      const events: unknown[] = [];

      for await (const event of stream) {
        events.push(event);
      }

      expect(events).toHaveLength(2);
    });
  });
});
