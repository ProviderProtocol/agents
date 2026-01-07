/**
 * Unit tests for sub-agent event types.
 *
 * @see UAP-1.0 Spec Section 8.7
 */

import { describe, test, expect } from 'bun:test';
import type {
  SubagentEvent,
  SubagentStartEvent,
  SubagentInnerEvent,
  SubagentEndEvent,
  OnSubagentEvent,
  AgentStreamEvent,
} from '../../../src/execution/types.ts';

describe('SubagentEvent types', () => {
  describe('SubagentStartEvent', () => {
    test('should have correct structure', () => {
      const event: SubagentStartEvent = {
        type: 'subagent_start',
        subagentId: 'sub-123',
        subagentType: 'explorer',
        parentToolCallId: 'tool-456',
        prompt: 'Find all TypeScript files',
        timestamp: Date.now(),
      };

      expect(event.type).toBe('subagent_start');
      expect(event.subagentId).toBe('sub-123');
      expect(event.subagentType).toBe('explorer');
      expect(event.parentToolCallId).toBe('tool-456');
      expect(event.prompt).toBe('Find all TypeScript files');
      expect(typeof event.timestamp).toBe('number');
    });
  });

  describe('SubagentInnerEvent', () => {
    test('should wrap inner AgentStreamEvent', () => {
      const innerEvent: AgentStreamEvent = {
        source: 'upp',
        upp: {
          type: 'text_delta',
          index: 0,
          delta: { text: 'Hello' },
        },
      };

      const event: SubagentInnerEvent = {
        type: 'subagent_event',
        subagentId: 'sub-123',
        subagentType: 'explorer',
        parentToolCallId: 'tool-456',
        innerEvent,
      };

      expect(event.type).toBe('subagent_event');
      expect(event.innerEvent.source).toBe('upp');
      expect(event.innerEvent.upp?.type).toBe('text_delta');
    });

    test('should wrap UAP events from sub-agent', () => {
      const innerEvent: AgentStreamEvent = {
        source: 'uap',
        uap: {
          type: 'step_start',
          step: 1,
          agentId: 'sub-123',
          data: { iteration: 1 },
        },
      };

      const event: SubagentInnerEvent = {
        type: 'subagent_event',
        subagentId: 'sub-123',
        subagentType: 'planner',
        parentToolCallId: 'tool-789',
        innerEvent,
      };

      expect(event.innerEvent.source).toBe('uap');
      expect(event.innerEvent.uap?.type).toBe('step_start');
    });
  });

  describe('SubagentEndEvent', () => {
    test('should have correct structure for successful completion', () => {
      const event: SubagentEndEvent = {
        type: 'subagent_end',
        subagentId: 'sub-123',
        subagentType: 'explorer',
        parentToolCallId: 'tool-456',
        success: true,
        result: 'Found 42 TypeScript files',
        timestamp: Date.now(),
        toolExecutions: [
          {
            toolName: 'Glob',
            arguments: { pattern: '**/*.ts' },
            result: 'file1.ts\nfile2.ts',
          },
        ],
      };

      expect(event.type).toBe('subagent_end');
      expect(event.success).toBe(true);
      expect(event.result).toBe('Found 42 TypeScript files');
      expect(event.error).toBeUndefined();
      expect(event.toolExecutions).toHaveLength(1);
      expect(event.toolExecutions?.[0]?.toolName).toBe('Glob');
    });

    test('should have correct structure for failed completion', () => {
      const event: SubagentEndEvent = {
        type: 'subagent_end',
        subagentId: 'sub-123',
        subagentType: 'explorer',
        parentToolCallId: 'tool-456',
        success: false,
        error: 'Rate limit exceeded',
        timestamp: Date.now(),
      };

      expect(event.type).toBe('subagent_end');
      expect(event.success).toBe(false);
      expect(event.error).toBe('Rate limit exceeded');
      expect(event.result).toBeUndefined();
    });
  });

  describe('SubagentEvent union type', () => {
    test('should discriminate by type field', () => {
      const events: SubagentEvent[] = [
        {
          type: 'subagent_start',
          subagentId: 'sub-1',
          subagentType: 'explorer',
          parentToolCallId: 'tool-1',
          prompt: 'test',
          timestamp: 1000,
        },
        {
          type: 'subagent_event',
          subagentId: 'sub-1',
          subagentType: 'explorer',
          parentToolCallId: 'tool-1',
          innerEvent: { source: 'upp', upp: { type: 'text_delta', index: 0, delta: { text: 'hi' } } },
        },
        {
          type: 'subagent_end',
          subagentId: 'sub-1',
          subagentType: 'explorer',
          parentToolCallId: 'tool-1',
          success: true,
          timestamp: 2000,
        },
      ];

      // Type narrowing should work correctly
      for (const event of events) {
        switch (event.type) {
          case 'subagent_start':
            expect(event.prompt).toBeDefined();
            break;
          case 'subagent_event':
            expect(event.innerEvent).toBeDefined();
            break;
          case 'subagent_end':
            expect(typeof event.success).toBe('boolean');
            break;
        }
      }
    });
  });

  describe('OnSubagentEvent callback', () => {
    test('should be callable with any SubagentEvent', () => {
      const receivedEvents: SubagentEvent[] = [];

      const callback: OnSubagentEvent = (event) => {
        receivedEvents.push(event);
      };

      // Emit start event
      callback({
        type: 'subagent_start',
        subagentId: 'sub-1',
        subagentType: 'explorer',
        parentToolCallId: 'tool-1',
        prompt: 'test',
        timestamp: Date.now(),
      });

      // Emit inner event
      callback({
        type: 'subagent_event',
        subagentId: 'sub-1',
        subagentType: 'explorer',
        parentToolCallId: 'tool-1',
        innerEvent: { source: 'upp', upp: { type: 'message_stop', index: 0, delta: {} } },
      });

      // Emit end event
      callback({
        type: 'subagent_end',
        subagentId: 'sub-1',
        subagentType: 'explorer',
        parentToolCallId: 'tool-1',
        success: true,
        result: 'done',
        timestamp: Date.now(),
      });

      expect(receivedEvents).toHaveLength(3);
      expect(receivedEvents[0]?.type).toBe('subagent_start');
      expect(receivedEvents[1]?.type).toBe('subagent_event');
      expect(receivedEvents[2]?.type).toBe('subagent_end');
    });
  });
});

describe('UAPEventType includes subagent events', () => {
  test('subagent event types are valid UAPEventType values', () => {
    // These should compile without errors
    const types: import('../../../src/execution/types.ts').UAPEventType[] = [
      'subagent_start',
      'subagent_event',
      'subagent_end',
    ];

    expect(types).toContain('subagent_start');
    expect(types).toContain('subagent_event');
    expect(types).toContain('subagent_end');
  });
});
