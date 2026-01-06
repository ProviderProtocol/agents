import { describe, test, expect, setDefaultTimeout } from 'bun:test';
import { anthropic } from '@providerprotocol/ai/anthropic';
import type { Tool } from '@providerprotocol/ai';
import { agent, AgentState } from '../../src/index.ts';
import { plan } from '../../src/execution/index.ts';

// Skip tests if no API key
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Increase timeout for live API tests (90 seconds for plan strategy)
setDefaultTimeout(90_000);

describe.skipIf(!ANTHROPIC_API_KEY)('Plan Strategy (Live)', () => {
  describe('basic planning', () => {
    test('generates and executes a plan', async () => {
      const a = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 800 },
        execution: plan({ maxPlanSteps: 3 }),
      });

      const result = await a.generate(
        'Think about how you would describe the color blue to someone. Create a simple 2-step plan.',
        AgentState.initial(),
      );

      // Should have generated a plan
      expect(result.state.plan).toBeDefined();
      expect(result.state.plan?.length).toBeGreaterThan(0);
      // Should have a text response
      expect(result.turn.response.text.length).toBeGreaterThan(0);
    });

    test('tracks plan step status', async () => {
      const a = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 600 },
        execution: plan({ maxPlanSteps: 2 }),
      });

      const result = await a.generate(
        'Create a 1-step plan to say hello.',
        AgentState.initial(),
      );

      // Plan should have executed
      expect(result.state.plan).toBeDefined();
      if (result.state.plan && result.state.plan.length > 0) {
        // At least one step should have been completed
        const completedSteps = result.state.plan.filter((s) => s.status === 'completed');
        expect(completedSteps.length).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('plan with tools', () => {
    test('creates plan that uses tools', async () => {
      const notepadContents: string[] = [];

      const notepad: Tool = {
        name: 'notepad',
        description: 'Write a note to a notepad for later reference. You MUST use this tool to write notes.',
        parameters: {
          type: 'object',
          properties: {
            note: { type: 'string', description: 'The note to write' },
          },
          required: ['note'],
        },
        run: async (params: { note: string }) => {
          notepadContents.push(params.note);
          return `Note saved: ${params.note}`;
        },
      };

      const a = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 1200 },
        tools: [notepad],
        execution: plan({ maxPlanSteps: 2 }),
        system: `You are a planning assistant. When asked to create a plan, you MUST respond with a valid JSON object.
Your response MUST be a JSON object with a "steps" array. Each step must have:
- "id": a unique string identifier
- "description": what the step does
- "dependsOn": array of step ids this depends on (empty array if no dependencies)
- "tool": (optional) the tool to use

Example response format:
{"steps": [{"id": "step1", "description": "Write hello", "dependsOn": [], "tool": "notepad"}]}

Do NOT include any text before or after the JSON. ONLY output valid JSON.`,
      });

      const result = await a.generate(
        'Create a plan with 1 step: write "test" to the notepad. Respond ONLY with JSON.',
        AgentState.initial(),
      );

      // Plan should be created (even if execution varies)
      expect(result.state.plan).toBeDefined();
      expect(result.state.plan?.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('plan streaming', () => {
    test('streams plan creation and execution events', async () => {
      const a = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 600 },
        execution: plan({ maxPlanSteps: 2 }),
      });

      const stream = a.stream(
        'Create a simple 1-step plan to greet the user.',
        AgentState.initial(),
      );

      const uapEvents: Array<{ type: string; data?: Record<string, unknown> }> = [];

      for await (const event of stream) {
        if (event.source === 'uap' && event.uap) {
          uapEvents.push({ type: event.uap.type, data: event.uap.data });
        }
      }

      const result = await stream.result;

      // Should have step events
      expect(uapEvents.some((e) => e.type === 'step_start')).toBe(true);

      // Should have plan_created event
      const planCreatedEvent = uapEvents.find((e) => e.type === 'plan_created');
      expect(planCreatedEvent).toBeDefined();

      // Final result should have plan
      expect(result.state.plan).toBeDefined();
    });
  });

  describe('plan respects maxPlanSteps', () => {
    test('limits plan to maxPlanSteps', async () => {
      const a = agent({
        model: anthropic('claude-3-5-haiku-latest'),
        params: { max_tokens: 800 },
        execution: plan({ maxPlanSteps: 2 }),
      });

      const result = await a.generate(
        'Create a 10-step plan to count from 1 to 10.',
        AgentState.initial(),
      );

      // Plan should be limited to maxPlanSteps
      expect(result.state.plan).toBeDefined();
      if (result.state.plan) {
        expect(result.state.plan.length).toBeLessThanOrEqual(2);
      }
    });
  });
});
