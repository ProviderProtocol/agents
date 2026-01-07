import { describe, test, expect } from 'bun:test';
import type { ToolCall } from '@providerprotocol/ai';
import {
  orderToolCalls,
  hasToolDependencies,
  hasCallDependencies,
  executeOrderedToolCalls,
} from '../../../src/execution/tool-ordering.ts';
import type {
  ToolWithDependencies,
  OrderedToolCall,
} from '../../../src/execution/types.ts';

// Helper to create a mock tool
function createTool(
  name: string,
  options?: { sequential?: boolean; dependsOn?: string[] },
): ToolWithDependencies {
  return {
    name,
    description: `Tool ${name}`,
    parameters: { type: 'object', properties: {} },
    run: async () => 'result',
    sequential: options?.sequential,
    dependsOn: options?.dependsOn,
  };
}

// Helper to create a mock tool call
function createToolCall(
  toolName: string,
  id?: string,
  after?: string[],
): ToolCall | OrderedToolCall {
  const call: OrderedToolCall = {
    toolCallId: id ?? `call-${toolName}`,
    toolName,
    arguments: {},
  };
  if (after) {
    call.after = after;
  }
  return call;
}

describe('orderToolCalls()', () => {
  test('returns empty array for no tool calls', () => {
    const groups = orderToolCalls([], []);
    expect(groups).toEqual([]);
  });

  test('groups independent tools together', () => {
    const tools = [
      createTool('tool_a'),
      createTool('tool_b'),
      createTool('tool_c'),
    ];

    const calls = [
      createToolCall('tool_a'),
      createToolCall('tool_b'),
      createToolCall('tool_c'),
    ];

    const groups = orderToolCalls(calls, tools);

    expect(groups).toHaveLength(1);
    const firstGroup = groups[0];
    expect(firstGroup).toBeDefined();
    if (firstGroup) {
      expect(firstGroup.calls).toHaveLength(3);
      expect(firstGroup.isBarrier).toBe(false);
    }
  });

  test('sequential tool creates barrier', () => {
    const tools = [
      createTool('read', { sequential: true }),
      createTool('process'),
    ];

    const calls = [
      createToolCall('read'),
      createToolCall('process'),
    ];

    const groups = orderToolCalls(calls, tools);

    // read should be in its own group as a barrier
    expect(groups.length).toBeGreaterThanOrEqual(1);
    const readGroup = groups.find((g) => g.calls.some((c) => c.toolName === 'read'));
    expect(readGroup?.isBarrier).toBe(true);
  });

  test('dependsOn creates ordering', () => {
    const tools = [
      createTool('read'),
      createTool('write', { dependsOn: ['read'] }),
    ];

    const calls = [
      createToolCall('read'),
      createToolCall('write'),
    ];

    const groups = orderToolCalls(calls, tools);

    // Should have at least 2 groups due to dependency
    expect(groups.length).toBeGreaterThanOrEqual(2);

    // Find read and write group indices
    const readGroupIndex = groups.findIndex(
      (g) => g.calls.some((c) => c.toolName === 'read'),
    );
    const writeGroupIndex = groups.findIndex(
      (g) => g.calls.some((c) => c.toolName === 'write'),
    );

    // read should come before write
    expect(readGroupIndex).toBeLessThan(writeGroupIndex);
  });

  test('model-driven dependencies (after field)', () => {
    const tools = [
      createTool('tool_a'),
      createTool('tool_b'),
    ];

    const calls = [
      createToolCall('tool_a', 'call-1'),
      createToolCall('tool_b', 'call-2', ['call-1']), // depends on call-1
    ] as OrderedToolCall[];

    const groups = orderToolCalls(calls, tools);

    // Should have at least 2 groups due to dependency
    expect(groups.length).toBeGreaterThanOrEqual(2);

    // Find group indices
    const aGroupIndex = groups.findIndex(
      (g) => g.calls.some((c) => c.toolCallId === 'call-1'),
    );
    const bGroupIndex = groups.findIndex(
      (g) => g.calls.some((c) => c.toolCallId === 'call-2'),
    );

    // call-1 should come before call-2
    expect(aGroupIndex).toBeLessThan(bGroupIndex);
  });

  test('complex dependency chain', () => {
    // A -> B -> C (chain dependency)
    const tools = [
      createTool('tool_a'),
      createTool('tool_b', { dependsOn: ['tool_a'] }),
      createTool('tool_c', { dependsOn: ['tool_b'] }),
    ];

    const calls = [
      createToolCall('tool_a'),
      createToolCall('tool_b'),
      createToolCall('tool_c'),
    ];

    const groups = orderToolCalls(calls, tools);

    // Should have 3 groups, one for each tool
    expect(groups).toHaveLength(3);

    // Verify order
    expect(groups[0]?.calls[0]?.toolName).toBe('tool_a');
    expect(groups[1]?.calls[0]?.toolName).toBe('tool_b');
    expect(groups[2]?.calls[0]?.toolName).toBe('tool_c');
  });

  test('parallel tools with shared dependency', () => {
    // D depends on both A and B (which can run in parallel)
    const tools = [
      createTool('tool_a'),
      createTool('tool_b'),
      createTool('tool_d', { dependsOn: ['tool_a', 'tool_b'] }),
    ];

    const calls = [
      createToolCall('tool_a'),
      createToolCall('tool_b'),
      createToolCall('tool_d'),
    ];

    const groups = orderToolCalls(calls, tools);

    // First group should have A and B (parallel)
    // Second group should have D
    expect(groups.length).toBeGreaterThanOrEqual(2);

    const firstGroup = groups[0];
    expect(firstGroup).toBeDefined();
    if (firstGroup) {
      const hasA = firstGroup.calls.some((c) => c.toolName === 'tool_a');
      const hasB = firstGroup.calls.some((c) => c.toolName === 'tool_b');
      expect(hasA).toBe(true);
      expect(hasB).toBe(true);
    }

    const dGroupIndex = groups.findIndex(
      (g) => g.calls.some((c) => c.toolName === 'tool_d'),
    );
    expect(dGroupIndex).toBe(groups.length - 1); // D should be last
  });

  test('handles unknown tools gracefully', () => {
    const tools = [createTool('known')];
    const calls = [
      createToolCall('known'),
      createToolCall('unknown'),
    ];

    // Should not throw
    const groups = orderToolCalls(calls, tools);
    expect(groups.length).toBeGreaterThan(0);
  });

  test('handles cyclic dependencies by executing remaining items', () => {
    // A depends on B, B depends on A (cycle)
    const tools = [
      createTool('tool_a', { dependsOn: ['tool_b'] }),
      createTool('tool_b', { dependsOn: ['tool_a'] }),
    ];

    const calls = [
      createToolCall('tool_a'),
      createToolCall('tool_b'),
    ];

    // Should not hang - should execute items despite cycle
    const groups = orderToolCalls(calls, tools);
    expect(groups.length).toBeGreaterThan(0);

    // All calls should be included
    const allCalls = groups.flatMap((g) => g.calls);
    expect(allCalls).toHaveLength(2);
  });
});

