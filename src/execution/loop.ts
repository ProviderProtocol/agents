import type { Turn, StreamEvent } from '@providerprotocol/ai';
import type {
  ExecutionStrategy,
  ExecutionContext,
  ExecutionResult,
  LoopOptions,
  AgentStreamResult,
  AgentStreamEvent,
} from './types.ts';

const DEFAULT_LOOP_OPTIONS: Required<LoopOptions> = {
  maxIterations: Infinity,
};

/**
 * Create a loop execution strategy.
 * The simplest strategy - equivalent to UPP's tool loop behavior.
 *
 * Behavior:
 * 1. Send input to LLM
 * 2. If response has tool calls, execute tools and loop
 * 3. Continue until no tool calls or maxIterations reached
 * 4. Return final response as UPP Turn
 *
 * @param options - Loop configuration options
 * @returns ExecutionStrategy
 */
export function loop(options: LoopOptions = {}): ExecutionStrategy {
  const opts = { ...DEFAULT_LOOP_OPTIONS, ...options };

  return {
    name: 'loop',

    async execute(context: ExecutionContext): Promise<ExecutionResult> {
      const { llm, input, state, strategy, signal } = context;

      // Add input message to state and set agentId in metadata
      // This ensures checkpoints include the full conversation
      let currentState = state
        .withMessage(input)
        .withMetadata('agentId', context.agent.id);
      let iteration = 0;
      let finalTurn: Turn | undefined;

      // Messages for LLM generation (includes input we just added)
      const inputMessages = [...currentState.messages];

      while (true) {
        iteration++;
        currentState = currentState.withStep(iteration);

        // Check abort signal
        if (signal?.aborted) {
          throw new Error('Execution aborted');
        }

        // Call strategy hooks
        strategy.onStepStart?.(iteration, currentState);

        // Generate response - llm.generate uses rest params, pass messages array
        const turn = await llm.generate(inputMessages);
        finalTurn = turn;

        // Update state with messages from this turn
        currentState = currentState.withMessages(turn.messages);

        // Call action hook if there were tool calls
        if (turn.response.hasToolCalls) {
          strategy.onAct?.(iteration, turn.response.toolCalls ?? []);
        }

        // Call observe hook if there were tool executions
        if (turn.toolExecutions && turn.toolExecutions.length > 0) {
          strategy.onObserve?.(iteration, turn.toolExecutions);
        }

        // Call step end hook
        strategy.onStepEnd?.(iteration, { turn, state: currentState });

        // Save checkpoint after step completes (fire-and-forget, log errors)
        if (context.checkpoints && context.sessionId) {
          context.checkpoints.save(context.sessionId, currentState.toJSON()).catch((err) => {
            console.error('[UAP] Checkpoint save failed:', err);
          });
        }

        // Check stop condition
        const shouldStop = await strategy.stopCondition?.(currentState);
        if (shouldStop) {
          break;
        }

        // Check if there are more tool calls to process
        // UPP's llm.generate handles the tool loop internally,
        // so we only need one iteration unless we're doing multi-step
        if (!turn.response.hasToolCalls) {
          break;
        }

        // Check iteration limit
        if (opts.maxIterations !== Infinity && iteration >= opts.maxIterations) {
          break;
        }

        // For next iteration, use the updated messages
        inputMessages.length = 0;
        inputMessages.push(...currentState.messages);
      }

      if (!finalTurn) {
        throw new Error('No turn generated');
      }

      // Include sessionId in state metadata if checkpointing is enabled
      // Per UAP spec Section 3.4: sessionId MUST be included in state.metadata
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

      // Combine signals if one was provided
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
        let iteration = 0;
        let finalTurn: Turn | undefined;

        // Messages for LLM generation (includes input we just added)
        const inputMessages = [...currentState.messages];

        try {
          while (!aborted) {
            iteration++;
            currentState = currentState.withStep(iteration);

            if (abortController.signal.aborted) {
              throw new Error('Execution aborted');
            }

            strategy.onStepStart?.(iteration, currentState);

            // Emit step start event
            yield {
              source: 'uap',
              uap: {
                type: 'step_start',
                step: iteration,
                agentId,
                data: { iteration },
              },
            };

            // Stream the LLM response
            const streamResult = llm.stream(inputMessages);

            for await (const event of streamResult as AsyncIterable<StreamEvent>) {
              if (abortController.signal.aborted) {
                throw new Error('Execution aborted');
              }

              // Yield UPP events
              yield {
                source: 'upp',
                upp: event,
              };
            }

            // Get the final turn from the stream
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

            // Save checkpoint after step completes (fire-and-forget, log errors)
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

          // Include sessionId in state metadata if checkpointing is enabled
          // Per UAP spec Section 3.4: sessionId MUST be included in state.metadata
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
