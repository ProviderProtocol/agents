import type { Turn, StreamEvent } from '@providerprotocol/ai';
import type {
  ExecutionStrategy,
  ExecutionContext,
  ExecutionResult,
  LoopOptions,
  AgentStreamResult,
  AgentStreamEvent,
} from './types.ts';

/**
 * Default configuration for the loop strategy.
 * @internal
 */
const DEFAULT_LOOP_OPTIONS: Required<LoopOptions> = {
  maxIterations: Infinity,
};

/**
 * Creates a loop execution strategy for agent execution.
 *
 * The loop strategy is the simplest execution pattern, equivalent to UPP's
 * native tool loop behavior. It follows this cycle:
 *
 * 1. Send input to LLM
 * 2. If response has tool calls, execute tools and loop
 * 3. Continue until no tool calls or maxIterations reached
 * 4. Return final response as UPP Turn
 *
 * This strategy is ideal for straightforward tool-use scenarios where the
 * model naturally knows when to stop calling tools.
 *
 * @param options - Configuration options for the loop strategy
 * @returns An ExecutionStrategy instance implementing the loop pattern
 *
 * @example
 * ```typescript
 * import { createAgent, loop } from '@providerprotocol/agents';
 *
 * // Basic usage with default settings (unlimited iterations)
 * const agent = createAgent({
 *   llm: myLLM,
 *   tools: [weatherTool, searchTool],
 *   strategy: loop(),
 * });
 *
 * // With iteration limit
 * const limitedAgent = createAgent({
 *   llm: myLLM,
 *   tools: [weatherTool],
 *   strategy: loop({ maxIterations: 5 }),
 * });
 *
 * // Execute
 * const result = await agent.generate('What is the weather in Tokyo?');
 * console.log(result.turn.response.text);
 * ```
 *
 * @see {@link react} for reasoning-enhanced execution
 * @see {@link plan} for structured multi-step execution
 */
export function loop(options: LoopOptions = {}): ExecutionStrategy {
  const opts = { ...DEFAULT_LOOP_OPTIONS, ...options };

  return {
    name: 'loop',

    /**
     * Executes the loop strategy synchronously (non-streaming).
     *
     * Processes the input through the LLM, executing any tool calls
     * in a loop until no more tools are requested or maxIterations
     * is reached. Checkpoints are saved after each step if configured.
     *
     * @param context - The execution context containing LLM, state, tools, etc.
     * @returns Promise resolving to the execution result with final turn and state
     * @throws {Error} When execution is aborted via signal
     * @throws {Error} When no turn is generated (should never happen in normal operation)
     */
    async execute(context: ExecutionContext): Promise<ExecutionResult> {
      const { llm, input, state, strategy, signal } = context;

      let currentState = state
        .withMessage(input)
        .withMetadata('agentId', context.agent.id);
      let iteration = 0;
      let finalTurn: Turn | undefined;

      const inputMessages = [...currentState.messages];

      while (true) {
        iteration++;
        currentState = currentState.withStep(iteration);

        if (signal?.aborted) {
          throw new Error('Execution aborted');
        }

        strategy.onStepStart?.(iteration, currentState);

        const turn = await llm.generate(inputMessages);
        finalTurn = turn;

        currentState = currentState.withMessages(turn.messages);

        if (turn.response.hasToolCalls) {
          strategy.onAct?.(iteration, turn.response.toolCalls ?? []);
        }

        if (turn.toolExecutions && turn.toolExecutions.length > 0) {
          strategy.onObserve?.(iteration, turn.toolExecutions);
        }

        strategy.onStepEnd?.(iteration, { turn, state: currentState });

        if (context.checkpoints && context.sessionId) {
          context.checkpoints.save(context.sessionId, currentState.toJSON()).catch((err) => {
            console.error('[UAP] Checkpoint save failed:', err);
          });
        }

        const shouldStop = await strategy.stopCondition?.(currentState);
        if (shouldStop) {
          break;
        }

        if (!turn.response.hasToolCalls) {
          break;
        }

        if (opts.maxIterations !== Infinity && iteration >= opts.maxIterations) {
          break;
        }

        inputMessages.length = 0;
        inputMessages.push(...currentState.messages);
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
     * Executes the loop strategy with streaming support.
     *
     * Returns an AgentStreamResult that emits both UAP-level events
     * (step_start, step_end, action, observation) and UPP-level events
     * (text_delta, tool_call_delta, etc.) as the execution progresses.
     *
     * @param context - The execution context containing LLM, state, tools, etc.
     * @returns AgentStreamResult for async iteration over events and final result
     *
     * @example
     * ```typescript
     * const stream = agent.stream('What is the weather?');
     *
     * for await (const event of stream) {
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
       * Async generator that yields stream events during execution.
       * @internal
       */
      async function* generateEvents(): AsyncGenerator<AgentStreamEvent> {
        let currentState = state
          .withMessage(input)
          .withMetadata('agentId', context.agent.id);
        let iteration = 0;
        let finalTurn: Turn | undefined;

        const inputMessages = [...currentState.messages];

        try {
          while (!aborted) {
            iteration++;
            currentState = currentState.withStep(iteration);

            if (abortController.signal.aborted) {
              throw new Error('Execution aborted');
            }

            strategy.onStepStart?.(iteration, currentState);

            yield {
              source: 'uap',
              uap: {
                type: 'step_start',
                step: iteration,
                agentId,
                data: { iteration },
              },
            };

            const streamResult = llm.stream(inputMessages);

            for await (const event of streamResult as AsyncIterable<StreamEvent>) {
              if (abortController.signal.aborted) {
                throw new Error('Execution aborted');
              }

              yield {
                source: 'upp',
                upp: event,
              };
            }

            const turn = await streamResult.turn;
            finalTurn = turn;

            currentState = currentState.withMessages(turn.messages);

            if (turn.response.hasToolCalls) {
              strategy.onAct?.(iteration, turn.response.toolCalls ?? []);

              yield {
                source: 'uap',
                uap: {
                  type: 'action',
                  step: iteration,
                  agentId,
                  data: { toolCalls: turn.response.toolCalls },
                },
              };
            }

            if (turn.toolExecutions && turn.toolExecutions.length > 0) {
              strategy.onObserve?.(iteration, turn.toolExecutions);

              yield {
                source: 'uap',
                uap: {
                  type: 'observation',
                  step: iteration,
                  agentId,
                  data: { observations: turn.toolExecutions },
                },
              };
            }

            strategy.onStepEnd?.(iteration, { turn, state: currentState });

            if (context.checkpoints && context.sessionId) {
              context.checkpoints.save(context.sessionId, currentState.toJSON()).catch((err) => {
                console.error('[UAP] Checkpoint save failed:', err);
              });
            }

            yield {
              source: 'uap',
              uap: {
                type: 'step_end',
                step: iteration,
                agentId,
                data: { iteration },
              },
            };

            const shouldStop = await strategy.stopCondition?.(currentState);
            if (shouldStop) {
              break;
            }

            if (!turn.response.hasToolCalls) {
              break;
            }

            if (opts.maxIterations !== Infinity && iteration >= opts.maxIterations) {
              break;
            }

            inputMessages.length = 0;
            inputMessages.push(...currentState.messages);
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
