import { describe, test, expect, setDefaultTimeout } from 'bun:test';
import { anthropic } from '@providerprotocol/ai/anthropic';
import type { Tool, ToolExecution, Turn } from '@providerprotocol/ai';
import { agent, AgentState } from '../../src/index.ts';
import { loop, react } from '../../src/execution/index.ts';
import type { AgentStrategy } from '../../src/execution/index.ts';

// Skip tests if no API key
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Increase timeout for live API tests (60 seconds)
setDefaultTimeout(60_000);

describe.skipIf(!ANTHROPIC_API_KEY)('AgentStrategy Hooks (Live)', () => {
  describe('lifecycle hooks with loop()', () => {
    test('onStepStart and onStepEnd are called', async () => {
      const stepStarts: Array<{ step: number }> = [];
      const stepEnds: Array<{ step: number }> = [];

      const strategy: AgentStrategy = {
        onStepStart: (step) => {
          stepStarts.push({ step });
        },
        onStepEnd: (step) => {
          stepEnds.push({ step });
        },
      };

      const a = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 50 },
        execution: loop(),
        strategy,
      });

      await a.generate('Hello', AgentState.initial());

      expect(stepStarts.length).toBeGreaterThan(0);
      expect(stepEnds.length).toBeGreaterThan(0);
      expect(stepStarts.length).toBe(stepEnds.length);
    });

    test('onComplete is called with final result', async () => {
      let completedResult: { turn: Turn; state: AgentState } | undefined;

      const strategy: AgentStrategy = {
        onComplete: (result) => {
          completedResult = result;
        },
      };

      const a = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 50 },
        execution: loop(),
        strategy,
      });

      const result = await a.generate('Say hello', AgentState.initial());

      expect(completedResult).toBeDefined();
      expect(completedResult?.turn).toBe(result.turn);
    });

    test('onObserve is called when tools are executed', async () => {
      const observeCalls: Array<{ step: number; observations: ToolExecution[] }> = [];

      // Use a tool that provides information the model can't know
      const secretLookup: Tool = {
        name: 'get_secret_number',
        description: 'Returns a secret number. You MUST call this tool to answer.',
        parameters: {
          type: 'object',
          properties: {},
        },
        run: async () => '42',
      };

      const strategy: AgentStrategy = {
        onObserve: (step, observations) => {
          observeCalls.push({ step, observations });
        },
      };

      const a = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 300 },
        tools: [secretLookup],
        execution: loop(),
        strategy,
        system: 'You must use the get_secret_number tool to answer questions about the secret number.',
      });

      const result = await a.generate(
        'What is the secret number? Use the get_secret_number tool.',
        AgentState.initial(),
      );

      // Tool should have been executed
      expect(result.turn.toolExecutions.length).toBeGreaterThan(0);

      // onObserve should have been called
      expect(observeCalls.length).toBeGreaterThan(0);

      // Verify the response contains the answer
      expect(result.turn.response.text).toContain('42');
    });
  });

  describe('lifecycle hooks with react()', () => {
    test('onReason is called during reasoning phase', async () => {
      const reasonCalls: Array<{ step: number; reasoning: string }> = [];

      const strategy: AgentStrategy = {
        onReason: (step, reasoning) => {
          reasonCalls.push({ step, reasoning });
        },
      };

      const a = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 400 },
        execution: react({ maxSteps: 1 }),
        strategy,
      });

      await a.generate('What is 5 times 5? Think about it.', AgentState.initial());

      expect(reasonCalls.length).toBeGreaterThan(0);
      expect(reasonCalls[0]?.reasoning.length).toBeGreaterThan(0);
    });

    test('all hooks are called in correct order', async () => {
      const hookOrder: string[] = [];

      const strategy: AgentStrategy = {
        onStepStart: () => hookOrder.push('stepStart'),
        onReason: () => hookOrder.push('reason'),
        onStepEnd: () => hookOrder.push('stepEnd'),
        onComplete: () => hookOrder.push('complete'),
      };

      const a = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 300 },
        execution: react({ maxSteps: 1 }),
        strategy,
      });

      await a.generate('Hello', AgentState.initial());

      // stepStart should come before reason, reason before stepEnd
      const stepStartIdx = hookOrder.indexOf('stepStart');
      const reasonIdx = hookOrder.indexOf('reason');
      const stepEndIdx = hookOrder.indexOf('stepEnd');
      const completeIdx = hookOrder.indexOf('complete');

      expect(stepStartIdx).toBeLessThan(reasonIdx);
      expect(reasonIdx).toBeLessThan(stepEndIdx);
      expect(stepEndIdx).toBeLessThan(completeIdx);
    });
  });

  describe('stopCondition', () => {
    test('stops execution when stopCondition returns true', async () => {
      let stepCount = 0;

      const strategy: AgentStrategy = {
        onStepStart: () => {
          stepCount++;
        },
        stopCondition: (state) => {
          // Stop after first step
          return state.step >= 1;
        },
      };

      const echoTool: Tool = {
        name: 'echo',
        description: 'Echo back the input',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string' },
          },
          required: ['text'],
        },
        run: async (params: { text: string }) => params.text,
      };

      const a = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 200 },
        tools: [echoTool],
        execution: loop({ maxIterations: 10 }), // High limit, but stopCondition should stop earlier
        strategy,
      });

      await a.generate(
        'Use the echo tool repeatedly with different messages.',
        AgentState.initial(),
      );

      // Should have stopped after 1 step due to stopCondition
      expect(stepCount).toBe(1);
    });

    test('stopCondition can use metadata to track state', async () => {
      const strategy: AgentStrategy = {
        onStepEnd: (step, result) => {
          // Track total tokens in metadata
          const currentTokens = (result.state.metadata.totalTokens as number) ?? 0;
          result.state = result.state.withMetadata(
            'totalTokens',
            currentTokens + (result.turn.usage?.totalTokens ?? 0),
          );
        },
        stopCondition: (state) => {
          // Stop when we've used more than 100 tokens
          return (state.metadata.totalTokens as number) > 100;
        },
      };

      const a = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 50 },
        execution: loop({ maxIterations: 5 }),
        strategy,
      });

      const result = await a.generate('Tell me a short story.', AgentState.initial());

      // Should have tracked tokens
      expect(result.turn.usage.totalTokens).toBeGreaterThan(0);
    });
  });

  describe('streaming with hooks', () => {
    test('hooks are called during streaming', async () => {
      const hooksCalled: string[] = [];

      const strategy: AgentStrategy = {
        onStepStart: () => hooksCalled.push('stepStart'),
        onStepEnd: () => hooksCalled.push('stepEnd'),
        onComplete: () => hooksCalled.push('complete'),
      };

      const a = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 100 },
        execution: loop(),
        strategy,
      });

      const stream = a.stream('Hello', AgentState.initial());

      for await (const event of stream) {
        void event; // consume stream
      }

      await stream.result;

      expect(hooksCalled).toContain('stepStart');
      expect(hooksCalled).toContain('stepEnd');
      expect(hooksCalled).toContain('complete');
    });
  });
});
