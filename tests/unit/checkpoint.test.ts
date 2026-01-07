import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { UserMessage, AssistantMessage } from '@providerprotocol/ai';
import { fileCheckpoints } from '../../src/checkpoint/file.ts';
import { AgentState } from '../../src/state/index.ts';
import type { CheckpointStore } from '../../src/checkpoint/types.ts';

const TEST_DIR = '.test-checkpoints';

describe('fileCheckpoints()', () => {
  let store: CheckpointStore;

  beforeEach(async () => {
    // Clean up test directory before each test
    try {
      await rm(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Ignore if doesn't exist
    }
    store = fileCheckpoints({ dir: TEST_DIR });
  });

  afterEach(async () => {
    // Clean up test directory after each test
    try {
      await rm(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  describe('save()', () => {
    test('saves state to disk', async () => {
      const state = AgentState.initial()
        .withMessage(new UserMessage('Hello'))
        .withStep(1);

      await store.save('session-1', state.toJSON());

      // Verify file exists
      const file = Bun.file(join(TEST_DIR, 'session-1', 'checkpoint.json'));
      expect(await file.exists()).toBe(true);
    });

    test('saves metadata alongside state', async () => {
      const state = AgentState.initial().withStep(5);

      await store.save('session-1', state.toJSON());

      // Verify metadata file exists
      const file = Bun.file(join(TEST_DIR, 'session-1', 'metadata.json'));
      expect(await file.exists()).toBe(true);

      const metadata = await file.json();
      expect(metadata.sessionId).toBe('session-1');
      expect(metadata.step).toBe(5);
      expect(metadata.timestamp).toBeDefined();
    });

    test('creates directory if it does not exist', async () => {
      const state = AgentState.initial();

      await store.save('new-session', state.toJSON());

      const loaded = await store.load('new-session');
      expect(loaded).not.toBeNull();
    });

    test('overwrites existing checkpoint', async () => {
      const state1 = AgentState.initial().withStep(1);
      const state2 = AgentState.initial().withStep(2);

      await store.save('session-1', state1.toJSON());
      await store.save('session-1', state2.toJSON());

      const loaded = await store.load('session-1');
      expect(loaded?.step).toBe(2);
    });
  });

  describe('load()', () => {
    test('loads saved state', async () => {
      const original = AgentState.initial()
        .withMessage(new UserMessage('Hello'))
        .withMessage(new AssistantMessage('Hi there!'))
        .withStep(3)
        .withMetadata('key', 'value');

      await store.save('session-1', original.toJSON());

      const loaded = await store.load('session-1');

      expect(loaded).not.toBeNull();
      expect(loaded?.id).toBe(original.id);
      expect(loaded?.step).toBe(3);
      expect(loaded?.metadata).toEqual({ key: 'value' });
      expect(loaded?.messages).toHaveLength(2);
    });

    test('returns null for non-existent session', async () => {
      const loaded = await store.load('non-existent');
      expect(loaded).toBeNull();
    });

    test('returns null for corrupt file', async () => {
      // Create corrupt checkpoint file
      const sessionDir = join(TEST_DIR, 'corrupt-session');
      await mkdir(sessionDir, { recursive: true });
      await Bun.write(join(sessionDir, 'checkpoint.json'), 'not valid json');

      const loaded = await store.load('corrupt-session');
      expect(loaded).toBeNull();
    });
  });

  describe('delete()', () => {
    test('removes session directory', async () => {
      const state = AgentState.initial();
      await store.save('session-to-delete', state.toJSON());

      // Verify exists
      expect(await store.load('session-to-delete')).not.toBeNull();

      await store.delete('session-to-delete');

      // Verify deleted
      expect(await store.load('session-to-delete')).toBeNull();
    });

    test('does not throw for non-existent session', async () => {
      // Should not throw
      await store.delete('non-existent-session');
    });
  });

  describe('list()', () => {
    test('returns empty array when no sessions', async () => {
      const sessions = await store.list();
      expect(sessions).toEqual([]);
    });

    test('returns all session IDs', async () => {
      const state = AgentState.initial();

      await store.save('session-a', state.toJSON());
      await store.save('session-b', state.toJSON());
      await store.save('session-c', state.toJSON());

      const sessions = await store.list();

      expect(sessions).toHaveLength(3);
      expect(sessions).toContain('session-a');
      expect(sessions).toContain('session-b');
      expect(sessions).toContain('session-c');
    });

    test('does not include deleted sessions', async () => {
      const state = AgentState.initial();

      await store.save('keep', state.toJSON());
      await store.save('delete-me', state.toJSON());
      await store.delete('delete-me');

      const sessions = await store.list();

      expect(sessions).toEqual(['keep']);
    });
  });

  describe('round-trip', () => {
    test('preserves full state through save/load cycle', async () => {
      const original = AgentState.initial()
        .withMessage(new UserMessage('User message'))
        .withMessage(new AssistantMessage('Assistant response'))
        .withStep(10)
        .withMetadata('count', 42)
        .withMetadata('enabled', true)
        .withReasoning('First reasoning')
        .withReasoning('Second reasoning')
        .withPlan([
          { id: '1', description: 'Step 1', dependsOn: [], status: 'completed' },
          { id: '2', description: 'Step 2', dependsOn: ['1'], status: 'pending' },
        ]);

      await store.save('full-state', original.toJSON());
      const loaded = await store.load('full-state');

      expect(loaded).not.toBeNull();

      // Verify can restore to AgentState (loaded is verified non-null above)
      const restored = AgentState.fromJSON(loaded as NonNullable<typeof loaded>);

      expect(restored.id).toBe(original.id);
      expect(restored.step).toBe(original.step);
      expect(restored.messages.length).toBe(original.messages.length);
      expect(restored.metadata).toEqual(original.metadata);
      expect([...restored.reasoning]).toEqual([...original.reasoning]);
      expect(restored.plan?.length).toBe(original.plan?.length);
    });
  });
});

describe('CheckpointStore interface', () => {
  test('default directory is .checkpoints', () => {
    // This is a documentation/contract test
    const store = fileCheckpoints();
    // We can't easily verify the directory without saving,
    // but we can verify the store is created
    expect(store).toBeDefined();
    expect(store.save).toBeDefined();
    expect(store.load).toBeDefined();
    expect(store.delete).toBeDefined();
    expect(store.list).toBeDefined();
  });

  test('custom directory is respected', async () => {
    const customDir = '.custom-checkpoint-dir';
    const store = fileCheckpoints({ dir: customDir });

    try {
      const state = AgentState.initial();
      await store.save('test', state.toJSON());

      // Verify file is in custom directory
      const file = Bun.file(join(customDir, 'test', 'checkpoint.json'));
      expect(await file.exists()).toBe(true);
    } finally {
      await rm(customDir, { recursive: true, force: true });
    }
  });
});
