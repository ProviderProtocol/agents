/**
 * Live tests for sub-agent event propagation.
 *
 * These tests verify that sub-agent events are correctly emitted
 * when using the Task tool pattern.
 *
 * @see UAP-1.0 Spec Section 8.7
 */

import { describe, test, expect } from 'bun:test';
import { agent, AgentState } from '../../src/index.ts';
import type {
  SubagentEvent,
  SubagentStartEvent,
  SubagentEndEvent,
  OnSubagentEvent,
} from '../../src/execution/types.ts';
import { anthropic } from '@providerprotocol/ai/anthropic';
import type { Tool } from '@providerprotocol/ai';

/**
 * Helper to create a simple sub-agent tool with event propagation.
 */
function createSubagentTool(options: {
  name: string;
  subagentType: string;
  onSubagentEvent?: OnSubagentEvent;
}): Tool {
  const { name, subagentType, onSubagentEvent } = options;

  // Create a simple sub-agent
  const subAgent = agent({
    model: anthropic('claude-3-5-haiku-latest'),
    params: { max_tokens: 256 },
    system: 'You are a helpful assistant. Be concise.',
  });

  return {
    name,
    description: `A sub-agent that helps with tasks. Type: ${subagentType}`,
    parameters: {
      type: 'object' as const,
      properties: {
        task: {
          type: 'string' as const,
          description: 'The task to perform',
        },
      },
      required: ['task'],
    },
    run: async (params: { task: string }, context?: { toolCallId?: string }) => {
      const subagentId = `sub-${Date.now()}`;
      const parentToolCallId = context?.toolCallId ?? `tool-${Date.now()}`;
      const startTime = Date.now();

      // Emit start event
      onSubagentEvent?.({
        type: 'subagent_start',
        subagentId,
        subagentType,
        parentToolCallId,
        prompt: params.task,
        timestamp: startTime,
      });

      try {
        // Stream the sub-agent for real-time events
        const stream = subAgent.stream(params.task, AgentState.initial());

        // Forward inner events
        for await (const event of stream) {
          onSubagentEvent?.({
            type: 'subagent_event',
            subagentId,
            subagentType,
            parentToolCallId,
            innerEvent: event,
          });
        }

        const result = await stream.result;
        const endTime = Date.now();

        // Emit end event
        onSubagentEvent?.({
          type: 'subagent_end',
          subagentId,
          subagentType,
          parentToolCallId,
          success: true,
          result: result.turn.response.text,
          timestamp: endTime,
          toolExecutions: result.turn.toolExecutions?.map((exec) => ({
            toolName: exec.toolName,
            arguments: exec.arguments as Record<string, unknown>,
            result: typeof exec.result === 'string' ? exec.result : JSON.stringify(exec.result),
          })),
        });

        return result.turn.response.text;
      } catch (error) {
        const endTime = Date.now();

        // Emit error end event
        onSubagentEvent?.({
          type: 'subagent_end',
          subagentId,
          subagentType,
          parentToolCallId,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          timestamp: endTime,
        });

        throw error;
      }
    },
  };
}

