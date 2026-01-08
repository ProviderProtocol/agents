/**
 * Agent module for the Unified Agent Protocol (UAP).
 *
 * This module provides the core `agent()` factory function for creating
 * AI agent instances that combine LLM capabilities with state management,
 * middleware pipelines, and execution strategies.
 *
 * @packageDocumentation
 */

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
 * Creates a new agent instance with the specified configuration.
 *
 * The agent factory function is the primary entry point for creating AI agents
 * in the Unified Agent Protocol (UAP). It combines an LLM from `@providerprotocol/ai`
 * with UAP-specific features like state management, middleware, and execution strategies.
 *
 * @param options - Agent configuration options including model, tools, system prompt,
 *                  execution strategy, middleware, and checkpointing configuration
 * @returns A configured Agent instance ready for execution
 *
 * @remarks
 * The agent function performs the following setup:
 * 1. Generates a unique agent ID (UUIDv4)
 * 2. Optionally generates a session ID for checkpointing
 * 3. Creates the underlying LLM instance with full UPP passthrough
 * 4. Configures the middleware pipeline
 * 5. Sets up the execution strategy (defaults to `loop()`)
 *
 * @example
 * Basic agent creation:
 * ```typescript
 * import { agent, AgentState } from '@providerprotocol/agents';
 * import { anthropic } from '@providerprotocol/ai/anthropic';
 *
 * const myAgent = agent({
 *   model: anthropic('claude-sonnet-4-20250514'),
 *   system: 'You are a helpful assistant.',
 * });
 *
 * const state = AgentState.initial();
 * const { turn, state: newState } = await myAgent.generate('Hello', state);
 * ```
 *
 * @example
 * Agent with tools and middleware:
 * ```typescript
 * import { agent } from '@providerprotocol/agents';
 * import { anthropic } from '@providerprotocol/ai/anthropic';
 * import { loop } from '@providerprotocol/agents/execution';
 * import { withContext } from '@providerprotocol/agents/middleware';
 *
 * const coder = agent({
 *   model: anthropic('claude-sonnet-4-20250514'),
 *   tools: [Bash, Read, Write],
 *   system: 'You are a coding assistant.',
 *   execution: loop({ maxIterations: 20 }),
 *   middleware: [withContext({ maxTokens: 100000 })],
 * });
 * ```
 *
 * @see {@link Agent} for the returned interface
 * @see {@link AgentOptions} for all configuration options
 */
