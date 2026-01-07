import { describe, test, expect } from 'bun:test';
import { AssistantMessage } from '@providerprotocol/ai';
import type { Turn, ModelReference, LLMInstance } from '@providerprotocol/ai';
import { createSubAgentTool } from '../../../src/subagent/index.ts';
import { agent } from '../../../src/agent/index.ts';
import type { ExecutionStrategy, SubagentEvent, ToolExecutionContext, AgentStreamEvent } from '../../../src/execution/types.ts';
import { AgentState } from '../../../src/state/index.ts';

/**
 * Helper type for calling tools that accept execution context.
 * createSubAgentTool returns tools that optionally accept a second context parameter.
 */
type ContextAwareToolRun = (
  params: Record<string, unknown>,
  context?: ToolExecutionContext,
) => Promise<string>;

// Mock model reference
const mockModel = {
  provider: 'mock',
  modelId: 'mock-model',
} as unknown as ModelReference;

// Mock Turn factory
function createMockTurn(text: string = 'Sub-agent response'): Turn {
  const response = new AssistantMessage(text);
  return {
    response,
    messages: [response],
    toolExecutions: [
      {
        toolCallId: 'call-1',
        toolName: 'test_tool',
        arguments: { arg: 'value' },
        result: 'tool result',
        isError: false,
      },
    ],
    usage: {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
    },
    cycles: 1,
  } as unknown as Turn;
}

// Mock LLM instance
const mockLLM = {
  generate: async () => createMockTurn(),
  stream: () => ({
    async *[Symbol.asyncIterator]() {
      // Yield a mock event
      yield { type: 'text_delta', delta: { text: 'Sub' } };
      yield { type: 'text_delta', delta: { text: '-agent' } };
      yield { type: 'message_stop' };
    },
    turn: Promise.resolve(createMockTurn()),
  }),
} as unknown as LLMInstance;

// Create a mock agent for testing
function createMockAgent() {
  const mockStrategy: ExecutionStrategy = {
    name: 'mock',
    async execute(ctx) {
      return {
        turn: createMockTurn(),
        state: ctx.state.withMessage(ctx.input).withStep(1),
      };
    },
    stream(ctx) {
      const turn = createMockTurn();
      return {
        async *[Symbol.asyncIterator](): AsyncGenerator<AgentStreamEvent> {
          yield {
            source: 'upp',
            upp: { type: 'text_delta', delta: { text: 'Sub-agent response' }, index: 0 },
          };
        },
        result: Promise.resolve({
          turn,
          state: ctx.state.withMessage(ctx.input).withStep(1),
        }),
        abort: () => {},
      };
    },
  };

  return agent({
    model: mockModel,
    execution: mockStrategy,
    _llmInstance: mockLLM,
  });
}