describe('Sub-agent event propagation (live)', () => {
  test('sub-agent tool emits start, inner events, and end events', async () => {
    const receivedEvents: SubagentEvent[] = [];

    const subagentTool = createSubagentTool({
      name: 'helper',
      subagentType: 'assistant',
      onSubagentEvent: (event) => receivedEvents.push(event),
    });

    // Call the tool directly
    const result = await subagentTool.run({ task: 'Say hello' });

    // Verify we received events
    expect(receivedEvents.length).toBeGreaterThan(0);

    // Check for start event
    const startEvent = receivedEvents.find((e) => e.type === 'subagent_start') as SubagentStartEvent | undefined;
    expect(startEvent).toBeDefined();
    expect(startEvent?.subagentType).toBe('assistant');
    expect(startEvent?.prompt).toBe('Say hello');

    // Check for inner events (should have at least text deltas)
    const innerEvents = receivedEvents.filter((e) => e.type === 'subagent_event');
    expect(innerEvents.length).toBeGreaterThan(0);

    // Check for end event
    const endEvent = receivedEvents.find((e) => e.type === 'subagent_end') as SubagentEndEvent | undefined;
    expect(endEvent).toBeDefined();
    expect(endEvent?.success).toBe(true);
    expect(endEvent?.result).toBeDefined();

    // Result should match end event result
    expect(result).toBe(endEvent?.result);

    // Verify event order: start should come before end
    const startIndex = receivedEvents.findIndex((e) => e.type === 'subagent_start');
    const endIndex = receivedEvents.findIndex((e) => e.type === 'subagent_end');
    expect(startIndex).toBeLessThan(endIndex);

    // All events should have the same subagentId
    const subagentId = startEvent?.subagentId;
    expect(receivedEvents.every((e) => e.subagentId === subagentId)).toBe(true);
  }, 30000);

  test('sub-agent inner events include text deltas', async () => {
    const receivedEvents: SubagentEvent[] = [];

    const subagentTool = createSubagentTool({
      name: 'helper',
      subagentType: 'assistant',
      onSubagentEvent: (event) => receivedEvents.push(event),
    });

    await subagentTool.run({ task: 'Count from 1 to 3' });

    // Find text delta events
    const textDeltas = receivedEvents.filter(
      (e) => e.type === 'subagent_event' && e.innerEvent.source === 'upp' && e.innerEvent.upp?.type === 'text_delta'
    );

    // Should have some text deltas
    expect(textDeltas.length).toBeGreaterThan(0);
  }, 30000);

  test('sub-agent events have consistent parentToolCallId', async () => {
    const receivedEvents: SubagentEvent[] = [];

    const subagentTool = createSubagentTool({
      name: 'helper',
      subagentType: 'assistant',
      onSubagentEvent: (event) => receivedEvents.push(event),
    });

    // Call with explicit context
    await (subagentTool.run as (params: { task: string }, context?: { toolCallId?: string }) => Promise<string>)(
      { task: 'Hello' },
      { toolCallId: 'custom-tool-id-123' }
    );

    // All events should have the same parentToolCallId
    expect(receivedEvents.every((e) => e.parentToolCallId === 'custom-tool-id-123')).toBe(true);
  }, 30000);

  test('timestamps are monotonically increasing', async () => {
    const receivedEvents: SubagentEvent[] = [];

    const subagentTool = createSubagentTool({
      name: 'helper',
      subagentType: 'assistant',
      onSubagentEvent: (event) => receivedEvents.push(event),
    });

    await subagentTool.run({ task: 'Hi' });

    const startEvent = receivedEvents.find((e) => e.type === 'subagent_start') as SubagentStartEvent | undefined;
    const endEvent = receivedEvents.find((e) => e.type === 'subagent_end') as SubagentEndEvent | undefined;

    expect(startEvent?.timestamp).toBeDefined();
    expect(endEvent?.timestamp).toBeDefined();
    if (startEvent && endEvent) {
      expect(endEvent.timestamp).toBeGreaterThanOrEqual(startEvent.timestamp);
    }
  }, 30000);
});

describe('Sub-agent event type guards', () => {
  test('can filter events by type', async () => {
    const receivedEvents: SubagentEvent[] = [];

    const subagentTool = createSubagentTool({
      name: 'helper',
      subagentType: 'assistant',
      onSubagentEvent: (event) => receivedEvents.push(event),
    });

    await subagentTool.run({ task: 'Say one word' });

    // Filter start events
    const startEvents = receivedEvents.filter((e): e is SubagentStartEvent => e.type === 'subagent_start');
    expect(startEvents).toHaveLength(1);
    expect(startEvents[0]?.prompt).toBeDefined();

    // Filter end events
    const endEvents = receivedEvents.filter((e): e is SubagentEndEvent => e.type === 'subagent_end');
    expect(endEvents).toHaveLength(1);
    expect(typeof endEvents[0]?.success).toBe('boolean');
  }, 30000);
});
