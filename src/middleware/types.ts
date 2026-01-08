import type { Message } from '@providerprotocol/ai';
import type { AgentState } from '../state/index.ts';
import type { AgentRef, GenerateResult } from '../execution/types.ts';

/**
 * Context passed to middleware functions during agent execution.
 *
 * This context object provides access to the agent, input message, current state,
 * and a metadata map for sharing data between middleware functions in the chain.
 *
 * @remarks
 * The metadata map is mutable and can be used to pass data between `before` and
 * `after` hooks of the same middleware, or between different middleware in the chain.
 * Use namespaced keys (e.g., `_myMiddleware_key`) to avoid collisions.
 *
 * @see {@link Middleware} for the middleware interface that receives this context
 */
export interface MiddlewareContext {
  /**
   * Reference to the agent being executed.
   *
   * Provides access to agent identity and configuration.
   */
  agent: AgentRef;

  /**
   * The user input message that triggered this execution.
   *
   * This is the original message passed to the agent's generate method.
   */
  input: Message;

  /**
   * The current agent state, including conversation history.
   *
   * @remarks
   * While the state object itself is accessible, modifications should be
   * handled through proper state management rather than direct mutation.
   */
  state: AgentState;

  /**
   * Mutable metadata map for sharing data between middleware hooks.
   *
   * @remarks
   * Common uses include storing timing information in `before` and reading
   * it in `after`, or passing computed values down the middleware chain.
   *
   * @example
   * ```typescript
   * // In before hook
   * context.metadata.set('_myMiddleware_startTime', Date.now());
   *
   * // In after hook
   * const startTime = context.metadata.get('_myMiddleware_startTime') as number;
   * ```
   */
  metadata: Map<string, unknown>;
}

/**
 * Middleware interface for implementing cross-cutting concerns in agent execution.
 *
 * Middleware provides hooks into the agent lifecycle, allowing you to:
 * - Log execution details
 * - Track metrics and performance
 * - Modify context before execution
 * - Transform results after execution
 * - Handle and recover from errors
 *
 * @remarks
 * Middleware executes in a specific order:
 * - **before**: Runs in registration order (first registered runs first)
 * - **after**: Runs in reverse registration order (last registered runs first)
 * - **onError**: Runs in reverse order until one returns a result to recover
 *
 * This ordering allows outer middleware to wrap inner middleware behavior,
 * similar to the onion model used in Express/Koa.
 *
 * @example
 * ```typescript
 * const timingMiddleware: Middleware = {
 *   name: 'timing',
 *
 *   async before(context) {
 *     context.metadata.set('startTime', Date.now());
 *     return context;
 *   },
 *
 *   async after(context, result) {
 *     const startTime = context.metadata.get('startTime') as number;
 *     console.log(`Execution took ${Date.now() - startTime}ms`);
 *     return result;
 *   },
 *
 *   async onError(context, error) {
 *     console.error('Agent failed:', error.message);
 *     // Return undefined to let error propagate
 *     return undefined;
 *   },
 * };
 * ```
 *
 * @see {@link MiddlewareContext} for the context object passed to hooks
 * @see {@link logging} for a built-in logging middleware implementation
 */
export interface Middleware {
  /**
   * Unique name identifying this middleware.
   *
   * Used for debugging and logging purposes. Should be descriptive
   * and unique within the middleware chain.
   */
  name: string;

  /**
   * Hook called before agent execution begins.
   *
   * Use this to:
   * - Log or record the incoming request
   * - Validate or modify the context
   * - Store timing or tracking data in metadata
   * - Short-circuit execution by throwing an error
   *
   * @param context - The execution context containing agent, input, state, and metadata
   * @returns The (optionally modified) context, or void to pass through unchanged
   *
   * @example
   * ```typescript
   * async before(context) {
   *   // Add request ID for tracing
   *   context.metadata.set('requestId', crypto.randomUUID());
   *   return context;
   * }
   * ```
   */
  before?(context: MiddlewareContext): Promise<MiddlewareContext | void>;

  /**
   * Hook called after agent execution completes successfully.
   *
   * Use this to:
   * - Log execution results
   * - Transform or enrich the result
   * - Record metrics (timing, token usage, etc.)
   * - Clean up resources
   *
   * @param context - The execution context (same instance from before hook)
   * @param result - The generation result from the agent
   * @returns The (optionally modified) result
   *
   * @example
   * ```typescript
   * async after(context, result) {
   *   const requestId = context.metadata.get('requestId');
   *   console.log(`[${requestId}] Generated ${result.turn.usage?.totalTokens} tokens`);
   *   return result;
   * }
   * ```
   */
  after?(context: MiddlewareContext, result: GenerateResult): Promise<GenerateResult>;

  /**
   * Hook called when an error occurs during agent execution.
   *
   * This hook can either:
   * - Return a `GenerateResult` to recover from the error gracefully
   * - Return `undefined` (or void) to let the error propagate
   *
   * @param context - The execution context at the time of the error
   * @param error - The error that occurred
   * @returns A recovery result, or undefined to propagate the error
   *
   * @remarks
   * Error hooks are called in reverse middleware order. The first middleware
   * to return a result stops the error propagation and that result is used.
   *
   * @example
   * ```typescript
   * async onError(context, error) {
   *   if (error.message.includes('rate limit')) {
   *     // Log and let it propagate for retry logic
   *     console.warn('Rate limited, should retry');
   *     return undefined;
   *   }
   *   // For other errors, log details
   *   console.error('Agent error:', error);
   *   return undefined;
   * }
   * ```
   */
  onError?(context: MiddlewareContext, error: Error): Promise<GenerateResult | void>;
}

/**
 * Configuration options for the logging middleware.
 *
 * @see {@link logging} for the middleware factory function
 *
 * @example
 * ```typescript
 * // Minimal logging
 * const options: LoggingOptions = {
 *   level: 'warn',
 * };
 *
 * // Verbose debug logging to custom destination
 * const debugOptions: LoggingOptions = {
 *   level: 'debug',
 *   includeMessages: true,
 *   includeTiming: true,
 *   logger: (msg) => myLogger.log(msg),
 * };
 * ```
 */
export interface LoggingOptions {
  /**
   * Minimum log level to output.
   *
   * Messages below this level are suppressed. Levels in order of verbosity:
   * - `debug` - Detailed debugging information
   * - `info` - General execution information
   * - `warn` - Warning conditions
   * - `error` - Error conditions only
   *
   * @defaultValue 'info'
   */
  level?: 'debug' | 'info' | 'warn' | 'error';

  /**
   * Custom logging function to receive log messages.
   *
   * Override this to integrate with your logging infrastructure
   * (e.g., Winston, Pino, or a cloud logging service).
   *
   * @param message - The formatted log message including level prefix
   * @defaultValue console.log
   *
   * @example
   * ```typescript
   * logger: (msg) => winston.info(msg)
   * ```
   */
  logger?: (message: string) => void;

  /**
   * Whether to include message content in debug logs.
   *
   * When enabled, logs the input message content and response text.
   * Useful for debugging but may expose sensitive data.
   *
   * @defaultValue false
   */
  includeMessages?: boolean;

  /**
   * Whether to include execution timing in log output.
   *
   * When enabled, logs the duration of agent execution in milliseconds.
   *
   * @defaultValue true
   */
  includeTiming?: boolean;
}
