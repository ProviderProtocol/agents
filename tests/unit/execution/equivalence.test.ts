/**
 * Stream/Generate Equivalence Tests
 *
 * UAP-1.0 Spec Section 11.4 states:
 * > The `state` returned by `stream.result` MUST include the complete execution history...
 * > The returned state MUST be identical to what `generate()` would return for the same execution.
 *
 * These tests verify that stream() and generate() produce structurally equivalent final states.
 */
import { describe, test, expect } from 'bun:test';
import { UserMessage, AssistantMessage } from '@providerprotocol/ai';
import type { Turn, LLMInstance, ToolCall, ToolExecution } from '@providerprotocol/ai';
import { loop } from '../../../src/execution/loop.ts';
import { react } from '../../../src/execution/react.ts';
import { AgentState } from '../../../src/state/index.ts';
import type { ExecutionContext } from '../../../src/execution/types.ts';

// Deterministic mock Turn factory
function createMockTurn(options: {
  text?: string;
  toolCalls?: ToolCall[];
  toolExecutions?: ToolExecution[];
}): Turn {
  const response = new AssistantMessage(options.text ?? 'Response', options.toolCalls);
  return {
    response,
    messages: [response],
    toolExecutions: options.toolExecutions ?? [],
    usage: {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
    },
    cycles: 1,
  } as unknown as Turn;
}

// Mock LLM that returns consistent results for both generate and stream
function createDeterministicLLM(turns: Turn[]): () => LLMInstance {
  return () => {
    let callIndex = 0;

    return {
      generate: async () => {
        const turn = turns[callIndex] ?? turns[turns.length - 1];
        callIndex++;
        return turn;
      },
      stream: () => {
        const turn = turns[callIndex] ?? turns[turns.length - 1];
        callIndex++;

        const events: Array<{ type: string; delta?: { text?: string } }> = [];
        if (turn) {
          events.push({ type: 'text_delta', delta: { text: turn.response.text } });
          events.push({ type: 'message_stop' });
        }

        return {
          async *[Symbol.asyncIterator]() {
            for (const event of events) {
              yield event;
            }
          },
          turn: Promise.resolve(turn),
        };
      },
    } as unknown as LLMInstance;
  };
}

/**
 * Compare two states for structural equivalence.
 * We don't compare IDs since those are unique per state instance.
 */
function statesAreEquivalent(a: AgentState, b: AgentState): boolean {
  // Compare step
  if (a.step !== b.step) {
    return false;
  }

  // Compare message count
  if (a.messages.length !== b.messages.length) {
    return false;
  }

  // Compare reasoning count
  if (a.reasoning.length !== b.reasoning.length) {
    return false;
  }

  // Compare reasoning content
  for (let i = 0; i < a.reasoning.length; i++) {
    if (a.reasoning[i] !== b.reasoning[i]) {
      return false;
    }
  }

  // Compare plan presence
  if ((a.plan === undefined) !== (b.plan === undefined)) {
    return false;
  }

  // Compare plan length if present
  if (a.plan && b.plan && a.plan.length !== b.plan.length) {
    return false;
  }

  return true;
}

