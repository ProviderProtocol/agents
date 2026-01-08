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

/**
 * Default configuration for the plan strategy.
 * @internal
 */
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

/**
 * System prompt used to request plan generation from the LLM.
 * @internal
 */
const PLAN_PROMPT = `Create a detailed execution plan to accomplish the task.
Break it down into clear steps, specifying which tool to use for each step if applicable.
Include dependencies between steps (which steps must complete before others can start).
Return your plan as a JSON object with a "steps" array.`;

/**
 * Creates a plan-then-execute strategy for agent execution.
 *
 * The plan strategy implements a two-phase approach:
 * 1. **Planning Phase**: LLM generates a structured plan with steps and dependencies
 * 2. **Execution Phase**: Execute each plan step in topological order respecting dependencies
 *
 * If a step fails and `allowReplan` is true, the strategy can generate a new plan
 * to recover from the failure (replanning is not yet fully implemented).
 *
 * This strategy is ideal for complex multi-step tasks where the execution order
 * matters and steps may have dependencies on each other.
 *
 * @param options - Configuration options for the plan strategy
 * @returns An ExecutionStrategy instance implementing the plan-then-execute pattern
 *
 * @example
 * ```typescript
 * import { createAgent, plan } from '@providerprotocol/agents';
 *
 * // Basic plan-based agent
 * const agent = createAgent({
 *   llm: myLLM,
 *   tools: [readFileTool, writeFileTool, searchTool],
 *   strategy: plan(),
 * });
 *
 * // With step limit and replanning
 * const robustAgent = createAgent({
 *   llm: myLLM,
 *   tools: [apiTool, dbTool],
 *   strategy: plan({
 *     maxPlanSteps: 10,
 *     allowReplan: true,
 *   }),
 * });
 *
 * // Execute a complex task
 * const result = await agent.generate(
 *   'Read config.json, update the version, and write it back'
 * );
 * console.log(result.state.plan); // Shows executed plan steps
 * ```
 *
 * @see {@link loop} for simpler tool-loop execution
 * @see {@link react} for reasoning-enhanced execution
 */
export function plan(options: PlanOptions = {}): ExecutionStrategy {
  const opts = { ...DEFAULT_PLAN_OPTIONS, ...options };

  return {
    name: 'plan',

    /**
     * Executes the plan strategy synchronously (non-streaming).
     *
     * First generates a structured plan from the LLM, then executes each
     * step in topological order (respecting dependencies). Steps are
     * executed sequentially, with each step's status tracked in state.
     *
     * @param context - The execution context containing LLM, state, tools, etc.
     * @returns Promise resolving to the execution result with final turn and state
     * @throws {Error} When execution is aborted via signal
     * @throws {Error} When plan cannot be parsed from LLM response
     * @throws {Error} When a plan step fails (unless allowReplan handles it)
     */
    async execute(context: ExecutionContext): Promise<ExecutionResult> {
      const { llm, input, state, strategy, signal } = context;

      let currentState = state
        .withMessage(input)
        .withMetadata('agentId', context.agent.id);
      let step = 0;
      let finalTurn: Turn | undefined;

      const messages = [...currentState.messages];

      // PLANNING PHASE: Generate structured plan
      step++;
      currentState = currentState.withStep(step);

      if (signal?.aborted) {
        throw new Error('Execution aborted');
      }

      strategy.onStepStart?.(step, currentState);

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

      // Convert to PlanStep format and apply limits
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

      strategy.onStepEnd?.(step, { turn: planTurn, state: currentState });

      // EXECUTION PHASE: Execute steps in topological order
      const completedSteps = new Set<string>();

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
            // Replanning could be implemented here
          }

          throw err;
        }

        const shouldStop = await strategy.stopCondition?.(currentState);
        if (shouldStop) {
          break;
        }
      }

      if (!finalTurn) {
        finalTurn = planTurn;
      }

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

    /**
     * Executes the plan strategy with streaming support.
     *
     * Streams both the planning and execution phases, emitting UAP-level
     * events (plan_created, plan_step_start, plan_step_end, action, observation)
     * and UPP-level events (text_delta, etc.) as execution progresses.
     *
     * @param context - The execution context containing LLM, state, tools, etc.
     * @returns AgentStreamResult for async iteration over events and final result
     *
     * @example
     * ```typescript
     * const stream = agent.stream('Organize the project files');
     *
     * for await (const event of stream) {
     *   if (event.source === 'uap') {
     *     if (event.uap?.type === 'plan_created') {
     *       console.log('Plan:', event.uap.data.plan);
     *     } else if (event.uap?.type === 'plan_step_start') {
     *       console.log('Starting step:', event.uap.data.planStep);
     *     }
     *   }
     *   if (event.source === 'upp' && event.upp?.type === 'text_delta') {
     *     process.stdout.write(event.upp.delta.text ?? '');
     *   }
     * }
     *
     * const result = await stream.result;
     * console.log('Final plan:', result.state.plan);
     * ```
     */
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

      /**
       * Async generator that yields stream events during plan execution.
       * @internal
       */
      async function* generateEvents(): AsyncGenerator<AgentStreamEvent> {
        let currentState = state
          .withMessage(input)
          .withMetadata('agentId', context.agent.id);
        let step = 0;
        let finalTurn: Turn | undefined;

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
