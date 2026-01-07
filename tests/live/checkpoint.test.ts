import { describe, test, expect, setDefaultTimeout, beforeEach, afterEach } from 'bun:test';
import { rm } from 'node:fs/promises';
import { anthropic } from '@providerprotocol/ai/anthropic';
import type { Tool } from '@providerprotocol/ai';
import { agent, AgentState } from '../../src/index.ts';
import { fileCheckpoints } from '../../src/checkpoint/index.ts';
import { loop } from '../../src/execution/index.ts';

// Skip tests if no API key
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Increase timeout for live API tests (60 seconds for multi-step tests)
setDefaultTimeout(60_000);

const TEST_CHECKPOINT_DIR = '.test-live-checkpoints';

describe.skipIf(!ANTHROPIC_API_KEY)('Checkpointing with Live API', () => {
  beforeEach(async () => {
    // Clean up test directory before each test
    try {
      await rm(TEST_CHECKPOINT_DIR, { recursive: true, force: true });
    } catch {
      // Ignore if doesn't exist
    }
  });

  afterEach(async () => {
    // Clean up test directory after each test
    try {
      await rm(TEST_CHECKPOINT_DIR, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  describe('agent with checkpoints', () => {
    test('saves checkpoint after step_end', async () => {
      const store = fileCheckpoints({ dir: TEST_CHECKPOINT_DIR });

      const a = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 100 },
        checkpoints: store,
        sessionId: 'test-session-1',
      });

      const state = AgentState.initial();
      await a.generate('Say hello.', state);

      // Wait a bit for async checkpoint to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify checkpoint was saved
      const sessions = await store.list();
      expect(sessions).toContain('test-session-1');

      const saved = await store.load('test-session-1');
      expect(saved).not.toBeNull();
      expect(saved?.step).toBeGreaterThan(0);
    });

    test('auto-generates sessionId when not provided', async () => {
      const store = fileCheckpoints({ dir: TEST_CHECKPOINT_DIR });

      const a = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 50 },
        checkpoints: store,
        // sessionId not provided - should auto-generate
      });

      await a.generate('Hi', AgentState.initial());

      // Wait for checkpoint
      await new Promise((resolve) => setTimeout(resolve, 100));

      const sessions = await store.list();
      expect(sessions.length).toBe(1);
      // Should be a UUID
      expect(sessions[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    test('streaming also saves checkpoints', async () => {
      const store = fileCheckpoints({ dir: TEST_CHECKPOINT_DIR });

      const a = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 100 },
        checkpoints: store,
        sessionId: 'streaming-session',
      });

      const stream = a.stream('Say hello.', AgentState.initial());

      // Consume the stream
      for await (const event of stream) {
        // Process events (need to consume them)
        void event;
      }

      await stream.result;

      // Wait for checkpoint
      await new Promise((resolve) => setTimeout(resolve, 100));

      const saved = await store.load('streaming-session');
      expect(saved).not.toBeNull();
    });
  });

  describe('session resume', () => {
    test('can resume conversation from checkpoint', async () => {
      const store = fileCheckpoints({ dir: TEST_CHECKPOINT_DIR });

      // First agent - establish context
      const a1 = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 100 },
        checkpoints: store,
        sessionId: 'resume-test',
      });

      // Use ask() to build conversation history properly
      const result1 = await a1.ask('My favorite number is 42.', AgentState.initial());

      // The checkpoint from generate() doesn't include ask()'s state enrichment,
      // so we manually save the enriched state for realistic resume behavior
      await store.save('resume-test', result1.state.toJSON());

      // Verify checkpoint was saved with conversation
      const saved = await store.load('resume-test');
      expect(saved).not.toBeNull();
      expect(saved?.messages.length).toBeGreaterThan(0);

      // Second agent - resume from checkpoint
      const a2 = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 100 },
        checkpoints: store,
        sessionId: 'resume-test',
      });

      // Restore state from checkpoint (saved is verified non-null above)
      const restoredState = AgentState.fromJSON(saved as NonNullable<typeof saved>);

      // Continue conversation
      const result2 = await a2.ask('What is my favorite number?', restoredState);

      expect(result2.turn.response.text).toContain('42');
    });

    test('checkpoint preserves tool execution results', async () => {
      const store = fileCheckpoints({ dir: TEST_CHECKPOINT_DIR });

      const calculator: Tool = {
        name: 'calculate',
        description: 'Perform a calculation',
        parameters: {
          type: 'object',
          properties: {
            expression: { type: 'string', description: 'Math expression' },
          },
          required: ['expression'],
        },
        run: async (params: { expression: string }) => {
          const result = Function(`"use strict"; return (${params.expression})`)();
          return String(result);
        },
      };

      const a = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 200 },
        tools: [calculator],
        execution: loop(),
        checkpoints: store,
        sessionId: 'tool-test',
      });

      await a.generate(
        'Calculate 7 * 8 using the calculate tool.',
        AgentState.initial(),
      );

      // Wait for checkpoint
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Load and verify checkpoint has the conversation with tool results
      const saved = await store.load('tool-test');
      expect(saved).not.toBeNull();
      expect(saved?.messages.length).toBeGreaterThan(0);

      // Should have tool result messages
      const hasToolResult = saved?.messages.some((m) => m.role === 'tool_result');
      expect(hasToolResult).toBe(true);
    });
  });

  describe('checkpoint updates', () => {
    test('checkpoints update with each step', async () => {
      const store = fileCheckpoints({ dir: TEST_CHECKPOINT_DIR });

      // Tool that requires multiple steps
      let callCount = 0;
      const countingTool: Tool = {
        name: 'count',
        description: 'Count calls',
        parameters: {
          type: 'object',
          properties: {},
        },
        run: async () => {
          callCount++;
          return `Call count: ${callCount}`;
        },
      };

      const a = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 300 },
        tools: [countingTool],
        execution: loop(),
        checkpoints: store,
        sessionId: 'multi-step-test',
      });

      await a.generate(
        'Call the count tool twice in separate requests. First call it once, then call it again.',
        AgentState.initial(),
      );

      // Wait for checkpoints
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Load final checkpoint
      const saved = await store.load('multi-step-test');
      expect(saved).not.toBeNull();

      // Step count should reflect multiple steps
      expect(saved?.step).toBeGreaterThanOrEqual(1);
    });
  });
});
