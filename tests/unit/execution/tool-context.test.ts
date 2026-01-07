import { describe, test, expect } from 'bun:test';
import type { Tool } from '@providerprotocol/ai';
import {
  injectToolContext,
  isContextAwareTool,
  withToolContext,
} from '../../../src/execution/tool-context.ts';
import type {
  ExecutionContext,
  ToolExecutionContext,
  SubagentEvent,
} from '../../../src/execution/types.ts';
import { AgentState } from '../../../src/state/index.ts';

// Create a mock execution context for testing
function createMockExecutionContext(): ExecutionContext {
  return {
    agent: { id: 'test-agent-123' },
    llm: {} as ExecutionContext['llm'],
    input: {} as ExecutionContext['input'],
    state: AgentState.initial(),
    tools: [],
    strategy: {},
  };
}

describe('injectToolContext', () => {
  test('passes context to tools that accept second parameter', async () => {
    let receivedContext: ToolExecutionContext | undefined;

    // Tool that accepts context (2 parameters)
    const contextAwareTool: Tool = {
      name: 'context_aware',
      description: 'Tool that uses context',
      parameters: { type: 'object', properties: {} },
      run: async (
        params: Record<string, unknown>,
        context?: ToolExecutionContext,
      ): Promise<string> => {
        receivedContext = context;
        return 'done';
      },
    };

    const execContext = createMockExecutionContext();
    const wrapped = injectToolContext([contextAwareTool], execContext);
    const wrappedTool = wrapped[0];
    expect(wrappedTool).toBeDefined();
    if (!wrappedTool) return;

    await wrappedTool.run({ test: 'value' });

    expect(receivedContext).toBeDefined();
    expect(receivedContext?.agentId).toBe('test-agent-123');
    expect(receivedContext?.stateId).toBe(execContext.state.id);
    expect(receivedContext?.toolCallId).toBeDefined();
    // toolCallId should be a valid UUID
    expect(receivedContext?.toolCallId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  test('does not break simple tools (1 parameter)', async () => {
    let receivedParams: Record<string, unknown> | undefined;

    // Simple tool that only accepts params
    const simpleTool: Tool = {
      name: 'simple',
      description: 'Simple tool',
      parameters: { type: 'object', properties: {} },
      run: async (params: Record<string, unknown>): Promise<string> => {
        receivedParams = params;
        return 'simple result';
      },
    };

    const execContext = createMockExecutionContext();
    const wrapped = injectToolContext([simpleTool], execContext);
    const wrappedTool = wrapped[0];
    expect(wrappedTool).toBeDefined();
    if (!wrappedTool) return;

    const result = await wrappedTool.run({ key: 'value' });

    expect(result).toBe('simple result');
    expect(receivedParams).toEqual({ key: 'value' });
  });

  test('passes onSubagentEvent callback to context-aware tools', async () => {
    let receivedCallback: ((event: SubagentEvent) => void) | undefined;

    const contextAwareTool: Tool = {
      name: 'subagent_aware',
      description: 'Tool that handles sub-agent events',
      parameters: { type: 'object', properties: {} },
      run: async (
        _params: Record<string, unknown>,
        context?: ToolExecutionContext,
      ): Promise<string> => {
        receivedCallback = context?.onSubagentEvent;
        return 'done';
      },
    };

    const events: SubagentEvent[] = [];
    const mockEventHandler = (event: SubagentEvent): void => {
      events.push(event);
    };

    const execContext = createMockExecutionContext();
    const wrapped = injectToolContext([contextAwareTool], execContext, {
      onSubagentEvent: mockEventHandler,
    });
    const wrappedTool = wrapped[0];
    expect(wrappedTool).toBeDefined();
    if (!wrappedTool) return;

    await wrappedTool.run({});

    expect(receivedCallback).toBe(mockEventHandler);

    // Verify the callback works
    receivedCallback?.({
      type: 'subagent_start',
      subagentId: 'sub-1',
      subagentType: 'test',
      parentToolCallId: 'call-1',
      prompt: 'test prompt',
      timestamp: Date.now(),
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('subagent_start');
  });

  test('wraps multiple tools correctly', async () => {
    const results: string[] = [];

    const tool1: Tool = {
      name: 'tool1',
      description: 'First tool',
      parameters: { type: 'object', properties: {} },
      run: async (_p: unknown, ctx?: ToolExecutionContext): Promise<string> => {
        results.push(`tool1:${ctx?.agentId}`);
        return 'result1';
      },
    };

    const tool2: Tool = {
      name: 'tool2',
      description: 'Second tool',
      parameters: { type: 'object', properties: {} },
      run: async (p: Record<string, unknown>): Promise<string> => {
        results.push(`tool2:${p.value}`);
        return 'result2';
      },
    };

    const execContext = createMockExecutionContext();
    const wrapped = injectToolContext([tool1, tool2], execContext);

    expect(wrapped).toHaveLength(2);
    const w0 = wrapped[0];
    const w1 = wrapped[1];
    expect(w0).toBeDefined();
    expect(w1).toBeDefined();
    if (!w0 || !w1) return;

    expect(w0.name).toBe('tool1');
    expect(w1.name).toBe('tool2');

    await w0.run({});
    await w1.run({ value: 'test' });

    expect(results).toEqual(['tool1:test-agent-123', 'tool2:test']);
  });

  test('preserves original tool properties', () => {
    const originalTool: Tool = {
      name: 'original',
      description: 'Original description',
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string' },
        },
        required: ['input'],
      },
      run: async () => 'result',
    };

    const execContext = createMockExecutionContext();
    const wrapped = injectToolContext([originalTool], execContext);
    const wrappedTool = wrapped[0];
    expect(wrappedTool).toBeDefined();
    if (!wrappedTool) return;

    expect(wrappedTool.name).toBe('original');
    expect(wrappedTool.description).toBe('Original description');
    expect(wrappedTool.parameters).toEqual(originalTool.parameters);
  });

  test('generates unique toolCallId for each invocation', async () => {
    const receivedIds: string[] = [];

    const tool: Tool = {
      name: 'tracking',
      description: 'Tracks call IDs',
      parameters: { type: 'object', properties: {} },
      run: async (_p: unknown, ctx?: ToolExecutionContext): Promise<string> => {
        if (ctx?.toolCallId) {
          receivedIds.push(ctx.toolCallId);
        }
        return 'done';
      },
    };

    const execContext = createMockExecutionContext();
    const wrapped = injectToolContext([tool], execContext);
    const wrappedTool = wrapped[0];
    expect(wrappedTool).toBeDefined();
    if (!wrappedTool) return;

    await wrappedTool.run({});
    await wrappedTool.run({});
    await wrappedTool.run({});

    expect(receivedIds).toHaveLength(3);
    // All IDs should be unique
    const uniqueIds = new Set(receivedIds);
    expect(uniqueIds.size).toBe(3);
  });
});

describe('isContextAwareTool', () => {
  test('returns true for tools with 2+ parameters', () => {
    const contextAware: Tool = {
      name: 'aware',
      description: 'Context aware',
      parameters: { type: 'object', properties: {} },
      run: async (_params: unknown, _ctx?: ToolExecutionContext) => 'result',
    };

    expect(isContextAwareTool(contextAware)).toBe(true);
  });

  test('returns false for tools with 1 parameter', () => {
    const simple: Tool = {
      name: 'simple',
      description: 'Simple',
      parameters: { type: 'object', properties: {} },
      run: async (_params: unknown) => 'result',
    };

    expect(isContextAwareTool(simple)).toBe(false);
  });
});

describe('withToolContext', () => {
  test('creates a context-aware wrapper for a tool', async () => {
    let capturedContext: ToolExecutionContext | undefined;

    const originalTool: Tool = {
      name: 'original',
      description: 'Original tool',
      parameters: { type: 'object', properties: {} },
      run: async (params: Record<string, unknown>) => `original:${params.value}`,
    };

    const wrapped = withToolContext(
      originalTool,
      async (params, context) => {
        capturedContext = context;
        // Can call original or do something else
        return `wrapped:${params.value}`;
      },
    );

    expect(wrapped.name).toBe('original');
    expect(wrapped.description).toBe('Original tool');

    // Now inject context and call
    const execContext = createMockExecutionContext();
    const injectedTools = injectToolContext([wrapped], execContext);
    const injected = injectedTools[0];
    expect(injected).toBeDefined();
    if (!injected) return;

    const result = await injected.run({ value: 'test' });

    expect(result).toBe('wrapped:test');
    expect(capturedContext).toBeDefined();
    expect(capturedContext?.agentId).toBe('test-agent-123');
  });
});