describe('Stream/Generate Equivalence (Section 11.4)', () => {
  describe('loop() strategy', () => {
    test('stream() and generate() produce equivalent states for simple case', async () => {
      const mockTurn = createMockTurn({ text: 'Simple response' });
      const createLLM = createDeterministicLLM([mockTurn]);

      const strategy = loop();
      const input = new UserMessage('Hello');
      const initialState = AgentState.initial();

      // Execute with generate()
      const generateContext: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm: createLLM(),
        input,
        state: initialState,
        tools: [],
        strategy: {},
      };
      const generateResult = await strategy.execute(generateContext);

      // Execute with stream()
      const streamContext: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm: createLLM(),
        input,
        state: initialState,
        tools: [],
        strategy: {},
      };
      const streamResult = strategy.stream(streamContext);

      // Consume the stream
      for await (const event of streamResult) {
        // Consume events (required to complete stream)
        void event;
      }
      const streamFinalResult = await streamResult.result;

      // Compare states
      expect(statesAreEquivalent(generateResult.state, streamFinalResult.state)).toBe(true);
      expect(generateResult.state.step).toBe(streamFinalResult.state.step);
      expect(generateResult.state.messages.length).toBe(streamFinalResult.state.messages.length);
    });

    test('stream() and generate() produce equivalent states with tool calls', async () => {
      const toolCall: ToolCall = {
        toolCallId: 'call-1',
        toolName: 'test_tool',
        arguments: {},
      };

      const turn1 = createMockTurn({
        text: 'Using tool',
        toolCalls: [toolCall],
        toolExecutions: [{
          toolCallId: 'call-1',
          toolName: 'test_tool',
          arguments: {},
          result: 'ok',
          duration: 10,
          isError: false,
        }],
      });
      const turn2 = createMockTurn({ text: 'Done' });

      const createLLM = createDeterministicLLM([turn1, turn2]);
      const strategy = loop();
      const input = new UserMessage('Do something');
      const initialState = AgentState.initial();

      // Execute with generate()
      const generateContext: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm: createLLM(),
        input,
        state: initialState,
        tools: [],
        strategy: {},
      };
      const generateResult = await strategy.execute(generateContext);

      // Execute with stream()
      const streamContext: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm: createLLM(),
        input,
        state: initialState,
        tools: [],
        strategy: {},
      };
      const streamResult = strategy.stream(streamContext);

      for await (const event of streamResult) {
        void event;
      }
      const streamFinalResult = await streamResult.result;

      // Compare states
      expect(statesAreEquivalent(generateResult.state, streamFinalResult.state)).toBe(true);
    });
  });

  describe('react() strategy', () => {
    test('stream() and generate() produce equivalent states', async () => {
      const reasoningTurn = createMockTurn({ text: 'Thinking about this...' });
      const actionTurn = createMockTurn({ text: 'Here is my answer.' });

      const createLLM = createDeterministicLLM([reasoningTurn, actionTurn]);
      const strategy = react();
      const input = new UserMessage('Question');
      const initialState = AgentState.initial();

      // Execute with generate()
      const generateContext: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm: createLLM(),
        input,
        state: initialState,
        tools: [],
        strategy: {},
      };
      const generateResult = await strategy.execute(generateContext);

      // Execute with stream()
      const streamContext: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm: createLLM(),
        input,
        state: initialState,
        tools: [],
        strategy: {},
      };
      const streamResult = strategy.stream(streamContext);

      for await (const event of streamResult) {
        void event;
      }
      const streamFinalResult = await streamResult.result;

      // Compare states
      expect(statesAreEquivalent(generateResult.state, streamFinalResult.state)).toBe(true);

      // Reasoning should be captured in both
      expect(generateResult.state.reasoning.length).toBe(streamFinalResult.state.reasoning.length);
    });

    test('stream() and generate() capture same reasoning content', async () => {
      const reasoningText = 'Step by step reasoning process';
      const reasoningTurn = createMockTurn({ text: reasoningText });
      const actionTurn = createMockTurn({ text: 'Final answer.' });

      const createLLM = createDeterministicLLM([reasoningTurn, actionTurn]);
      const strategy = react();
      const input = new UserMessage('Think');
      const initialState = AgentState.initial();

      // Execute with generate()
      const generateContext: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm: createLLM(),
        input,
        state: initialState,
        tools: [],
        strategy: {},
      };
      const generateResult = await strategy.execute(generateContext);

      // Execute with stream()
      const streamContext: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm: createLLM(),
        input,
        state: initialState,
        tools: [],
        strategy: {},
      };
      const streamResult = strategy.stream(streamContext);

      for await (const event of streamResult) {
        void event;
      }
      const streamFinalResult = await streamResult.result;

      // Both should have captured the reasoning
      expect(generateResult.state.reasoning[0]).toBe(reasoningText);
      expect(streamFinalResult.state.reasoning[0]).toBe(reasoningText);
    });
  });

  describe('state completeness', () => {
    test('stream result includes all messages from execution', async () => {
      const toolCall: ToolCall = {
        toolCallId: 'call-1',
        toolName: 'test_tool',
        arguments: {},
      };

      const turns = [
        createMockTurn({
          text: 'First',
          toolCalls: [toolCall],
          toolExecutions: [{
            toolCallId: 'call-1',
            toolName: 'test_tool',
            arguments: {},
            result: 'ok',
            duration: 10,
            isError: false,
          }],
        }),
        createMockTurn({ text: 'Second' }),
      ];

      const createLLM = createDeterministicLLM(turns);
      const strategy = loop();
      const input = new UserMessage('Test');
      const initialState = AgentState.initial();

      const streamContext: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm: createLLM(),
        input,
        state: initialState,
        tools: [],
        strategy: {},
      };

      const streamResult = strategy.stream(streamContext);

      for await (const event of streamResult) {
        void event;
      }
      const result = await streamResult.result;

      // Should have messages from both iterations
      expect(result.state.messages.length).toBeGreaterThan(1);
      expect(result.state.step).toBe(2); // Two iterations
    });

    test('stream result includes correct step count', async () => {
      const reasoningTurn = createMockTurn({ text: 'Reasoning' });
      const actionWithTool = createMockTurn({
        text: 'Action',
        toolCalls: [{
          toolCallId: 'call-1',
          toolName: 'tool',
          arguments: {},
        }],
        toolExecutions: [{
          toolCallId: 'call-1',
          toolName: 'tool',
          arguments: {},
          result: 'ok',
          duration: 10,
          isError: false,
        }],
      });
      const reasoning2 = createMockTurn({ text: 'More reasoning' });
      const finalAction = createMockTurn({ text: 'Done' });

      const createLLM = createDeterministicLLM([
        reasoningTurn, actionWithTool,
        reasoning2, finalAction,
      ]);
      const strategy = react();
      const input = new UserMessage('Multi-step task');
      const initialState = AgentState.initial();

      const streamContext: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm: createLLM(),
        input,
        state: initialState,
        tools: [],
        strategy: {},
      };

      const streamResult = strategy.stream(streamContext);

      for await (const event of streamResult) {
        void event;
      }
      const result = await streamResult.result;

      // Should have completed 2 ReAct steps
      expect(result.state.step).toBe(2);
      expect(result.state.reasoning).toHaveLength(2);
    });
  });
});
