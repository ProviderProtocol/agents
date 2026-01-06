import { describe, test, expect, mock } from 'bun:test';
import { UserMessage, AssistantMessage } from '@providerprotocol/ai';
import type { Turn } from '@providerprotocol/ai';
import { logging } from '../../../src/middleware/logging.ts';
import type { MiddlewareContext } from '../../../src/middleware/types.ts';
import type { GenerateResult } from '../../../src/execution/types.ts';
import { AgentState } from '../../../src/state/index.ts';

function createMockContext(): MiddlewareContext {
  return {
    agent: { id: 'test-agent', system: 'Test system' },
    input: new UserMessage('Hello'),
    state: AgentState.initial(),
    metadata: new Map(),
  };
}

function createMockResult(): GenerateResult {
  const response = new AssistantMessage('Hello back!');
  return {
    turn: {
      response,
      messages: [response],
      toolExecutions: [],
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
      },
      cycles: 1,
    } as unknown as Turn,
    state: AgentState.initial(),
  };
}

describe('logging() middleware', () => {
  describe('configuration', () => {
    test('uses default options', () => {
      const mw = logging();
      expect(mw.name).toBe('logging');
    });

    test('accepts custom log level', () => {
      const mw = logging({ level: 'debug' });
      expect(mw.name).toBe('logging');
    });

    test('accepts custom logger', () => {
      const customLogger = mock(() => {});
      const mw = logging({ logger: customLogger });
      expect(mw.name).toBe('logging');
    });
  });

  describe('before()', () => {
    test('logs execution started', async () => {
      const logs: string[] = [];
      const mw = logging({
        logger: (msg) => logs.push(msg),
      });

      const context = createMockContext();
      await mw.before?.(context);

      expect(logs.some((l) => l.includes('Execution started'))).toBe(true);
    });

    test('includes agent ID in log', async () => {
      const logs: string[] = [];
      const mw = logging({
        logger: (msg) => logs.push(msg),
      });

      const context = createMockContext();
      await mw.before?.(context);

      expect(logs.some((l) => l.includes('test-agent'))).toBe(true);
    });

    test('sets start time in metadata when timing enabled', async () => {
      const mw = logging({ includeTiming: true });
      const context = createMockContext();

      await mw.before?.(context);

      expect(context.metadata.has('_logging_startTime')).toBe(true);
      expect(typeof context.metadata.get('_logging_startTime')).toBe('number');
    });

    test('returns context', async () => {
      const mw = logging();
      const context = createMockContext();

      const result = await mw.before?.(context);

      expect(result).toBe(context);
    });

    test('logs input when includeMessages is true', async () => {
      const logs: string[] = [];
      const mw = logging({
        logger: (msg) => logs.push(msg),
        includeMessages: true,
        level: 'debug',
      });

      const context = createMockContext();
      await mw.before?.(context);

      expect(logs.some((l) => l.includes('Input'))).toBe(true);
    });
  });

  describe('after()', () => {
    test('logs execution completed', async () => {
      const logs: string[] = [];
      const mw = logging({
        logger: (msg) => logs.push(msg),
      });

      const context = createMockContext();
      const result = createMockResult();

      await mw.after?.(context, result);

      expect(logs.some((l) => l.includes('Execution completed'))).toBe(true);
    });

    test('includes timing when enabled', async () => {
      const logs: string[] = [];
      const mw = logging({
        logger: (msg) => logs.push(msg),
        includeTiming: true,
      });

      const context = createMockContext();
      context.metadata.set('_logging_startTime', Date.now() - 100);
      const result = createMockResult();

      await mw.after?.(context, result);

      expect(logs.some((l) => l.includes('ms'))).toBe(true);
    });

    test('includes token count', async () => {
      const logs: string[] = [];
      const mw = logging({
        logger: (msg) => logs.push(msg),
      });

      const context = createMockContext();
      const result = createMockResult();

      await mw.after?.(context, result);

      expect(logs.some((l) => l.includes('tokens=30'))).toBe(true);
    });

    test('returns result unchanged', async () => {
      const mw = logging();
      const context = createMockContext();
      const result = createMockResult();

      const returned = await mw.after?.(context, result);

      expect(returned).toBe(result);
    });

    test('logs response when includeMessages is true', async () => {
      const logs: string[] = [];
      const mw = logging({
        logger: (msg) => logs.push(msg),
        includeMessages: true,
        level: 'debug',
      });

      const context = createMockContext();
      const result = createMockResult();

      await mw.after?.(context, result);

      expect(logs.some((l) => l.includes('Response'))).toBe(true);
    });
  });

  describe('onError()', () => {
    test('logs error message', async () => {
      const logs: string[] = [];
      const mw = logging({
        logger: (msg) => logs.push(msg),
      });

      const context = createMockContext();
      const error = new Error('Something went wrong');

      await mw.onError?.(context, error);

      expect(logs.some((l) => l.includes('Execution failed'))).toBe(true);
      expect(logs.some((l) => l.includes('Something went wrong'))).toBe(true);
    });

    test('includes timing when enabled', async () => {
      const logs: string[] = [];
      const mw = logging({
        logger: (msg) => logs.push(msg),
        includeTiming: true,
      });

      const context = createMockContext();
      context.metadata.set('_logging_startTime', Date.now() - 50);
      const error = new Error('Failed');

      await mw.onError?.(context, error);

      expect(logs.some((l) => l.includes('after') && l.includes('ms'))).toBe(true);
    });

    test('returns undefined to let error propagate', async () => {
      const mw = logging();
      const context = createMockContext();
      const error = new Error('Error');

      const result = await mw.onError?.(context, error);

      expect(result).toBeUndefined();
    });

    test('uses error log level', async () => {
      const logs: string[] = [];
      const mw = logging({
        logger: (msg) => logs.push(msg),
        level: 'error',
      });

      const context = createMockContext();
      const error = new Error('Failed');

      await mw.onError?.(context, error);

      expect(logs.some((l) => l.includes('[UAP:ERROR]'))).toBe(true);
    });
  });

  describe('log levels', () => {
    test('debug level logs everything', async () => {
      const logs: string[] = [];
      const mw = logging({
        logger: (msg) => logs.push(msg),
        level: 'debug',
        includeMessages: true,
      });

      const context = createMockContext();
      await mw.before?.(context);

      expect(logs.length).toBeGreaterThan(0);
    });

    test('error level only logs errors', async () => {
      const logs: string[] = [];
      const mw = logging({
        logger: (msg) => logs.push(msg),
        level: 'error',
      });

      const context = createMockContext();
      const result = createMockResult();

      await mw.before?.(context);
      await mw.after?.(context, result);

      // Info messages should not be logged at error level
      expect(logs.filter((l) => l.includes('[UAP:INFO]'))).toHaveLength(0);
    });
  });
});
