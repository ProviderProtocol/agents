import {
  llm,
  UserMessage,
} from '@providerprotocol/ai';
import type {
  LLMInstance,
  Message,
  Turn,
} from '@providerprotocol/ai';
import { generateUUID } from '../utils/uuid.ts';
import { AgentState } from '../state/index.ts';
import { loop } from '../execution/loop.ts';
import type {
  ExecutionContext,
  GenerateResult,
  AgentStreamResult,
  AgentStrategy,
} from '../execution/types.ts';
import type { Middleware, MiddlewareContext } from '../middleware/types.ts';
import type { Agent, AgentOptions } from './types.ts';

/**
 * Create an agent instance.
 *
 * @param options - Agent configuration
 * @returns Agent instance
 *
 * @example
 * ```typescript
 * import { agent, AgentState } from '@providerprotocol/agents';
 * import { anthropic } from '@providerprotocol/ai/anthropic';
 *
 * const coder = agent({
 *   model: anthropic('claude-sonnet-4-20250514'),
 *   tools: [Bash, Read, Write],
 *   system: 'You are a coding assistant.',
 * });
 *
 * const state = AgentState.initial();
 * const { turn, state: newState } = await coder.generate('Hello', state);
 * ```
 */
export function agent(options: AgentOptions): Agent {
  const {
    model,
    params = {},
    config,
    execution = loop(),
    tools = [],
    system,
    structure,
    middleware = [],
    strategy = {},
    _llmInstance,
  } = options;

  const agentId = generateUUID();

  // Create the LLM instance (or use injected instance for testing)
  const llmInstance: LLMInstance = _llmInstance ?? llm({
    model,
    params,
    config,
    system,
    structure,
    tools,
  });

  /**
   * Normalize input to a Message.
   */
  function normalizeInput(input: string | Message): Message {
    if (typeof input === 'string') {
      return new UserMessage(input);
    }
    return input;
  }

  /**
   * Run middleware before hooks.
   */
  async function runBeforeMiddleware(
    middlewares: Middleware[],
    context: MiddlewareContext,
  ): Promise<MiddlewareContext> {
    let currentContext = context;

    for (const mw of middlewares) {
      if (mw.before) {
        const result = await mw.before(currentContext);
        if (result) {
          currentContext = result;
        }
      }
    }

    return currentContext;
  }

  /**
   * Run middleware after hooks (in reverse order).
   */
  async function runAfterMiddleware(
    middlewares: Middleware[],
    context: MiddlewareContext,
    result: GenerateResult,
  ): Promise<GenerateResult> {
    let currentResult = result;

    // Run in reverse order
    for (let i = middlewares.length - 1; i >= 0; i--) {
      const mw = middlewares[i];
      if (mw?.after) {
        currentResult = await mw.after(context, currentResult);
      }
    }

    return currentResult;
  }

  /**
   * Run middleware error hooks (in reverse order).
   */
  async function runErrorMiddleware(
    middlewares: Middleware[],
    context: MiddlewareContext,
    error: Error,
  ): Promise<GenerateResult | undefined> {
    // Run in reverse order
    for (let i = middlewares.length - 1; i >= 0; i--) {
      const mw = middlewares[i];
      if (mw?.onError) {
        const result = await mw.onError(context, error);
        if (result) {
          return result;
        }
      }
    }

    return undefined;
  }

  /**
   * Build execution context.
   */
  function buildExecutionContext(
    input: Message,
    state: AgentState,
    resolvedStrategy: AgentStrategy,
    signal?: AbortSignal,
  ): ExecutionContext {
    return {
      agent: { id: agentId, system },
      llm: llmInstance,
      input,
      state,
      tools,
      strategy: resolvedStrategy,
      signal,
    };
  }

  const agentInstance: Agent = {
    id: agentId,
    model,
    tools,
    system,

    async generate(
      input: string | Message,
      state: AgentState,
    ): Promise<GenerateResult> {
      const normalizedInput = normalizeInput(input);

      // Create middleware context
      const middlewareContext: MiddlewareContext = {
        agent: { id: agentId, system },
        input: normalizedInput,
        state,
        metadata: new Map(),
      };

      try {
        // Run before middleware
        const processedContext = await runBeforeMiddleware(middleware, middlewareContext);

        // Build execution context
        const executionContext = buildExecutionContext(
          processedContext.input,
          processedContext.state,
          strategy,
        );

        // Execute strategy
        const result = await execution.execute(executionContext);

        // Run after middleware
        const finalResult = await runAfterMiddleware(
          middleware,
          processedContext,
          result,
        );

        return finalResult;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));

        // Try to recover with error middleware
        const recovered = await runErrorMiddleware(middleware, middlewareContext, err);
        if (recovered) {
          return recovered;
        }

        throw err;
      }
    },

    stream(
      input: string | Message,
      state: AgentState,
    ): AgentStreamResult {
      const normalizedInput = normalizeInput(input);

      // Create middleware context
      const middlewareContext: MiddlewareContext = {
        agent: { id: agentId, system },
        input: normalizedInput,
        state,
        metadata: new Map(),
      };

      // We need to run before middleware synchronously enough to get the context
      // but streaming is inherently async. We'll handle this by wrapping the stream.
      let aborted = false;
      const abortController = new AbortController();

      let resolveResult: (result: GenerateResult) => void;
      let rejectResult: (error: Error) => void;

      const resultPromise = new Promise<GenerateResult>((resolve, reject) => {
        resolveResult = resolve;
        rejectResult = reject;
      });

      const createStream = async function* () {
        try {
          // Run before middleware
          const processedContext = await runBeforeMiddleware(middleware, middlewareContext);

          // Build execution context
          const executionContext = buildExecutionContext(
            processedContext.input,
            processedContext.state,
            strategy,
            abortController.signal,
          );

          // Get the stream from the execution strategy
          const streamResult = execution.stream(executionContext);

          // Yield events from the stream
          for await (const event of streamResult) {
            if (aborted) {
              break;
            }
            yield event;
          }

          // Get the final result
          const result = await streamResult.result;

          // Run after middleware
          const finalResult = await runAfterMiddleware(
            middleware,
            processedContext,
            result,
          );

          resolveResult(finalResult);
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));

          // Try to recover with error middleware
          const recovered = await runErrorMiddleware(middleware, middlewareContext, err);
          if (recovered) {
            resolveResult(recovered);
            return;
          }

          rejectResult(err);
          throw err;
        }
      };

      const iterator = createStream();

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

    async ask(
      input: string | Message,
      state: AgentState,
    ): Promise<GenerateResult> {
      const normalizedInput = normalizeInput(input);

      // Generate with original state - execution strategy adds input to LLM call
      const result = await agentInstance.generate(normalizedInput, state);

      // Build final state with correct message order:
      // original messages + input + response messages from this turn
      const responseMessages = result.state.messages.slice(state.messages.length);
      const finalState = state
        .withMessage(normalizedInput)
        .withMessages(responseMessages)
        .withStep(result.state.step);

      // Preserve metadata from execution
      let stateWithMetadata = finalState;
      for (const [key, value] of Object.entries(result.state.metadata)) {
        stateWithMetadata = stateWithMetadata.withMetadata(key, value);
      }

      // Preserve reasoning traces
      for (const reasoning of result.state.reasoning) {
        stateWithMetadata = stateWithMetadata.withReasoning(reasoning);
      }

      // Preserve plan if present
      if (result.state.plan) {
        stateWithMetadata = stateWithMetadata.withPlan([...result.state.plan]);
      }

      return {
        turn: result.turn,
        state: stateWithMetadata,
      };
    },

    async query(input: string | Message): Promise<Turn> {
      const initialState = AgentState.initial();
      const result = await agentInstance.generate(input, initialState);
      return result.turn;
    },
  };

  return agentInstance;
}

export type { Agent, AgentOptions } from './types.ts';
export type {
  GenerateResult,
  AgentStreamResult,
  AgentStreamEvent,
  UAPEventType,
  AgentStrategy,
} from '../execution/types.ts';