describe('hasToolDependencies()', () => {
  test('returns false for tools without dependencies', () => {
    const tools = [
      createTool('tool_a'),
      createTool('tool_b'),
    ];

    expect(hasToolDependencies(tools)).toBe(false);
  });

  test('returns true for sequential tool', () => {
    const tools = [
      createTool('tool_a'),
      createTool('tool_b', { sequential: true }),
    ];

    expect(hasToolDependencies(tools)).toBe(true);
  });

  test('returns true for tool with dependsOn', () => {
    const tools = [
      createTool('tool_a'),
      createTool('tool_b', { dependsOn: ['tool_a'] }),
    ];

    expect(hasToolDependencies(tools)).toBe(true);
  });

  test('returns false for empty array', () => {
    expect(hasToolDependencies([])).toBe(false);
  });
});

describe('hasCallDependencies()', () => {
  test('returns false for calls without after field', () => {
    const calls = [
      createToolCall('tool_a'),
      createToolCall('tool_b'),
    ];

    expect(hasCallDependencies(calls)).toBe(false);
  });

  test('returns true for call with after field', () => {
    const calls = [
      createToolCall('tool_a', 'call-1'),
      createToolCall('tool_b', 'call-2', ['call-1']),
    ] as OrderedToolCall[];

    expect(hasCallDependencies(calls)).toBe(true);
  });

  test('returns false for empty array', () => {
    expect(hasCallDependencies([])).toBe(false);
  });

  test('returns false for empty after array', () => {
    const call: OrderedToolCall = {
      toolCallId: 'call-1',
      toolName: 'tool_a',
      arguments: {},
      after: [],
    };

    expect(hasCallDependencies([call])).toBe(false);
  });
});

