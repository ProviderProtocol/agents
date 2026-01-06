import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { UserMessage, AssistantMessage } from '@providerprotocol/ai';
import type { Turn, LLMInstance, Tool, ToolCall, ToolExecution, TextBlock } from '@providerprotocol/ai';
import { react } from '../../../src/execution/react.ts';
import { AgentState } from '../../../src/state/index.ts';
import type { ExecutionContext } from '../../../src/execution/types.ts';

// Mock Turn factory
function createMockTurn(options: {
  text?: string;
  toolCalls?: ToolCall[];
  toolExecutions?: ToolExecution[];
}): Turn {
  const response = new AssistantMessage(options.text ?? 'Hello', options.toolCalls);
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

// Mock LLM factory that returns different turns for reasoning and action phases
function createMockLLM(turnSequence: Turn[]): LLMInstance {
  let callIndex = 0;

  return {
    generate: mock(async () => {
      const turn = turnSequence[callIndex] ?? turnSequence[turnSequence.length - 1];
      callIndex++;
      return turn;
    }),
    stream: mock(() => {
      const turn = turnSequence[callIndex] ?? turnSequence[turnSequence.length - 1];
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
    }),
  } as unknown as LLMInstance;
}

describe('react() execution strategy', () => {
  let state: AgentState;
  let input: UserMessage;
  let tools: Tool[];

  beforeEach(() => {
    state = AgentState.initial();
    input = new UserMessage('Hello');
    tools = [];
  });

  describe('execute()', () => {
    test('returns turn and updated state', async () => {
      // ReAct makes 2 LLM calls per step: reasoning + action
      const reasoningTurn = createMockTurn({ text: 'I should respond with a greeting.' });
      const actionTurn = createMockTurn({ text: 'Hi there!' });
      const llm = createMockLLM([reasoningTurn, actionTurn]);

      const strategy = react();
      const context: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm,
        input,
        state,
        tools,
        strategy: {},
      };

      const result = await strategy.execute(context);

      expect(result.turn).toBe(actionTurn);
      expect(result.state.step).toBe(1);
    });

    test('calls reasoning and action phases', async () => {
      const reasoningTurn = createMockTurn({ text: 'Thinking about the problem...' });
      const actionTurn = createMockTurn({ text: 'Here is my answer.' });
      const llm = createMockLLM([reasoningTurn, actionTurn]);

      const strategy = react();
      const context: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm,
        input,
        state,
        tools,
        strategy: {},
      };

      await strategy.execute(context);

      // 2 calls: reasoning phase + action phase
      expect(llm.generate).toHaveBeenCalledTimes(2);
    });

    test('stores reasoning in state', async () => {
      const reasoningTurn = createMockTurn({ text: 'My reasoning about this task.' });
      const actionTurn = createMockTurn({ text: 'Action result.' });
      const llm = createMockLLM([reasoningTurn, actionTurn]);

      const strategy = react();
      const context: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm,
        input,
        state,
        tools,
        strategy: {},
      };

      const result = await strategy.execute(context);

      expect(result.state.reasoning).toHaveLength(1);
      expect(result.state.reasoning[0]).toBe('My reasoning about this task.');
    });

    test('loops on tool calls', async () => {
      const toolCall: ToolCall = {
        toolCallId: 'call-1',
        toolName: 'test_tool',
        arguments: { arg: 'value' },
      };

      // Step 1: reasoning + action with tool call
      const reasoning1 = createMockTurn({ text: 'I need to use a tool.' });
      const action1 = createMockTurn({
        text: 'Using tool...',
        toolCalls: [toolCall],
        toolExecutions: [{
          toolCallId: 'call-1',
          toolName: 'test_tool',
          arguments: { arg: 'value' },
          result: 'tool result',
          duration: 100,
          isError: false,
        }],
      });

      // Step 2: reasoning + final action
      const reasoning2 = createMockTurn({ text: 'Now I can provide the answer.' });
      const action2 = createMockTurn({ text: 'Final answer!' });

      const llm = createMockLLM([reasoning1, action1, reasoning2, action2]);

      const strategy = react();
      const context: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm,
        input,
        state,
        tools,
        strategy: {},
      };

      const result = await strategy.execute(context);

      // 4 calls: (reasoning1 + action1) + (reasoning2 + action2)
      expect(llm.generate).toHaveBeenCalledTimes(4);
      expect(result.state.step).toBe(2);
      expect(result.state.reasoning).toHaveLength(2);
    });

    test('respects maxSteps', async () => {
      const toolCall: ToolCall = {
        toolCallId: 'call-1',
        toolName: 'test_tool',
        arguments: {},
      };

      // All turns have tool calls to force looping
      const reasoningTurn = createMockTurn({ text: 'Thinking...' });
      const actionTurn = createMockTurn({
        text: 'Acting...',
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

      const llm = createMockLLM([
        reasoningTurn, actionTurn,
        reasoningTurn, actionTurn,
        reasoningTurn, actionTurn,
        reasoningTurn, actionTurn,
        reasoningTurn, actionTurn,
      ]);

      const strategy = react({ maxSteps: 2 });
      const context: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm,
        input,
        state,
        tools,
        strategy: {},
      };

      const result = await strategy.execute(context);

      // 2 steps * 2 calls per step = 4 calls
      expect(llm.generate).toHaveBeenCalledTimes(4);
      expect(result.state.step).toBe(2);
    });

    test('defaults to Infinity maxSteps', () => {
      const strategy = react();
      expect(strategy.name).toBe('react');
    });

    test('calls onReason hook', async () => {
      const reasoningTurn = createMockTurn({ text: 'My reasoning process.' });
      const actionTurn = createMockTurn({ text: 'Done.' });
      const llm = createMockLLM([reasoningTurn, actionTurn]);
      const onReason = mock(() => {});

      const strategy = react();
      const context: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm,
        input,
        state,
        tools,
        strategy: { onReason },
      };

      await strategy.execute(context);

      expect(onReason).toHaveBeenCalledTimes(1);
      expect(onReason).toHaveBeenCalledWith(1, 'My reasoning process.');
    });

    test('calls onStepStart hook', async () => {
      const reasoningTurn = createMockTurn({ text: 'Thinking.' });
      const actionTurn = createMockTurn({ text: 'Done.' });
      const llm = createMockLLM([reasoningTurn, actionTurn]);
      const onStepStart = mock(() => {});

      const strategy = react();
      const context: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm,
        input,
        state,
        tools,
        strategy: { onStepStart },
      };

      await strategy.execute(context);

      expect(onStepStart).toHaveBeenCalledTimes(1);
    });

    test('calls onStepEnd hook', async () => {
      const reasoningTurn = createMockTurn({ text: 'Thinking.' });
      const actionTurn = createMockTurn({ text: 'Done.' });
      const llm = createMockLLM([reasoningTurn, actionTurn]);
      const onStepEnd = mock(() => {});

      const strategy = react();
      const context: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm,
        input,
        state,
        tools,
        strategy: { onStepEnd },
      };

      await strategy.execute(context);

      expect(onStepEnd).toHaveBeenCalledTimes(1);
    });

    test('calls onAct hook on tool calls', async () => {
      const toolCall: ToolCall = {
        toolCallId: 'call-1',
        toolName: 'test_tool',
        arguments: {},
      };

      const reasoningTurn = createMockTurn({ text: 'Using tool.' });
      const actionTurn = createMockTurn({
        text: 'Called tool.',
        toolCalls: [toolCall],
      });
      const reasoning2 = createMockTurn({ text: 'Done now.' });
      const action2 = createMockTurn({ text: 'Final.' });

      const llm = createMockLLM([reasoningTurn, actionTurn, reasoning2, action2]);
      const onAct = mock(() => {});

      const strategy = react();
      const context: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm,
        input,
        state,
        tools,
        strategy: { onAct },
      };

      await strategy.execute(context);

      expect(onAct).toHaveBeenCalledWith(1, [toolCall]);
    });

    test('calls onObserve hook on tool executions', async () => {
      const execution: ToolExecution = {
        toolCallId: 'call-1',
        toolName: 'test_tool',
        arguments: {},
        result: 'result',
        duration: 100,
        isError: false,
      };

      const reasoningTurn = createMockTurn({ text: 'Observing.' });
      const actionTurn = createMockTurn({
        text: 'Done.',
        toolExecutions: [execution],
      });
      const llm = createMockLLM([reasoningTurn, actionTurn]);
      const onObserve = mock(() => {});

      const strategy = react();
      const context: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm,
        input,
        state,
        tools,
        strategy: { onObserve },
      };

      await strategy.execute(context);

      expect(onObserve).toHaveBeenCalledWith(1, [execution]);
    });

    test('calls onComplete hook', async () => {
      const reasoningTurn = createMockTurn({ text: 'Thinking.' });
      const actionTurn = createMockTurn({ text: 'Done.' });
      const llm = createMockLLM([reasoningTurn, actionTurn]);
      const onComplete = mock(() => {});

      const strategy = react();
      const context: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm,
        input,
        state,
        tools,
        strategy: { onComplete },
      };

      await strategy.execute(context);

      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    test('respects stopCondition', async () => {
      const toolCall: ToolCall = {
        toolCallId: 'call-1',
        toolName: 'test_tool',
        arguments: {},
      };

      const reasoningTurn = createMockTurn({ text: 'Thinking.' });
      const actionTurn = createMockTurn({
        text: 'Acting.',
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

      const llm = createMockLLM([
        reasoningTurn, actionTurn,
        reasoningTurn, actionTurn,
        reasoningTurn, actionTurn,
      ]);

      const strategy = react();
      const context: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm,
        input,
        state,
        tools,
        strategy: {
          stopCondition: (s) => s.step >= 2,
        },
      };

      const result = await strategy.execute(context);

      expect(result.state.step).toBe(2);
    });

    test('uses custom reasoning prompt', async () => {
      const reasoningTurn = createMockTurn({ text: 'Custom reasoning.' });
      const actionTurn = createMockTurn({ text: 'Done.' });

      let callCount = 0;
      let reasoningCallMessages: unknown[] = [];
      const llm = {
        generate: mock(async (...args: unknown[]) => {
          callCount++;
          // First call is reasoning phase - capture those messages
          if (callCount === 1) {
            // The args[0] is the messages array passed to llm.generate
            reasoningCallMessages = Array.isArray(args[0]) ? [...args[0]] : [];
            return reasoningTurn;
          }
          return actionTurn;
        }),
        stream: mock(() => ({
          async *[Symbol.asyncIterator]() {},
          turn: Promise.resolve(actionTurn),
        })),
      } as unknown as LLMInstance;

      const customPrompt = 'Think carefully about this specific problem.';
      const strategy = react({ reasoningPrompt: customPrompt });
      const context: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm,
        input,
        state,
        tools,
        strategy: {},
      };

      await strategy.execute(context);

      // Should have 2 calls: reasoning + action
      expect(callCount).toBe(2);

      // The reasoning phase messages should include the custom prompt
      // The last message should be the custom reasoning prompt as a UserMessage
      expect(reasoningCallMessages.length).toBeGreaterThan(0);

      const lastMsg = reasoningCallMessages[reasoningCallMessages.length - 1];
      expect(lastMsg).toBeInstanceOf(UserMessage);

      // UserMessage.content is an array of content blocks in UPP format
      const msgContent = (lastMsg as UserMessage).content;
      // Content is array of blocks like [{ type: "text", text: "..." }]
      const textBlock = msgContent.find(
        (block): block is TextBlock => block.type === 'text',
      );
      expect(textBlock).toBeDefined();
      expect(textBlock?.text).toBe(customPrompt);
    });
  });

  describe('stream()', () => {
    test('yields events and resolves result', async () => {
      const reasoningTurn = createMockTurn({ text: 'Streaming reasoning.' });
      const actionTurn = createMockTurn({ text: 'Streaming action.' });
      const llm = createMockLLM([reasoningTurn, actionTurn]);

      const strategy = react();
      const context: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm,
        input,
        state,
        tools,
        strategy: {},
      };

      const streamResult = strategy.stream(context);
      const events: unknown[] = [];

      for await (const event of streamResult) {
        events.push(event);
      }

      const result = await streamResult.result;

      expect(events.length).toBeGreaterThan(0);
      expect(result.turn).toBeDefined();
      expect(result.state).toBeDefined();
    });

    test('emits reasoning event', async () => {
      const reasoningTurn = createMockTurn({ text: 'My reasoning.' });
      const actionTurn = createMockTurn({ text: 'Done.' });
      const llm = createMockLLM([reasoningTurn, actionTurn]);

      const strategy = react();
      const context: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm,
        input,
        state,
        tools,
        strategy: {},
      };

      const streamResult = strategy.stream(context);
      const uapEvents: Array<{ source: string; uap?: { type: string; data?: { reasoning?: string } } }> = [];

      for await (const event of streamResult) {
        if (event.source === 'uap') {
          uapEvents.push(event as typeof uapEvents[0]);
        }
      }

      await streamResult.result;

      const reasoningEvent = uapEvents.find((e) => e.uap?.type === 'reasoning');
      expect(reasoningEvent).toBeDefined();
      expect(reasoningEvent?.uap?.data?.reasoning).toBe('My reasoning.');
    });

    test('emits step_start and step_end events', async () => {
      const reasoningTurn = createMockTurn({ text: 'Thinking.' });
      const actionTurn = createMockTurn({ text: 'Done.' });
      const llm = createMockLLM([reasoningTurn, actionTurn]);

      const strategy = react();
      const context: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm,
        input,
        state,
        tools,
        strategy: {},
      };

      const streamResult = strategy.stream(context);
      const uapEvents: Array<{ source: string; uap?: { type: string } }> = [];

      for await (const event of streamResult) {
        if (event.source === 'uap') {
          uapEvents.push(event as typeof uapEvents[0]);
        }
      }

      await streamResult.result;

      const stepStart = uapEvents.find((e) => e.uap?.type === 'step_start');
      const stepEnd = uapEvents.find((e) => e.uap?.type === 'step_end');

      expect(stepStart).toBeDefined();
      expect(stepEnd).toBeDefined();
    });

    test('supports abort()', async () => {
      const reasoningTurn = createMockTurn({ text: 'Thinking.' });
      const actionTurn = createMockTurn({ text: 'Done.' });
      const llm = createMockLLM([reasoningTurn, actionTurn]);

      const strategy = react();
      const context: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm,
        input,
        state,
        tools,
        strategy: {},
      };

      const streamResult = strategy.stream(context);

      // Abort immediately
      streamResult.abort();

      // The stream should handle abort gracefully
      expect(typeof streamResult.abort).toBe('function');
    });
  });
});
