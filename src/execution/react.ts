import type { Turn, StreamEvent } from '@providerprotocol/ai';
import { UserMessage } from '@providerprotocol/ai';
import type {
  ExecutionStrategy,
  ExecutionContext,
  ExecutionResult,
  ReactOptions,
  AgentStreamResult,
  AgentStreamEvent,
} from './types.ts';

/**
 * Default configuration for the ReAct strategy.
 * @internal
 */
const DEFAULT_REACT_OPTIONS: Required<ReactOptions> = {
  maxSteps: Infinity,
  reasoningPrompt: 'Think step by step about what you need to do next. Consider the current state, what tools are available, and what action would be most helpful.',
};

/**
 * Creates a ReAct (Reason-Act-Observe) execution strategy for agent execution.
 *
 * The ReAct strategy implements the Reason-Act-Observe pattern from the paper
 * "ReAct: Synergizing Reasoning and Acting in Language Models". It adds an
 * explicit reasoning phase before each action, which improves the model's
 * decision-making by encouraging step-by-step thinking.
 *
 * The execution cycle is:
 * 1. **Reason**: LLM outputs reasoning about what to do next
 * 2. **Act**: LLM selects and executes tool(s) based on reasoning
 * 3. **Observe**: Tool results are formatted as observations
 * 4. **Repeat**: Continue until stop condition, no more actions, or maxSteps
 *
 * This strategy is ideal for complex tasks requiring careful deliberation
 * and multi-step reasoning.
 *
 * @param options - Configuration options for the ReAct strategy
 * @returns An ExecutionStrategy instance implementing the ReAct pattern
 *
 * @example
 * ```typescript
 * import { createAgent, react } from '@providerprotocol/agents';
 *
 * // Basic ReAct agent
 * const agent = createAgent({
 *   llm: myLLM,
 *   tools: [searchTool, calculatorTool],
 *   strategy: react(),
 * });
 *
 * // With custom reasoning prompt and step limit
 * const customAgent = createAgent({
 *   llm: myLLM,
 *   tools: [searchTool],
 *   strategy: react({
 *     maxSteps: 10,
 *     reasoningPrompt: 'Analyze the situation and determine the best action.',
 *   }),
 * });
 *
 * // With lifecycle hooks for observability
 * const observableAgent = createAgent({
 *   llm: myLLM,
 *   tools: [searchTool],
 *   strategy: react({ maxSteps: 5 }),
 *   hooks: {
 *     onReason: (step, reasoning) => console.log(`Step ${step} reasoning:`, reasoning),
 *     onAct: (step, actions) => console.log(`Step ${step} actions:`, actions),
 *   },
 * });
 * ```
 *
 * @see https://arxiv.org/abs/2210.03629 - ReAct: Synergizing Reasoning and Acting
 * @see {@link loop} for simpler tool-loop execution
 * @see {@link plan} for structured multi-step execution
 */
