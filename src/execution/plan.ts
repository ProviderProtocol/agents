import type { Turn, StreamEvent } from '@providerprotocol/ai';
import { UserMessage } from '@providerprotocol/ai';
import type { PlanStep } from '../state/index.ts';
import { generateUUID } from '../utils/uuid.ts';
import type {
  ExecutionStrategy,
  ExecutionContext,
  ExecutionResult,
  PlanOptions,
  AgentStreamResult,
  AgentStreamEvent,
} from './types.ts';

const DEFAULT_PLAN_OPTIONS: Required<PlanOptions> = {
  maxPlanSteps: Infinity,
  allowReplan: true,
  planSchema: {
    type: 'object',
    properties: {
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Unique step identifier' },
            description: { type: 'string', description: 'What this step does' },
            tool: { type: 'string', description: 'Tool to use (if applicable)' },
            dependsOn: {
              type: 'array',
              items: { type: 'string' },
              description: 'IDs of steps this depends on',
            },
          },
          required: ['id', 'description', 'dependsOn'],
        },
      },
    },
    required: ['steps'],
  },
};

const PLAN_PROMPT = `Create a detailed execution plan to accomplish the task.
Break it down into clear steps, specifying which tool to use for each step if applicable.
Include dependencies between steps (which steps must complete before others can start).
Return your plan as a JSON object with a "steps" array.`;

/**
 * Create a plan-then-execute strategy.
 *
 * Behavior:
 * 1. Plan: LLM generates structured plan with steps and dependencies
 * 2. Execute: Execute each plan step respecting dependency order
 * 3. Replan: If a step fails and allowReplan is true, generate new plan
 *
 * @param options - Plan configuration options
 * @returns ExecutionStrategy
 */
