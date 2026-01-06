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

const DEFAULT_REACT_OPTIONS: Required<ReactOptions> = {
  maxSteps: Infinity,
  reasoningPrompt: 'Think step by step about what you need to do next. Consider the current state, what tools are available, and what action would be most helpful.',
};

/**
 * Create a ReAct (Reason-Act-Observe) execution strategy.
 *
 * Behavior:
 * 1. Reason: LLM outputs reasoning about what to do next
 * 2. Act: LLM selects and executes tool(s)
 * 3. Observe: Tool results are formatted as observations
 * 4. Repeat until stop condition, no more actions, or maxSteps
 *
 * @param options - ReAct configuration options
 * @returns ExecutionStrategy
 */
export function react(options: ReactOptions = {}): ExecutionStrategy {
  const opts = { ...DEFAULT_REACT_OPTIONS, ...options };

  return {
    name: 'react',

    async execute(context: ExecutionContext): Promise<ExecutionResult> {
      const { llm, input, state, strategy, signal } = context;

      let currentState = state;
      let step = 0;
      let finalTurn: Turn | undefined;

      // Build initial messages
      const messages = [...currentState.messages, input];

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

        // Add reasoning to conversation
        messages.push(...reasoningTurn.messages);

        // ACT PHASE: Execute with tools
        const actionPrompt = new UserMessage(
          'Based on your reasoning, take the appropriate action. Use tools if needed, or provide a final answer.',
        );
        messages.push(actionPrompt);

        const actionTurn = await llm.generate(messages);
        finalTurn = actionTurn;

        // Update messages with action response
        messages.push(...actionTurn.messages);
        currentState = currentState.withMessages(actionTurn.messages);

        // Handle tool calls
        if (actionTurn.response.hasToolCalls) {
          strategy.onAct?.(step, actionTurn.response.toolCalls ?? []);
        }

        // OBSERVE PHASE: Process tool results
        if (actionTurn.toolExecutions && actionTurn.toolExecutions.length > 0) {
          strategy.onObserve?.(step, actionTurn.toolExecutions);
        }

        strategy.onStepEnd?.(step, { turn: actionTurn, state: currentState });

        // Check stop conditions
        const shouldStop = await strategy.stopCondition?.(currentState);
        if (shouldStop) {
          break;
        }

        // No more tool calls means we're done
        if (!actionTurn.response.hasToolCalls) {
          break;
        }

        // Check step limit
        if (opts.maxSteps !== Infinity && step >= opts.maxSteps) {
          break;
        }
      }

      if (!finalTurn) {
        throw new Error('No turn generated');
      }

      const result: ExecutionResult = {
        turn: finalTurn,
        state: currentState,
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
        let currentState = state;
        let step = 0;
        let finalTurn: Turn | undefined;

        const messages = [...currentState.messages, input];

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

            // REASON PHASE
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

            // ACT PHASE
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

          const result: ExecutionResult = {
            turn: finalTurn,
            state: currentState,
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