export function react(options: ReactOptions = {}): ExecutionStrategy {
  const opts = { ...DEFAULT_REACT_OPTIONS, ...options };

  return {
    name: 'react',

    /**
     * Executes the ReAct strategy synchronously (non-streaming).
     *
     * Alternates between reasoning and action phases, with the model
     * first thinking about what to do, then taking action. Tool results
     * become observations for the next reasoning phase.
     *
     * @param context - The execution context containing LLM, state, tools, etc.
     * @returns Promise resolving to the execution result with final turn and state
     * @throws {Error} When execution is aborted via signal
     * @throws {Error} When no turn is generated
     */
    async execute(context: ExecutionContext): Promise<ExecutionResult> {
      const { llm, input, state, strategy, signal } = context;

      let currentState = state
        .withMessage(input)
        .withMetadata('agentId', context.agent.id);
      let step = 0;
      let finalTurn: Turn | undefined;

      const messages = [...currentState.messages];

      while (true) {
        step++;
        currentState = currentState.withStep(step);

        if (signal?.aborted) {
          throw new Error('Execution aborted');
        }

        strategy.onStepStart?.(step, currentState);

        // REASON PHASE: Ask LLM to think about what to do
        const reasoningMessages = [
          ...messages,
          new UserMessage(opts.reasoningPrompt),
        ];

        const reasoningTurn = await llm.generate(reasoningMessages);

        const reasoning = reasoningTurn.response.text;
        currentState = currentState.withReasoning(reasoning);
        strategy.onReason?.(step, reasoning);

        messages.push(...reasoningTurn.messages);

        // ACT PHASE: Execute with tools
        const actionPrompt = new UserMessage(
          'Based on your reasoning, take the appropriate action. Use tools if needed, or provide a final answer.',
        );
        messages.push(actionPrompt);

        const actionTurn = await llm.generate(messages);
        finalTurn = actionTurn;

        messages.push(...actionTurn.messages);
        currentState = currentState.withMessages(actionTurn.messages);

        if (actionTurn.response.hasToolCalls) {
          strategy.onAct?.(step, actionTurn.response.toolCalls ?? []);
        }

        // OBSERVE PHASE: Process tool results
        if (actionTurn.toolExecutions && actionTurn.toolExecutions.length > 0) {
          strategy.onObserve?.(step, actionTurn.toolExecutions);
        }

        strategy.onStepEnd?.(step, { turn: actionTurn, state: currentState });

        const shouldStop = await strategy.stopCondition?.(currentState);
        if (shouldStop) {
          break;
        }

        if (!actionTurn.response.hasToolCalls) {
          break;
        }

        if (opts.maxSteps !== Infinity && step >= opts.maxSteps) {
          break;
        }
      }

      if (!finalTurn) {
        throw new Error('No turn generated');
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
     * Executes the ReAct strategy with streaming support.
     *
     * Streams both the reasoning and action phases, emitting UAP-level
     * events (step_start, reasoning, action, observation, step_end) and
     * UPP-level events (text_delta, etc.) as execution progresses.
     *
     * @param context - The execution context containing LLM, state, tools, etc.
     * @returns AgentStreamResult for async iteration over events and final result
     *
     * @example
     * ```typescript
     * const stream = agent.stream('Research quantum computing');
     *
     * for await (const event of stream) {
     *   if (event.source === 'uap' && event.uap?.type === 'reasoning') {
     *     console.log('Reasoning:', event.uap.data.reasoning);
     *   }
     *   if (event.source === 'upp' && event.upp?.type === 'text_delta') {
     *     process.stdout.write(event.upp.delta.text ?? '');
     *   }
     * }
     *
     * const result = await stream.result;
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
       * Async generator that yields stream events during ReAct execution.
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
          while (!aborted) {
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
                data: { phase: 'reasoning' },
              },
            };

            // REASON PHASE - Stream the reasoning
            const reasoningMessages = [
              ...messages,
              new UserMessage(opts.reasoningPrompt),
            ];

            const reasoningStream = llm.stream(reasoningMessages);
            let reasoningText = '';

            for await (const event of reasoningStream as AsyncIterable<StreamEvent>) {
              if (abortController.signal.aborted) {
                throw new Error('Execution aborted');
              }

              yield { source: 'upp', upp: event };

              if (event.type === 'text_delta' && event.delta.text) {
                reasoningText += event.delta.text;
              }
            }

            const reasoningTurn = await reasoningStream.turn;
            currentState = currentState.withReasoning(reasoningText || reasoningTurn.response.text);
            strategy.onReason?.(step, reasoningText || reasoningTurn.response.text);

            yield {
              source: 'uap',
              uap: {
                type: 'reasoning',
                step,
                agentId,
                data: { reasoning: reasoningText || reasoningTurn.response.text },
              },
            };

            messages.push(...reasoningTurn.messages);

            // ACT PHASE - Stream the action
            const actionPrompt = new UserMessage(
              'Based on your reasoning, take the appropriate action. Use tools if needed, or provide a final answer.',
            );
            messages.push(actionPrompt);

            const actionStream = llm.stream(messages);

            for await (const event of actionStream as AsyncIterable<StreamEvent>) {
              if (abortController.signal.aborted) {
                throw new Error('Execution aborted');
              }

              yield { source: 'upp', upp: event };
            }

            const actionTurn = await actionStream.turn;
            finalTurn = actionTurn;

            messages.push(...actionTurn.messages);
            currentState = currentState.withMessages(actionTurn.messages);

            if (actionTurn.response.hasToolCalls) {
              strategy.onAct?.(step, actionTurn.response.toolCalls ?? []);

              yield {
                source: 'uap',
                uap: {
                  type: 'action',
                  step,
                  agentId,
                  data: { toolCalls: actionTurn.response.toolCalls },
                },
              };
            }

            if (actionTurn.toolExecutions && actionTurn.toolExecutions.length > 0) {
              strategy.onObserve?.(step, actionTurn.toolExecutions);

              yield {
                source: 'uap',
                uap: {
                  type: 'observation',
                  step,
                  agentId,
                  data: { observations: actionTurn.toolExecutions },
                },
              };
            }

            strategy.onStepEnd?.(step, { turn: actionTurn, state: currentState });

            yield {
              source: 'uap',
              uap: {
                type: 'step_end',
                step,
                agentId,
                data: { phase: 'complete' },
              },
            };

            const shouldStop = await strategy.stopCondition?.(currentState);
            if (shouldStop) {
              break;
            }

            if (!actionTurn.response.hasToolCalls) {
              break;
            }

            if (opts.maxSteps !== Infinity && step >= opts.maxSteps) {
              break;
            }
          }

          if (!finalTurn) {
            throw new Error('No turn generated');
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
