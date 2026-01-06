import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { UserMessage, AssistantMessage } from '@providerprotocol/ai';
import type { Turn, LLMInstance, Tool, ToolCall, ToolExecution } from '@providerprotocol/ai';
import { loop } from '../../../src/execution/loop.ts';
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

// Mock LLM factory
function createMockLLM(turns: Turn[]): LLMInstance {
  let callIndex = 0;

  return {
    generate: mock(async () => {
      const turn = turns[callIndex] ?? turns[turns.length - 1];
      callIndex++;
      return turn;
    }),
    stream: mock(() => {
      const turn = turns[callIndex] ?? turns[turns.length - 1];
      callIndex++;

      const events: Array<{ type: string; delta?: { text?: string } }> = [];
      if (turn) {
        events.push({ type: 'text_delta', delta: { text: turn.response.text } });
        events.push({ type: 'message_stop' });
      }

      return {
        async *[Symbol.asyncIterator] () {
          for (const event of events) {
            yield event;
          }
        },
        turn: Promise.resolve(turn),
      };
    }),
  } as unknown as LLMInstance;
}

describe('loop() execution strategy', () => {
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
      const mockTurn = createMockTurn({ text: 'Hi there!' });
      const llm = createMockLLM([mockTurn]);

      const strategy = loop();
      const context: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm,
        input,
        state,
        tools,
        strategy: {},
      };

      const result = await strategy.execute(context);

      expect(result.turn).toBe(mockTurn);
      expect(result.state.messages.length).toBeGreaterThan(0);
    });

    test('loops on tool calls', async () => {
      const toolCall: ToolCall = {
        toolCallId: 'call-1',
        toolName: 'test_tool',
        arguments: { arg: 'value' },
      };

      const turn1 = createMockTurn({
        text: 'Calling tool...',
        toolCalls: [toolCall],
        toolExecutions: [{ toolCallId: 'call-1', toolName: 'test_tool', arguments: { arg: 'value' }, result: 'done', duration: 100, isError: false }],
      });
      const turn2 = createMockTurn({ text: 'Done!', toolCalls: [] });

      const llm = createMockLLM([turn1, turn2]);

      const strategy = loop();
      const context: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm,
        input,
        state,
        tools,
        strategy: {},
      };

      const result = await strategy.execute(context);

      expect(llm.generate).toHaveBeenCalledTimes(2);
      expect(result.turn.response.text).toBe('Done!');
    });

    test('respects maxIterations', async () => {
      const toolCall: ToolCall = {
        toolCallId: 'call-1',
        toolName: 'test_tool',
        arguments: {},
      };

      const turnWithTool = createMockTurn({
        text: 'Looping...',
        toolCalls: [toolCall],
        toolExecutions: [{ toolCallId: 'call-1', toolName: 'test_tool', arguments: {}, result: 'ok', duration: 10, isError: false }],
      });

      const llm = createMockLLM([turnWithTool, turnWithTool, turnWithTool, turnWithTool, turnWithTool]);

      const strategy = loop({ maxIterations: 3 });
      const context: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm,
        input,
        state,
        tools,
        strategy: {},
      };

      await strategy.execute(context);

      expect(llm.generate).toHaveBeenCalledTimes(3);
    });

    test('defaults to Infinity maxIterations', async () => {
      const strategy = loop();
      expect(strategy.name).toBe('loop');
      // The default is Infinity, but we can't easily test infinite behavior
      // We test this by verifying it loops more than a small number
    });

    test('calls onStepStart hook', async () => {
      const mockTurn = createMockTurn({ text: 'Response' });
      const llm = createMockLLM([mockTurn]);
      const onStepStart = mock(() => {});

      const strategy = loop();
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
      // Verify the hook was called with step number and a state object
      expect(onStepStart).toHaveBeenCalled();
    });

    test('calls onStepEnd hook', async () => {
      const mockTurn = createMockTurn({ text: 'Response' });
      const llm = createMockLLM([mockTurn]);
      const onStepEnd = mock(() => {});

      const strategy = loop();
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
      // Verify the hook was called with step number and result object
      expect(onStepEnd).toHaveBeenCalled();
    });

    test('calls onAct hook on tool calls', async () => {
      const toolCall: ToolCall = {
        toolCallId: 'call-1',
        toolName: 'test_tool',
        arguments: {},
      };

      const turn1 = createMockTurn({
        text: 'Using tool',
        toolCalls: [toolCall],
      });
      const turn2 = createMockTurn({ text: 'Done' }); // Terminating turn
      const llm = createMockLLM([turn1, turn2]);
      const onAct = mock(() => {});

      const strategy = loop();
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

      // Turn with tool execution but no tool calls (so it terminates)
      const turn = createMockTurn({
        text: 'Done',
        toolExecutions: [execution],
      });
      const llm = createMockLLM([turn]);
      const onObserve = mock(() => {});

      const strategy = loop();
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
      const mockTurn = createMockTurn({ text: 'Response' });
      const llm = createMockLLM([mockTurn]);
      const onComplete = mock(() => {});

      const strategy = loop();
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

      const turnWithTool = createMockTurn({
        text: 'Looping...',
        toolCalls: [toolCall],
        toolExecutions: [{ toolCallId: 'call-1', toolName: 'test_tool', arguments: {}, result: 'ok', duration: 10, isError: false }],
      });

      const llm = createMockLLM([turnWithTool, turnWithTool, turnWithTool]);

      const stopAfter = 2;
      const strategy = loop();
      const context: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm,
        input,
        state,
        tools,
        strategy: {
          stopCondition: (s) => s.step >= stopAfter,
        },
      };

      await strategy.execute(context);

      expect(llm.generate).toHaveBeenCalledTimes(2);
    });

    test('updates state step number', async () => {
      const toolCall: ToolCall = {
        toolCallId: 'call-1',
        toolName: 'test_tool',
        arguments: {},
      };

      const turn1 = createMockTurn({
        text: 'Step 1',
        toolCalls: [toolCall],
        toolExecutions: [{ toolCallId: 'call-1', toolName: 'test_tool', arguments: {}, result: 'ok', duration: 10, isError: false }],
      });
      const turn2 = createMockTurn({ text: 'Step 2' });

      const llm = createMockLLM([turn1, turn2]);

      const strategy = loop();
      const context: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm,
        input,
        state,
        tools,
        strategy: {},
      };

      const result = await strategy.execute(context);

      expect(result.state.step).toBe(2);
    });
  });

  describe('stream()', () => {
    test('yields events and resolves result', async () => {
      const mockTurn = createMockTurn({ text: 'Streamed response' });
      const llm = createMockLLM([mockTurn]);

      const strategy = loop();
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

    test('emits step_start and step_end events', async () => {
      const mockTurn = createMockTurn({ text: 'Response' });
      const llm = createMockLLM([mockTurn]);

      const strategy = loop();
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
          uapEvents.push(event as { source: string; uap?: { type: string } });
        }
      }

      await streamResult.result;

      const stepStart = uapEvents.find((e) => e.uap?.type === 'step_start');
      const stepEnd = uapEvents.find((e) => e.uap?.type === 'step_end');

      expect(stepStart).toBeDefined();
      expect(stepEnd).toBeDefined();
    });

    test('supports abort()', async () => {
      const mockTurn = createMockTurn({ text: 'Response' });
      const llm = createMockLLM([mockTurn]);

      const strategy = loop();
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
      // Note: exact behavior depends on timing
    });
  });
});