describe('createSubAgentTool', () => {
  test('creates a tool with correct properties', () => {
    const subAgent = createMockAgent();
    const tool = createSubAgentTool({
      agent: subAgent,
      name: 'test_subagent',
      description: 'A test sub-agent tool',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Query to process' },
        },
        required: ['query'],
      },
      buildPrompt: (params) => `Process: ${params.query}`,
    });

    expect(tool.name).toBe('test_subagent');
    expect(tool.description).toBe('A test sub-agent tool');
    expect(tool.parameters).toEqual({
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Query to process' },
      },
      required: ['query'],
    });
    expect(typeof tool.run).toBe('function');
  });

  test('executes sub-agent and returns result', async () => {
    const subAgent = createMockAgent();
    const tool = createSubAgentTool({
      agent: subAgent,
      name: 'executor',
      description: 'Executes tasks',
      parameters: { type: 'object', properties: {} },
      buildPrompt: () => 'Execute the task',
    });

    const result = await tool.run({});

    expect(result).toBe('Sub-agent response');
  });

  test('emits subagent_start event', async () => {
    const events: SubagentEvent[] = [];
    const subAgent = createMockAgent();
    const tool = createSubAgentTool({
      agent: subAgent,
      name: 'event_emitter',
      description: 'Emits events',
      parameters: { type: 'object', properties: {} },
      buildPrompt: () => 'test prompt',
      subagentType: 'test_type',
    });

    const context: ToolExecutionContext = {
      agentId: 'parent-agent',
      stateId: 'parent-state',
      toolCallId: 'call-123',
      onSubagentEvent: (e) => events.push(e),
    };

    await (tool.run as ContextAwareToolRun)({}, context);

    const startEvent = events.find((e) => e.type === 'subagent_start');
    expect(startEvent).toBeDefined();
    expect(startEvent?.subagentType).toBe('test_type');
    expect(startEvent?.parentToolCallId).toBe('call-123');
    if (startEvent?.type === 'subagent_start') {
      expect(startEvent.prompt).toBe('test prompt');
      expect(typeof startEvent.timestamp).toBe('number');
    }
  });

  test('emits subagent_end event on success', async () => {
    const events: SubagentEvent[] = [];
    const subAgent = createMockAgent();
    const tool = createSubAgentTool({
      agent: subAgent,
      name: 'success_test',
      description: 'Tests success',
      parameters: { type: 'object', properties: {} },
      buildPrompt: () => 'test',
    });

    const context: ToolExecutionContext = {
      agentId: 'parent',
      stateId: 'state',
      toolCallId: 'call-456',
      onSubagentEvent: (e) => events.push(e),
    };

    await (tool.run as ContextAwareToolRun)({}, context);

    const endEvent = events.find((e) => e.type === 'subagent_end');
    expect(endEvent).toBeDefined();
    expect(endEvent?.parentToolCallId).toBe('call-456');
    if (endEvent?.type === 'subagent_end') {
      expect(endEvent.success).toBe(true);
      expect(endEvent.result).toBe('Sub-agent response');
      expect(typeof endEvent.timestamp).toBe('number');
      // Should include tool executions from sub-agent
      expect(endEvent.toolExecutions).toBeDefined();
      expect(endEvent.toolExecutions?.length).toBeGreaterThan(0);
      // Should include usage
      expect(endEvent.usage).toBeDefined();
      expect(endEvent.usage?.totalTokens).toBe(30);
    }
  });

  test('emits subagent_end event with error on failure', async () => {
    const events: SubagentEvent[] = [];

    // Create an agent that will throw via generate (non-streaming)
    const failingStrategy: ExecutionStrategy = {
      name: 'failing',
      async execute() {
        throw new Error('Sub-agent failed');
      },
      stream() {
        // Provide a minimal stream implementation (won't be used with stream: false)
        return {
          async *[Symbol.asyncIterator]() {
            // Empty iterator
          },
          result: Promise.resolve({
            turn: createMockTurn(),
            state: AgentState.initial(),
          }),
          abort: () => {},
        };
      },
    };

    const failingAgent = agent({
      model: mockModel,
      execution: failingStrategy,
      _llmInstance: mockLLM,
    });

    const tool = createSubAgentTool({
      agent: failingAgent,
      name: 'failure_test',
      description: 'Tests failure',
      parameters: { type: 'object', properties: {} },
      buildPrompt: () => 'fail',
      stream: false, // Use non-streaming path which calls generate()
    });

    const context: ToolExecutionContext = {
      agentId: 'parent',
      stateId: 'state',
      toolCallId: 'call-789',
      onSubagentEvent: (e) => events.push(e),
    };

    await expect((tool.run as ContextAwareToolRun)({}, context)).rejects.toThrow('Sub-agent failed');

    const endEvent = events.find((e) => e.type === 'subagent_end');
    expect(endEvent).toBeDefined();
    if (endEvent?.type === 'subagent_end') {
      expect(endEvent.success).toBe(false);
      expect(endEvent.error).toBe('Sub-agent failed');
    }
  });

  test('forwards inner events during streaming', async () => {
    const events: SubagentEvent[] = [];
    const subAgent = createMockAgent();
    const tool = createSubAgentTool({
      agent: subAgent,
      name: 'streaming_test',
      description: 'Tests streaming',
      parameters: { type: 'object', properties: {} },
      buildPrompt: () => 'stream test',
      stream: true, // explicit streaming
    });

    const context: ToolExecutionContext = {
      agentId: 'parent',
      stateId: 'state',
      toolCallId: 'call-stream',
      onSubagentEvent: (e) => events.push(e),
    };

    await (tool.run as ContextAwareToolRun)({}, context);

    // Should have: start, inner events, end
    const innerEvents = events.filter((e) => e.type === 'subagent_event');
    expect(innerEvents.length).toBeGreaterThan(0);

    // Inner events should contain the actual stream events
    const firstInner = innerEvents[0];
    expect(firstInner).toBeDefined();
    if (firstInner?.type === 'subagent_event') {
      expect(firstInner.innerEvent).toBeDefined();
    }
  });

  test('works without context (generates own IDs)', async () => {
    const subAgent = createMockAgent();
    const tool = createSubAgentTool({
      agent: subAgent,
      name: 'no_context',
      description: 'No context test',
      parameters: { type: 'object', properties: {} },
      buildPrompt: () => 'test',
    });

    // Call without context
    const result = await tool.run({});

    // Should still work
    expect(result).toBe('Sub-agent response');
  });

  test('uses tool name as subagentType when not specified', async () => {
    const events: SubagentEvent[] = [];
    const subAgent = createMockAgent();
    const tool = createSubAgentTool({
      agent: subAgent,
      name: 'default_type_test',
      description: 'Tests default type',
      parameters: { type: 'object', properties: {} },
      buildPrompt: () => 'test',
      // subagentType not specified
    });

    const context: ToolExecutionContext = {
      agentId: 'parent',
      stateId: 'state',
      toolCallId: 'call-default',
      onSubagentEvent: (e) => events.push(e),
    };

    await (tool.run as ContextAwareToolRun)({}, context);

    const startEvent = events.find((e) => e.type === 'subagent_start');
    expect(startEvent?.subagentType).toBe('default_type_test');
  });

  test('buildPrompt receives params correctly', async () => {
    let receivedParams: Record<string, unknown> | undefined;
    const subAgent = createMockAgent();
    const tool = createSubAgentTool({
      agent: subAgent,
      name: 'params_test',
      description: 'Tests params',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number' },
        },
      },
      buildPrompt: (params) => {
        receivedParams = params;
        return `Query: ${params.query}, Limit: ${params.limit}`;
      },
    });

    await tool.run({ query: 'test query', limit: 10 });

    expect(receivedParams).toEqual({ query: 'test query', limit: 10 });
  });

  test('can disable streaming with stream: false', async () => {
    const events: SubagentEvent[] = [];
    const subAgent = createMockAgent();
    const tool = createSubAgentTool({
      agent: subAgent,
      name: 'no_stream',
      description: 'No streaming',
      parameters: { type: 'object', properties: {} },
      buildPrompt: () => 'test',
      stream: false, // Disable streaming
    });

    const context: ToolExecutionContext = {
      agentId: 'parent',
      stateId: 'state',
      toolCallId: 'call-no-stream',
      onSubagentEvent: (e) => events.push(e),
    };

    await (tool.run as ContextAwareToolRun)({}, context);

    // Should have start and end, but no inner events
    const innerEvents = events.filter((e) => e.type === 'subagent_event');
    expect(innerEvents.length).toBe(0);

    // But should still have start and end
    expect(events.some((e) => e.type === 'subagent_start')).toBe(true);
    expect(events.some((e) => e.type === 'subagent_end')).toBe(true);
  });

  test('subagentId is unique across invocations', async () => {
    const events: SubagentEvent[] = [];
    const subAgent = createMockAgent();
    const tool = createSubAgentTool({
      agent: subAgent,
      name: 'unique_id_test',
      description: 'Tests unique IDs',
      parameters: { type: 'object', properties: {} },
      buildPrompt: () => 'test',
    });

    const context: ToolExecutionContext = {
      agentId: 'parent',
      stateId: 'state',
      toolCallId: 'call-unique',
      onSubagentEvent: (e) => events.push(e),
    };

    await (tool.run as ContextAwareToolRun)({}, context);
    await (tool.run as ContextAwareToolRun)({}, context);
    await (tool.run as ContextAwareToolRun)({}, context);

    const startEvents = events.filter((e) => e.type === 'subagent_start');
    const subagentIds = startEvents.map((e) => e.subagentId);

    // All IDs should be unique
    const uniqueIds = new Set(subagentIds);
    expect(uniqueIds.size).toBe(3);
  });
});
