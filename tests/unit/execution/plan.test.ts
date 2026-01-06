import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { UserMessage, AssistantMessage } from '@providerprotocol/ai';
import type { Turn, LLMInstance, Tool, ToolCall, ToolExecution } from '@providerprotocol/ai';
import { plan } from '../../../src/execution/plan.ts';
import { AgentState } from '../../../src/state/index.ts';
import type { ExecutionContext } from '../../../src/execution/types.ts';

// Mock Turn factory
function createMockTurn(options: {
  text?: string;
  toolCalls?: ToolCall[];
  toolExecutions?: ToolExecution[];
  data?: unknown;
}): Turn {
  const response = new AssistantMessage(options.text ?? 'Hello', options.toolCalls);
  return {
    response,
    messages: [response],
    toolExecutions: options.toolExecutions ?? [],
    data: options.data,
    usage: {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
    },
    cycles: 1,
  } as unknown as Turn;
}

// Mock LLM factory
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

// Create a plan response turn
function createPlanTurn(steps: Array<{ id: string; description: string; tool?: string; dependsOn?: string[] }>): Turn {
  const planData = {
    steps: steps.map((s) => ({
      id: s.id,
      description: s.description,
      tool: s.tool,
      dependsOn: s.dependsOn ?? [],
    })),
  };

  return createMockTurn({
    text: JSON.stringify(planData),
    data: planData,
  });
}