export function plan(options: PlanOptions = {}): ExecutionStrategy {
  const opts = { ...DEFAULT_PLAN_OPTIONS, ...options };

  return {
    name: 'plan',

    async execute(context: ExecutionContext): Promise<ExecutionResult> {
      const { llm, input, state, strategy, signal } = context;

      // Add input message to state and set agentId in metadata
      // This ensures checkpoints include the full conversation
      let currentState = state
        .withMessage(input)
        .withMetadata('agentId', context.agent.id);
      let step = 0;
      let finalTurn: Turn | undefined;

      // Messages for LLM generation (includes input we just added)
      const messages = [...currentState.messages];

      // PLANNING PHASE
      step++;
      currentState = currentState.withStep(step);

      if (signal?.aborted) {
        throw new Error('Execution aborted');
      }

      strategy.onStepStart?.(step, currentState);

      // Generate the plan
      const planMessages = [
        ...messages,
        new UserMessage(PLAN_PROMPT),
      ];

      const planTurn = await llm.generate(planMessages);

      // Parse the plan from the response
      let planData: { steps: Array<{ id: string; description: string; tool?: string; dependsOn: string[] }> };

      try {
        if (planTurn.data) {
          planData = planTurn.data as typeof planData;
        } else {
          // Try to parse from text
          const jsonMatch = planTurn.response.text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            planData = JSON.parse(jsonMatch[0]) as typeof planData;
          } else {
            throw new Error('Could not parse plan from response');
          }
        }
      } catch (err) {
        throw new Error(`Failed to parse execution plan: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Convert to PlanStep format
      let planSteps: PlanStep[] = planData.steps.map((s) => ({
        id: s.id || generateUUID(),
        description: s.description,
        tool: s.tool,
        dependsOn: s.dependsOn || [],
        status: 'pending' as const,
      }));

      // Apply maxPlanSteps limit
      if (opts.maxPlanSteps !== Infinity && planSteps.length > opts.maxPlanSteps) {
        planSteps = planSteps.slice(0, opts.maxPlanSteps);
      }

      currentState = currentState.withPlan(planSteps);
      messages.push(...planTurn.messages);

      strategy.onStepEnd?.(step, { turn: planTurn, state: currentState });

      // EXECUTION PHASE
      const completedSteps = new Set<string>();

      // Execute steps in topological order
      while (planSteps.some((s) => s.status === 'pending')) {
        // Find next executable step (all dependencies completed)
        const nextStep = planSteps.find(
          (s) => s.status === 'pending'
            && s.dependsOn.every((depId) => completedSteps.has(depId)),
        );

        if (!nextStep) {
          // No step can be executed - either done or cyclic dependency
          break;
        }

        step++;
        currentState = currentState.withStep(step);

        if (signal?.aborted) {
          throw new Error('Execution aborted');
        }

        strategy.onStepStart?.(step, currentState);

        // Update step status to in_progress
        nextStep.status = 'in_progress';
        currentState = currentState.withPlan([...planSteps]);

        // Execute the step
        const stepPrompt = new UserMessage(
          `Execute step "${nextStep.id}": ${nextStep.description}${nextStep.tool ? ` using the ${nextStep.tool} tool` : ''}`,
        );
        messages.push(stepPrompt);

        try {
          const stepTurn = await llm.generate(messages);
          finalTurn = stepTurn;

          messages.push(...stepTurn.messages);
          currentState = currentState.withMessages(stepTurn.messages);

          if (stepTurn.response.hasToolCalls) {
            strategy.onAct?.(step, stepTurn.response.toolCalls ?? []);
          }

          if (stepTurn.toolExecutions && stepTurn.toolExecutions.length > 0) {
            strategy.onObserve?.(step, stepTurn.toolExecutions);
          }

          // Mark step as completed
          nextStep.status = 'completed';
          completedSteps.add(nextStep.id);
          currentState = currentState.withPlan([...planSteps]);

          strategy.onStepEnd?.(step, { turn: stepTurn, state: currentState });
        } catch (err) {
          nextStep.status = 'failed';
          currentState = currentState.withPlan([...planSteps]);

          if (opts.allowReplan) {
            // Could implement replanning here
            // For now, just continue and let the error propagate
          }

          throw err;
        }

        // Check stop condition
        const shouldStop = await strategy.stopCondition?.(currentState);
        if (shouldStop) {
          break;
        }
      }

      if (!finalTurn) {
        finalTurn = planTurn; // Use plan turn if no execution happened
      }

      // Include sessionId in state metadata if checkpointing is enabled
      let finalState = currentState;
      if (context.sessionId) {
        finalState = currentState.withMetadata('sessionId', context.sessionId);
      }

      const result: ExecutionResult = {
        turn: finalTurn,
        state: finalState,
      };

      strategy.onComplete?.(result);

      return result;
    },

    stream(context: ExecutionContext): AgentStreamResult {
      const { llm, input, state, strategy, signal } = context;
      const agentId = context.agent.id;

      let aborted = false;
      const abortController = new AbortController();

      if (signal) {
        signal.addEventListener('abort', () => abortController.abort());
      }

      let resolveResult: (result: ExecutionResult) => void;
      let rejectResult: (error: Error) => void;

      const resultPromise = new Promise<ExecutionResult>((resolve, reject) => {
        resolveResult = resolve;
        rejectResult = reject;
      });

      async function* generateEvents(): AsyncGenerator<AgentStreamEvent> {
        // Add input message to state and set agentId in metadata
        // This ensures checkpoints include the full conversation
        let currentState = state
          .withMessage(input)
          .withMetadata('agentId', context.agent.id);
        let step = 0;
        let finalTurn: Turn | undefined;

        // Messages for LLM generation (includes input we just added)
        const messages = [...currentState.messages];

        try {
          // PLANNING PHASE
          step++;
          currentState = currentState.withStep(step);

          if (abortController.signal.aborted) {
            throw new Error('Execution aborted');
          }

          strategy.onStepStart?.(step, currentState);

          yield {
            source: 'uap',
            uap: {
              type: 'step_start',
              step,
              agentId,
              data: { phase: 'planning' },
            },
          };

          const planMessages = [
            ...messages,
            new UserMessage(PLAN_PROMPT),
          ];

          const planStream = llm.stream(planMessages);

          for await (const event of planStream as AsyncIterable<StreamEvent>) {
            if (abortController.signal.aborted) {
              throw new Error('Execution aborted');
            }

            yield { source: 'upp', upp: event };
          }

          const planTurn = await planStream.turn;

          let planData: { steps: Array<{ id: string; description: string; tool?: string; dependsOn: string[] }> };

          try {
            if (planTurn.data) {
              planData = planTurn.data as typeof planData;
            } else {
              const jsonMatch = planTurn.response.text.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                planData = JSON.parse(jsonMatch[0]) as typeof planData;
              } else {
                throw new Error('Could not parse plan from response');
              }
            }
          } catch (err) {
            throw new Error(`Failed to parse execution plan: ${err instanceof Error ? err.message : String(err)}`);
          }

          let planSteps: PlanStep[] = planData.steps.map((s) => ({
            id: s.id || generateUUID(),
            description: s.description,
            tool: s.tool,
            dependsOn: s.dependsOn || [],
            status: 'pending' as const,
          }));

          if (opts.maxPlanSteps !== Infinity && planSteps.length > opts.maxPlanSteps) {
            planSteps = planSteps.slice(0, opts.maxPlanSteps);
          }

          currentState = currentState.withPlan(planSteps);
          messages.push(...planTurn.messages);

          yield {
            source: 'uap',
            uap: {
              type: 'plan_created',
              step,
              agentId,
              data: { plan: planSteps },
            },
          };

          strategy.onStepEnd?.(step, { turn: planTurn, state: currentState });

          yield {
            source: 'uap',
            uap: {
              type: 'step_end',
              step,
              agentId,
              data: { phase: 'planning' },
            },
          };

          // EXECUTION PHASE
          const completedSteps = new Set<string>();

          while (planSteps.some((s) => s.status === 'pending') && !aborted) {
            const nextStep = planSteps.find(
              (s) => s.status === 'pending'
                && s.dependsOn.every((depId) => completedSteps.has(depId)),
            );

            if (!nextStep) {
              break;
            }

            step++;
            currentState = currentState.withStep(step);

            if (abortController.signal.aborted) {
              throw new Error('Execution aborted');
            }

            strategy.onStepStart?.(step, currentState);

            yield {
              source: 'uap',
              uap: {
                type: 'plan_step_start',
                step,
                agentId,
                data: { planStep: nextStep },
              },
            };

            nextStep.status = 'in_progress';
            currentState = currentState.withPlan([...planSteps]);

            const stepPrompt = new UserMessage(
              `Execute step "${nextStep.id}": ${nextStep.description}${nextStep.tool ? ` using the ${nextStep.tool} tool` : ''}`,
            );
            messages.push(stepPrompt);

            const stepStream = llm.stream(messages);

            for await (const event of stepStream as AsyncIterable<StreamEvent>) {
              if (abortController.signal.aborted) {
                throw new Error('Execution aborted');
              }

              yield { source: 'upp', upp: event };
            }

            const stepTurn = await stepStream.turn;
            finalTurn = stepTurn;

            messages.push(...stepTurn.messages);
            currentState = currentState.withMessages(stepTurn.messages);

            if (stepTurn.response.hasToolCalls) {
              strategy.onAct?.(step, stepTurn.response.toolCalls ?? []);

              yield {
                source: 'uap',
                uap: {
                  type: 'action',
                  step,
                  agentId,
                  data: { toolCalls: stepTurn.response.toolCalls },
                },
              };
            }

            if (stepTurn.toolExecutions && stepTurn.toolExecutions.length > 0) {
              strategy.onObserve?.(step, stepTurn.toolExecutions);

              yield {
                source: 'uap',
                uap: {
                  type: 'observation',
                  step,
                  agentId,
                  data: { observations: stepTurn.toolExecutions },
                },
              };
            }

            nextStep.status = 'completed';
            completedSteps.add(nextStep.id);
            currentState = currentState.withPlan([...planSteps]);

            strategy.onStepEnd?.(step, { turn: stepTurn, state: currentState });

            yield {
              source: 'uap',
              uap: {
                type: 'plan_step_end',
                step,
                agentId,
                data: { planStep: nextStep },
              },
            };

            const shouldStop = await strategy.stopCondition?.(currentState);
            if (shouldStop) {
              break;
            }
          }

          if (!finalTurn) {
            finalTurn = planTurn;
          }

          // Include sessionId in state metadata if checkpointing is enabled
          let finalState = currentState;
          if (context.sessionId) {
            finalState = currentState.withMetadata('sessionId', context.sessionId);
          }

          const result: ExecutionResult = {
            turn: finalTurn,
            state: finalState,
          };

          strategy.onComplete?.(result);
          resolveResult(result);
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          strategy.onError?.(err, currentState);
          rejectResult(err);
          throw err;
        }
      }

      const iterator = generateEvents();

      return {
        [Symbol.asyncIterator]() {
          return iterator;
        },
        result: resultPromise,
        abort() {
          aborted = true;
          abortController.abort();
        },
      };
    },
  };
}