export function agent(options: AgentOptions): Agent {
  const {
    execution = loop(),
    middleware = [],
    strategy = {},
    checkpoints,
    sessionId: providedSessionId,
    _llmInstance,
    model,
    params = {},
    config,
    tools = [],
    system,
    structure,
    toolStrategy,
  } = options;

  const agentId = generateUUID();

  // Per UAP-1.0 Section 3.4: Session IDs MUST be UUIDv4.
  // Auto-generate when checkpoints are provided but no sessionId is specified.
  const sessionId = checkpoints ? (providedSessionId ?? generateUUID()) : providedSessionId;

  // Create the LLM instance with full UPP passthrough, or use injected instance for testing
  const llmInstance: LLMInstance = _llmInstance ?? llm({
    model,
    params,
    config,
    system,
    structure,
    tools,
    toolStrategy,
  });

  /**
   * Normalizes user input to a Message object.
   *
   * @param input - String or Message input from the user
   * @returns A Message object (UserMessage if input was a string)
   */
  function normalizeInput(input: string | Message): Message {
    if (typeof input === 'string') {
      return new UserMessage(input);
    }
    return input;
  }

  /**
   * Executes middleware `before` hooks in pipeline order.
   *
   * Each middleware can modify the context before execution proceeds.
   * Middlewares are run sequentially in the order they were registered.
   *
   * @param middlewares - Array of middleware instances
   * @param context - Initial middleware context
   * @returns The potentially modified context after all before hooks
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
   * Executes middleware `after` hooks in reverse pipeline order.
   *
   * Each middleware can modify the result after execution completes.
   * Middlewares are run in reverse order (last registered runs first)
   * to maintain symmetric wrapping behavior.
   *
   * @param middlewares - Array of middleware instances
   * @param context - The middleware context from execution
   * @param result - The generation result to potentially modify
   * @returns The potentially modified result after all after hooks
   */
  async function runAfterMiddleware(
    middlewares: Middleware[],
    context: MiddlewareContext,
    result: GenerateResult,
  ): Promise<GenerateResult> {
    let currentResult = result;

    for (let i = middlewares.length - 1; i >= 0; i--) {
      const mw = middlewares[i];
      if (mw?.after) {
        currentResult = await mw.after(context, currentResult);
      }
    }

    return currentResult;
  }

  /**
   * Executes middleware `onError` hooks in reverse pipeline order.
   *
   * Attempts error recovery by allowing middleware to handle errors.
   * The first middleware that returns a result "catches" the error.
   * If no middleware handles the error, returns undefined.
   *
   * @param middlewares - Array of middleware instances
   * @param context - The middleware context from execution
   * @param error - The error that occurred during execution
   * @returns A recovered result if any middleware handled the error, otherwise undefined
   */
  async function runErrorMiddleware(
    middlewares: Middleware[],
    context: MiddlewareContext,
    error: Error,
  ): Promise<GenerateResult | undefined> {
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
   * Constructs the execution context for the execution strategy.
   *
   * @param input - Normalized user message
   * @param state - Current agent state
   * @param resolvedStrategy - Agent strategy hooks
   * @param signal - Optional AbortSignal for cancellation
   * @returns ExecutionContext ready for the execution strategy
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
      checkpoints,
      sessionId,
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

      const middlewareContext: MiddlewareContext = {
        agent: { id: agentId, system },
        input: normalizedInput,
        state,
        metadata: new Map(),
      };

      try {
        const processedContext = await runBeforeMiddleware(middleware, middlewareContext);

        const executionContext = buildExecutionContext(
          processedContext.input,
          processedContext.state,
          strategy,
        );

        const result = await execution.execute(executionContext);

        const finalResult = await runAfterMiddleware(
          middleware,
          processedContext,
          result,
        );

        return finalResult;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));

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

      const middlewareContext: MiddlewareContext = {
        agent: { id: agentId, system },
        input: normalizedInput,
        state,
        metadata: new Map(),
      };

      // Streaming requires wrapping the async generator to handle middleware
      // while still returning a synchronous AgentStreamResult
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
          const processedContext = await runBeforeMiddleware(middleware, middlewareContext);

          const executionContext = buildExecutionContext(
            processedContext.input,
            processedContext.state,
            strategy,
            abortController.signal,
          );

          const streamResult = execution.stream(executionContext);

          for await (const event of streamResult) {
            if (aborted) {
              break;
            }
            yield event;
          }

          const result = await streamResult.result;

          const finalResult = await runAfterMiddleware(
            middleware,
            processedContext,
            result,
          );

          resolveResult(finalResult);
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));

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
      // Per UAP-1.0 Section 4.6, ask() delegates to generate() because the execution
      // strategy handles adding input to state and appending the response. This
      // preserves all middleware modifications and avoids message duplication.
      return agentInstance.generate(input, state);
    },

    async query(input: string | Message): Promise<Turn> {
      const initialState = AgentState.initial();
      const result = await agentInstance.generate(input, initialState);
      return result.turn;
    },
  };

  return agentInstance;
}

// Re-export core types for consumer convenience
export type { Agent, AgentOptions } from './types.ts';
export type {
  GenerateResult,
  AgentStreamResult,
  AgentStreamEvent,
  UAPEventType,
  AgentStrategy,
  SubagentEventType,
  SubagentEventBase,
  SubagentStartEvent,
  SubagentInnerEvent,
  SubagentEndEvent,
  SubagentEvent,
  OnSubagentEvent,
} from '../execution/types.ts';
