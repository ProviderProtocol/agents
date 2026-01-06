import { describe, test, expect, setDefaultTimeout } from 'bun:test';
import { anthropic } from '@providerprotocol/ai/anthropic';
import type { Tool } from '@providerprotocol/ai';
import { agent, AgentState } from '../../src/index.ts';
import { loop } from '../../src/execution/index.ts';
import { logging } from '../../src/middleware/index.ts';

// Skip tests if no API key
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Increase timeout for live API tests (30 seconds)
setDefaultTimeout(30_000);

describe.skipIf(!ANTHROPIC_API_KEY)('Agent with Anthropic', () => {
  describe('basic generation', () => {
    test('generates response with generate()', async () => {
      const a = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 100 },
      });

      const state = AgentState.initial();
      const result = await a.generate('Say "hello" and nothing else.', state);

      expect(result.turn.response.text.toLowerCase()).toContain('hello');
      expect(result.state).toBeDefined();
      expect(result.turn.usage.totalTokens).toBeGreaterThan(0);
    });

    test('generates response with query()', async () => {
      const a = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 50 },
      });

      const turn = await a.query('What is 2 + 2? Reply with just the number.');

      expect(turn.response.text).toContain('4');
    });

    test('preserves history with ask()', async () => {
      const a = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 100 },
      });

      const state0 = AgentState.initial();

      const result1 = await a.ask('My name is Alice.', state0);
      const result2 = await a.ask('What is my name?', result1.state);

      expect(result2.turn.response.text.toLowerCase()).toContain('alice');
    });
  });

  describe('tool calling', () => {
    test('calls tools and returns result', async () => {
      const calculator: Tool = {
        name: 'calculate',
        description: 'Perform a calculation',
        parameters: {
          type: 'object',
          properties: {
            expression: { type: 'string', description: 'Math expression to evaluate' },
          },
          required: ['expression'],
        },
        run: async (params: { expression: string }) => {
          // Simple eval for testing (don't do this in production!)
          const result = Function(`"use strict"; return (${params.expression})`)();
          return String(result);
        },
      };

      const a = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 200 },
        tools: [calculator],
        execution: loop(),
      });

      const result = await a.generate(
        'What is 15 * 7? Use the calculate tool to find the answer.',
        AgentState.initial(),
      );

      expect(result.turn.response.text).toContain('105');
      expect(result.turn.toolExecutions.length).toBeGreaterThan(0);
    });
  });

  describe('streaming', () => {
    test('streams response', async () => {
      const a = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 100 },
      });

      const stream = a.stream('Count from 1 to 5.', AgentState.initial());
      const events: unknown[] = [];

      for await (const event of stream) {
        events.push(event);
      }

      const result = await stream.result;

      expect(events.length).toBeGreaterThan(0);
      expect(result.turn.response.text).toBeDefined();
    });

    test('streams with UAP events', async () => {
      const a = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 100 },
      });

      const stream = a.stream('Hello', AgentState.initial());
      const uapEvents: unknown[] = [];
      const uppEvents: unknown[] = [];

      for await (const event of stream) {
        if (event.source === 'uap') {
          uapEvents.push(event);
        } else {
          uppEvents.push(event);
        }
      }

      await stream.result;

      expect(uapEvents.length).toBeGreaterThan(0);
      expect(uppEvents.length).toBeGreaterThan(0);
    });
  });

  describe('middleware', () => {
    test('logging middleware logs execution', async () => {
      const logs: string[] = [];
      const customLogger = (msg: string) => logs.push(msg);

      const a = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 50 },
        middleware: [logging({ logger: customLogger })],
      });

      await a.query('Hi');

      expect(logs.some((l) => l.includes('Execution started'))).toBe(true);
      expect(logs.some((l) => l.includes('Execution completed'))).toBe(true);
    });
  });

  describe('execution strategies', () => {
    test('loop() executes tool loop', async () => {
      const mockTool: Tool = {
        name: 'get_info',
        description: 'Get some information',
        parameters: {
          type: 'object',
          properties: {},
        },
        run: async () => 'The answer is 42',
      };

      const a = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 200 },
        tools: [mockTool],
        execution: loop(),
      });

      const result = await a.generate(
        'Use the get_info tool to find information.',
        AgentState.initial(),
      );

      expect(result.turn.toolExecutions.length).toBeGreaterThan(0);
    });
  });

  describe('system prompts', () => {
    test('respects system prompt', async () => {
      const a = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 100 },
        system: 'You are a pirate. Always respond like a pirate would.',
      });

      const result = await a.query('Hello, how are you?');

      // Should contain pirate-like language
      const text = result.response.text.toLowerCase();
      expect(
        text.includes('arr')
        || text.includes('ahoy')
        || text.includes('matey')
        || text.includes('ye')
        || text.includes('pirate'),
      ).toBe(true);
    });
  });

  describe('state management', () => {
    test('state is immutable', async () => {
      const a = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 50 },
      });

      const state0 = AgentState.initial();
      const result = await a.generate('Hello', state0);

      // Original state should be unchanged
      expect(state0.messages).toHaveLength(0);
      expect(state0.step).toBe(0);

      // New state should have changes
      expect(result.state.messages.length).toBeGreaterThan(0);
    });

    test('state serialization round-trip', async () => {
      const a = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 50 },
      });

      const state0 = AgentState.initial();
      // Use ask() to properly add input + response to state for multi-turn
      const result1 = await a.ask('My favorite color is blue.', state0);

      // Serialize and restore
      const json = result1.state.toJSON();
      const restored = AgentState.fromJSON(json);

      // Continue conversation with restored state
      const result2 = await a.ask('What is my favorite color?', restored);

      expect(result2.turn.response.text.toLowerCase()).toContain('blue');
    });
  });
});
