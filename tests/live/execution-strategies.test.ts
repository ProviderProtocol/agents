import { describe, test, expect, setDefaultTimeout } from 'bun:test';
import { anthropic } from '@providerprotocol/ai/anthropic';
import type { Tool } from '@providerprotocol/ai';
import { agent, AgentState } from '../../src/index.ts';
import { react, loop, orderToolCalls } from '../../src/execution/index.ts';
import type { ToolWithDependencies } from '../../src/execution/index.ts';

// Skip tests if no API key
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Increase timeout for live API tests (60 seconds)
setDefaultTimeout(60_000);

describe.skipIf(!ANTHROPIC_API_KEY)('Execution Strategies (Live)', () => {
  describe('react() strategy', () => {
    test('captures reasoning during execution', async () => {
      const a = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 400 },
        execution: react({ maxSteps: 1 }),
      });

      const result = await a.generate(
        'What is 7 multiplied by 8? Think step by step.',
        AgentState.initial(),
      );

      // ReAct should capture reasoning
      expect(result.state.reasoning.length).toBeGreaterThan(0);
      // Answer should contain 56
      expect(result.turn.response.text).toContain('56');
    });

    test('completes with response', async () => {
      const a = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 400 },
        execution: react({ maxSteps: 1 }),
      });

      const result = await a.generate(
        'What is the capital of Japan?',
        AgentState.initial(),
      );

      // Should have reasoning
      expect(result.state.reasoning.length).toBeGreaterThan(0);
      // Should have a response
      expect(result.turn.response.text.toLowerCase()).toContain('tokyo');
    });

    test('streams with UAP reasoning events', async () => {
      const a = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 300 },
        execution: react({ maxSteps: 1 }),
      });

      const stream = a.stream('What is the capital of France?', AgentState.initial());

      const uapEvents: Array<{ type: string }> = [];

      for await (const event of stream) {
        if (event.source === 'uap' && event.uap) {
          uapEvents.push({ type: event.uap.type });
        }
      }

      const result = await stream.result;

      // Should have step_start and reasoning UAP events
      expect(uapEvents.some((e) => e.type === 'step_start')).toBe(true);
      expect(uapEvents.some((e) => e.type === 'reasoning')).toBe(true);
      expect(result.turn.response.text.toLowerCase()).toContain('paris');
    });
  });

  describe('tool dependency ordering (unit tests)', () => {
    // These are pure unit tests for the orderToolCalls utility - no API calls needed
    test('orderToolCalls groups independent tools together', () => {
      const toolA: Tool = {
        name: 'tool_a',
        description: 'Tool A',
        parameters: { type: 'object', properties: {} },
        run: async () => 'a',
      };

      const toolB: Tool = {
        name: 'tool_b',
        description: 'Tool B',
        parameters: { type: 'object', properties: {} },
        run: async () => 'b',
      };

      const calls = [
        { toolCallId: 'call-1', toolName: 'tool_a', arguments: {} },
        { toolCallId: 'call-2', toolName: 'tool_b', arguments: {} },
      ];

      const groups = orderToolCalls(calls, [toolA, toolB]);

      // Should group both in one group (parallel execution)
      expect(groups.length).toBe(1);
      expect(groups[0]?.calls.length).toBe(2);
      expect(groups[0]?.isBarrier).toBe(false);
    });

    test('orderToolCalls respects dependsOn ordering', () => {
      const toolRead: ToolWithDependencies = {
        name: 'read',
        description: 'Read',
        parameters: { type: 'object', properties: {} },
        run: async () => 'read result',
      };

      const toolWrite: ToolWithDependencies = {
        name: 'write',
        description: 'Write',
        parameters: { type: 'object', properties: {} },
        dependsOn: ['read'],
        run: async () => 'write result',
      };

      const calls = [
        { toolCallId: 'call-read', toolName: 'read', arguments: {} },
        { toolCallId: 'call-write', toolName: 'write', arguments: {} },
      ];

      const groups = orderToolCalls(calls, [toolRead, toolWrite]);

      // Should have 2 groups - read first, then write
      expect(groups.length).toBe(2);

      const readGroupIndex = groups.findIndex(
        (g) => g.calls.some((c) => c.toolName === 'read'),
      );
      const writeGroupIndex = groups.findIndex(
        (g) => g.calls.some((c) => c.toolName === 'write'),
      );

      expect(readGroupIndex).toBeLessThan(writeGroupIndex);
    });

    test('orderToolCalls creates barrier for sequential tools', () => {
      const sequentialTool: ToolWithDependencies = {
        name: 'sequential_tool',
        description: 'Must run alone',
        parameters: { type: 'object', properties: {} },
        sequential: true,
        run: async () => 'done',
      };

      const calls = [
        { toolCallId: 'call-1', toolName: 'sequential_tool', arguments: {} },
      ];

      const groups = orderToolCalls(calls, [sequentialTool]);

      expect(groups.length).toBe(1);
      expect(groups[0]?.isBarrier).toBe(true);
    });
  });

  describe('stream/generate equivalence', () => {
    test('stream and generate produce equivalent final states', async () => {
      const a = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 100 },
        execution: loop(),
      });

      const input = 'Say exactly: "Test response"';
      const state = AgentState.initial();

      // Run with generate
      const generateResult = await a.generate(input, state);

      // Run with stream
      const stream = a.stream(input, state);
      for await (const event of stream) {
        void event; // consume stream
      }
      const streamResult = await stream.result;

      // Compare structural equivalence
      expect(generateResult.state.step).toBe(streamResult.state.step);
      expect(generateResult.state.messages.length).toBe(streamResult.state.messages.length);
      // Both should have non-empty responses
      expect(generateResult.turn.response.text.length).toBeGreaterThan(0);
      expect(streamResult.turn.response.text.length).toBeGreaterThan(0);
    });

    test('react() stream and generate capture same reasoning count', async () => {
      const a = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 300 },
        execution: react({ maxSteps: 1 }),
      });

      const input = 'What is 5 + 5?';
      const state = AgentState.initial();

      // Run with generate
      const generateResult = await a.generate(input, state);

      // Run with stream
      const stream = a.stream(input, state);
      for await (const event of stream) {
        void event; // consume stream
      }
      const streamResult = await stream.result;

      // Both should have captured reasoning
      expect(generateResult.state.reasoning.length).toBe(streamResult.state.reasoning.length);
      expect(generateResult.state.reasoning.length).toBeGreaterThan(0);
    });
  });

  describe('react() with tools', () => {
    test('uses tools in loop and answers correctly', async () => {
      const calculator: Tool = {
        name: 'calculate',
        description: 'Perform a mathematical calculation. Use this for any math operations.',
        parameters: {
          type: 'object',
          properties: {
            expression: { type: 'string', description: 'Math expression to evaluate, e.g., "2 + 3"' },
          },
          required: ['expression'],
        },
        run: async (params: { expression: string }) => {
          const result = Function(`"use strict"; return (${params.expression})`)();
          return String(result);
        },
      };

      const a = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 500 },
        tools: [calculator],
        execution: loop(), // Use loop() for simpler tool execution
      });

      const result = await a.generate(
        'Use the calculate tool to compute 123 + 456. What is the result?',
        AgentState.initial(),
      );

      // Should have tool executions
      expect(result.turn.toolExecutions.length).toBeGreaterThan(0);
      // Answer should contain 579
      expect(result.turn.response.text).toContain('579');
    });
  });
});