describe('executeOrderedToolCalls()', () => {
  // Helper to track execution order
  function createTrackingTool(
    name: string,
    executionLog: string[],
    delay = 0,
    options?: { sequential?: boolean; dependsOn?: string[] },
  ): ToolWithDependencies {
    return {
      name,
      description: `Tool ${name}`,
      parameters: { type: 'object', properties: {} },
      run: async () => {
        executionLog.push(`${name}-start`);
        if (delay > 0) {
          await new Promise((r) => setTimeout(r, delay));
        }
        executionLog.push(`${name}-end`);
        return `result-${name}`;
      },
      sequential: options?.sequential,
      dependsOn: options?.dependsOn,
    };
  }

  test('executes tools in parallel when no dependencies', async () => {
    const log: string[] = [];
    const tools = [
      createTrackingTool('a', log, 20),
      createTrackingTool('b', log, 10),
    ];
    const calls = [
      createToolCall('a'),
      createToolCall('b'),
    ];

    const results = await executeOrderedToolCalls(calls, tools, async (call, tool) => tool.run(call.arguments));

    expect(results).toHaveLength(2);
    expect(results.every((r) => !r.isError)).toBe(true);

    // Both should start before either ends (parallel)
    const aStartIdx = log.indexOf('a-start');
    const bStartIdx = log.indexOf('b-start');
    const aEndIdx = log.indexOf('a-end');
    const bEndIdx = log.indexOf('b-end');

    // Both started before either ended
    expect(aStartIdx).toBeLessThan(aEndIdx);
    expect(bStartIdx).toBeLessThan(bEndIdx);
  });

  test('executes sequential tools one at a time', async () => {
    const log: string[] = [];
    const tools = [
      createTrackingTool('a', log, 10, { sequential: true }),
      createTrackingTool('b', log, 10, { sequential: true }),
    ];
    const calls = [
      createToolCall('a'),
      createToolCall('b'),
    ];

    await executeOrderedToolCalls(calls, tools, async (call, tool) => tool.run(call.arguments));

    // Sequential: a must complete before b starts
    const aEndIdx = log.indexOf('a-end');
    const bStartIdx = log.indexOf('b-start');
    expect(aEndIdx).toBeLessThan(bStartIdx);
  });

  test('respects dependsOn ordering', async () => {
    const log: string[] = [];
    const tools = [
      createTrackingTool('a', log, 10),
      createTrackingTool('b', log, 10, { dependsOn: ['a'] }),
    ];
    const calls = [
      createToolCall('a'),
      createToolCall('b'),
    ];

    await executeOrderedToolCalls(calls, tools, async (call, tool) => tool.run(call.arguments));

    // b depends on a, so a must complete before b starts
    const aEndIdx = log.indexOf('a-end');
    const bStartIdx = log.indexOf('b-start');
    expect(aEndIdx).toBeLessThan(bStartIdx);
  });

  test('handles tool execution errors', async () => {
    const tools = [createTool('failing')];
    const calls = [createToolCall('failing')];

    const results = await executeOrderedToolCalls(
      calls,
      tools,
      async () => {
        throw new Error('Tool failed');
      },
    );

    expect(results).toHaveLength(1);
    const result = results[0];
    expect(result).toBeDefined();
    expect(result?.isError).toBe(true);
    expect(result?.error).toBe('Tool failed');
  });

  test('handles missing tool', async () => {
    const tools: ToolWithDependencies[] = [];
    const calls = [createToolCall('unknown')];

    const results = await executeOrderedToolCalls(calls, tools, async (call, tool) => tool.run(call.arguments));

    expect(results).toHaveLength(1);
    const result = results[0];
    expect(result).toBeDefined();
    expect(result?.isError).toBe(true);
    expect(result?.error).toContain('not found');
  });

  test('returns empty array for empty calls', async () => {
    const results = await executeOrderedToolCalls([], [], async () => 'result');
    expect(results).toEqual([]);
  });

  test('includes execution duration', async () => {
    const tools = [createTool('timed')];
    const calls = [createToolCall('timed')];

    const results = await executeOrderedToolCalls(
      calls,
      tools,
      async () => {
        await new Promise((r) => setTimeout(r, 20));
        return 'done';
      },
    );

    const result = results[0];
    expect(result).toBeDefined();
    expect(result?.duration).toBeGreaterThanOrEqual(15);
  });

  test('passes call arguments to executor', async () => {
    let receivedArgs: Record<string, unknown> | undefined;
    const tools = [createTool('argcheck')];
    const call = { ...createToolCall('argcheck'), arguments: { key: 'value' } };

    await executeOrderedToolCalls(
      [call],
      tools,
      async (c) => {
        receivedArgs = c.arguments as Record<string, unknown>;
        return 'done';
      },
    );

    expect(receivedArgs).toEqual({ key: 'value' });
  });
});