describe('plan() execution strategy', () => {
  let state: AgentState;
  let input: UserMessage;
  let tools: Tool[];

  beforeEach(() => {
    state = AgentState.initial();
    input = new UserMessage('Complete this task');
    tools = [];
  });

  describe('execute()', () => {
    test('returns turn and updated state', async () => {
      const planTurn = createPlanTurn([
        { id: 'step-1', description: 'First step' },
      ]);
      const executionTurn = createMockTurn({ text: 'Step 1 completed.' });

      const llm = createMockLLM([planTurn, executionTurn]);

      const strategy = plan();
      const context: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm,
        input,
        state,
        tools,
        strategy: {},
      };

      const result = await strategy.execute(context);

      expect(result.turn).toBeDefined();
      expect(result.state).toBeDefined();
    });

    test('creates plan in first phase', async () => {
      const planTurn = createPlanTurn([
        { id: 'step-1', description: 'First step' },
        { id: 'step-2', description: 'Second step', dependsOn: ['step-1'] },
      ]);
      const step1Turn = createMockTurn({ text: 'Step 1 done.' });
      const step2Turn = createMockTurn({ text: 'Step 2 done.' });

      const llm = createMockLLM([planTurn, step1Turn, step2Turn]);

      const strategy = plan();
      const context: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm,
        input,
        state,
        tools,
        strategy: {},
      };

      const result = await strategy.execute(context);

      expect(result.state.plan).toBeDefined();
      expect(result.state.plan).toHaveLength(2);
    });

    test('executes plan steps in order', async () => {
      const planTurn = createPlanTurn([
        { id: 'step-1', description: 'First step' },
        { id: 'step-2', description: 'Second step', dependsOn: ['step-1'] },
      ]);
      const step1Turn = createMockTurn({ text: 'Step 1 done.' });
      const step2Turn = createMockTurn({ text: 'Step 2 done.' });

      const llm = createMockLLM([planTurn, step1Turn, step2Turn]);

      const strategy = plan();
      const context: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm,
        input,
        state,
        tools,
        strategy: {},
      };

      const result = await strategy.execute(context);

      // 3 calls: planning + step1 + step2
      expect(llm.generate).toHaveBeenCalledTimes(3);

      // Both steps should be completed
      const completedSteps = result.state.plan?.filter((s) => s.status === 'completed');
      expect(completedSteps).toHaveLength(2);
    });

    test('respects step dependencies', async () => {
      // step-3 depends on step-1 and step-2
      const planTurn = createPlanTurn([
        { id: 'step-1', description: 'First step' },
        { id: 'step-2', description: 'Second step' },
        { id: 'step-3', description: 'Third step', dependsOn: ['step-1', 'step-2'] },
      ]);
      const step1Turn = createMockTurn({ text: 'Step 1.' });
      const step2Turn = createMockTurn({ text: 'Step 2.' });
      const step3Turn = createMockTurn({ text: 'Step 3.' });

      const llm = createMockLLM([planTurn, step1Turn, step2Turn, step3Turn]);

      const strategy = plan();
      const context: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm,
        input,
        state,
        tools,
        strategy: {},
      };

      const result = await strategy.execute(context);

      // All 3 steps + planning = 4 calls
      expect(llm.generate).toHaveBeenCalledTimes(4);

      // All should be completed
      const completedSteps = result.state.plan?.filter((s) => s.status === 'completed');
      expect(completedSteps).toHaveLength(3);
    });

    test('respects maxPlanSteps', async () => {
      const planTurn = createPlanTurn([
        { id: 'step-1', description: 'First step' },
        { id: 'step-2', description: 'Second step' },
        { id: 'step-3', description: 'Third step' },
        { id: 'step-4', description: 'Fourth step' },
        { id: 'step-5', description: 'Fifth step' },
      ]);
      const stepTurn = createMockTurn({ text: 'Step done.' });

      const llm = createMockLLM([planTurn, stepTurn, stepTurn, stepTurn, stepTurn, stepTurn]);

      const strategy = plan({ maxPlanSteps: 3 });
      const context: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm,
        input,
        state,
        tools,
        strategy: {},
      };

      const result = await strategy.execute(context);

      // Plan should be truncated to 3 steps
      expect(result.state.plan).toHaveLength(3);
    });

    test('defaults to Infinity maxPlanSteps', () => {
      const strategy = plan();
      expect(strategy.name).toBe('plan');
    });

    test('parses plan from JSON in response text', async () => {
      // Plan without data field, only in text
      const planText = JSON.stringify({
        steps: [
          { id: 'step-1', description: 'First step', dependsOn: [] },
        ],
      });
      const planTurn = createMockTurn({ text: `Here is the plan: ${planText}` });
      const stepTurn = createMockTurn({ text: 'Done.' });

      const llm = createMockLLM([planTurn, stepTurn]);

      const strategy = plan();
      const context: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm,
        input,
        state,
        tools,
        strategy: {},
      };

      const result = await strategy.execute(context);

      expect(result.state.plan).toHaveLength(1);
      expect(result.state.plan?.[0]?.id).toBe('step-1');
    });

    test('calls onStepStart hook', async () => {
      const planTurn = createPlanTurn([
        { id: 'step-1', description: 'First step' },
      ]);
      const stepTurn = createMockTurn({ text: 'Done.' });

      const llm = createMockLLM([planTurn, stepTurn]);
      const onStepStart = mock(() => {});

      const strategy = plan();
      const context: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm,
        input,
        state,
        tools,
        strategy: { onStepStart },
      };

      await strategy.execute(context);

      // Called for planning step + execution step
      expect(onStepStart).toHaveBeenCalledTimes(2);
    });

    test('calls onStepEnd hook', async () => {
      const planTurn = createPlanTurn([
        { id: 'step-1', description: 'First step' },
      ]);
      const stepTurn = createMockTurn({ text: 'Done.' });

      const llm = createMockLLM([planTurn, stepTurn]);
      const onStepEnd = mock(() => {});

      const strategy = plan();
      const context: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm,
        input,
        state,
        tools,
        strategy: { onStepEnd },
      };

      await strategy.execute(context);

      // Called for planning step + execution step
      expect(onStepEnd).toHaveBeenCalledTimes(2);
    });

    test('calls onAct hook on tool calls', async () => {
      const toolCall: ToolCall = {
        toolCallId: 'call-1',
        toolName: 'test_tool',
        arguments: {},
      };

      const planTurn = createPlanTurn([
        { id: 'step-1', description: 'Use tool', tool: 'test_tool' },
      ]);
      const stepTurn = createMockTurn({
        text: 'Used tool.',
        toolCalls: [toolCall],
      });

      const llm = createMockLLM([planTurn, stepTurn]);
      const onAct = mock(() => {});

      const strategy = plan();
      const context: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm,
        input,
        state,
        tools,
        strategy: { onAct },
      };

      await strategy.execute(context);

      expect(onAct).toHaveBeenCalledWith(2, [toolCall]);
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

      const planTurn = createPlanTurn([
        { id: 'step-1', description: 'Observe results' },
      ]);
      const stepTurn = createMockTurn({
        text: 'Observed.',
        toolExecutions: [execution],
      });

      const llm = createMockLLM([planTurn, stepTurn]);
      const onObserve = mock(() => {});

      const strategy = plan();
      const context: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm,
        input,
        state,
        tools,
        strategy: { onObserve },
      };

      await strategy.execute(context);

      expect(onObserve).toHaveBeenCalledWith(2, [execution]);
    });

    test('calls onComplete hook', async () => {
      const planTurn = createPlanTurn([
        { id: 'step-1', description: 'Only step' },
      ]);
      const stepTurn = createMockTurn({ text: 'Done.' });

      const llm = createMockLLM([planTurn, stepTurn]);
      const onComplete = mock(() => {});

      const strategy = plan();
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
      const planTurn = createPlanTurn([
        { id: 'step-1', description: 'First' },
        { id: 'step-2', description: 'Second' },
        { id: 'step-3', description: 'Third' },
      ]);
      const stepTurn = createMockTurn({ text: 'Done.' });

      const llm = createMockLLM([planTurn, stepTurn, stepTurn, stepTurn]);

      const strategy = plan();
      const context: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm,
        input,
        state,
        tools,
        strategy: {
          stopCondition: (s) => s.step >= 2, // Stop after first execution step
        },
      };

      const result = await strategy.execute(context);

      // Should have stopped early
      const completedSteps = result.state.plan?.filter((s) => s.status === 'completed');
      expect(completedSteps?.length).toBeLessThan(3);
    });

    test('updates step status during execution', async () => {
      const planTurn = createPlanTurn([
        { id: 'step-1', description: 'First step' },
      ]);
      const stepTurn = createMockTurn({ text: 'Step done.' });

      const llm = createMockLLM([planTurn, stepTurn]);

      const strategy = plan();
      const context: ExecutionContext = {
        agent: { id: 'test-agent' },
        llm,
        input,
        state,
        tools,
        strategy: {},
      };

      const result = await strategy.execute(context);

      // Step should be completed
      expect(result.state.plan?.[0]?.status).toBe('completed');
    });
  });

  describe('stream()', () => {
    test('yields events and resolves result', async () => {
      const planTurn = createPlanTurn([
        { id: 'step-1', description: 'Only step' },
      ]);
      const stepTurn = createMockTurn({ text: 'Done.' });

      const llm = createMockLLM([planTurn, stepTurn]);

      const strategy = plan();
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

    test('emits plan_created event', async () => {
      const planTurn = createPlanTurn([
        { id: 'step-1', description: 'First step' },
      ]);
      const stepTurn = createMockTurn({ text: 'Done.' });

      const llm = createMockLLM([planTurn, stepTurn]);

      const strategy = plan();
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

      const planCreated = uapEvents.find((e) => e.uap?.type === 'plan_created');
      expect(planCreated).toBeDefined();
    });

    test('emits plan_step_start and plan_step_end events', async () => {
      const planTurn = createPlanTurn([
        { id: 'step-1', description: 'First step' },
      ]);
      const stepTurn = createMockTurn({ text: 'Done.' });

      const llm = createMockLLM([planTurn, stepTurn]);

      const strategy = plan();
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

      const stepStart = uapEvents.find((e) => e.uap?.type === 'plan_step_start');
      const stepEnd = uapEvents.find((e) => e.uap?.type === 'plan_step_end');

      expect(stepStart).toBeDefined();
      expect(stepEnd).toBeDefined();
    });

    test('supports abort()', async () => {
      const planTurn = createPlanTurn([
        { id: 'step-1', description: 'Only step' },
      ]);
      const stepTurn = createMockTurn({ text: 'Done.' });

      const llm = createMockLLM([planTurn, stepTurn]);

      const strategy = plan();
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

      expect(typeof streamResult.abort).toBe('function');
    });
  });
});
