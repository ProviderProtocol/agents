import type { Middleware, LoggingOptions, MiddlewareContext } from './types.ts';
import type { GenerateResult } from '../execution/types.ts';

/**
 * Default configuration values for the logging middleware.
 *
 * @internal
 */
const DEFAULT_LOGGING_OPTIONS: Required<LoggingOptions> = {
  level: 'info',
  logger: console.log,
  includeMessages: false,
  includeTiming: true,
};

/**
 * Numeric priority values for log levels, used for filtering.
 *
 * Lower numbers are more verbose. A log message is shown only
 * if its level value is >= the configured minimum level value.
 *
 * @internal
 */
const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
} as const;

/**
 * Creates a logging middleware that records agent execution activity.
 *
 * This middleware provides comprehensive logging for agent operations including:
 * - Execution start with agent identification
 * - Execution completion with optional timing and token usage
 * - Error conditions with contextual information
 * - Optional detailed message content (debug level)
 *
 * @param options - Configuration options for logging behavior
 * @returns A configured {@link Middleware} instance
 *
 * @example
 * Basic usage with default options:
 * ```typescript
 * import { createAgent } from '@providerprotocol/agents';
 * import { logging } from '@providerprotocol/agents/middleware';
 *
 * const agent = createAgent({
 *   model: anthropic('claude-sonnet-4-20250514'),
 *   middleware: [logging()],
 * });
 * ```
 *
 * @example
 * Debug logging with message content:
 * ```typescript
 * const agent = createAgent({
 *   model: anthropic('claude-sonnet-4-20250514'),
 *   middleware: [
 *     logging({
 *       level: 'debug',
 *       includeMessages: true,
 *       includeTiming: true,
 *     }),
 *   ],
 * });
 * ```
 *
 * @example
 * Custom logger integration:
 * ```typescript
 * import pino from 'pino';
 *
 * const pinoLogger = pino();
 *
 * const agent = createAgent({
 *   model: anthropic('claude-sonnet-4-20250514'),
 *   middleware: [
 *     logging({
 *       level: 'info',
 *       logger: (msg) => pinoLogger.info(msg),
 *     }),
 *   ],
 * });
 * ```
 *
 * @see {@link LoggingOptions} for available configuration options
 * @see {@link Middleware} for the middleware interface
 */
export function logging(options: LoggingOptions = {}): Middleware {
  const opts = { ...DEFAULT_LOGGING_OPTIONS, ...options };
  const currentLevel = LOG_LEVELS[opts.level];

  /**
   * Determines if a message at the given level should be logged.
   *
   * @param level - The log level of the message to check
   * @returns true if the message should be logged, false otherwise
   */
  function shouldLog(level: keyof typeof LOG_LEVELS): boolean {
    return LOG_LEVELS[level] >= currentLevel;
  }

  /**
   * Outputs a log message if it meets the minimum level threshold.
   *
   * Messages are prefixed with `[UAP:LEVEL]` for easy filtering.
   *
   * @param level - The severity level of the message
   * @param message - The message content to log
   */
  function log(level: keyof typeof LOG_LEVELS, message: string): void {
    if (shouldLog(level)) {
      const prefix = `[UAP:${level.toUpperCase()}]`;
      opts.logger(`${prefix} ${message}`);
    }
  }

  /**
   * Formats execution context into a human-readable string.
   *
   * Produces output like: `agent=my-agent messages=5`
   *
   * @param context - The middleware execution context
   * @returns Formatted context string for logging
   */
  function formatContext(context: MiddlewareContext): string {
    const parts = [`agent=${context.agent.id}`];

    if (opts.includeMessages) {
      parts.push(`messages=${context.state.messages.length}`);
    }

    return parts.join(' ');
  }

  return {
    name: 'logging',

    async before(context: MiddlewareContext): Promise<MiddlewareContext | void> {
      log('info', `Execution started: ${formatContext(context)}`);

      if (opts.includeTiming) {
        context.metadata.set('_logging_startTime', Date.now());
      }

      if (opts.includeMessages && shouldLog('debug')) {
        log('debug', `Input: ${JSON.stringify(context.input)}`);
      }

      return context;
    },

    async after(
      context: MiddlewareContext,
      result: GenerateResult,
    ): Promise<GenerateResult> {
      let message = 'Execution completed';

      if (opts.includeTiming) {
        const startTime = context.metadata.get('_logging_startTime') as number | undefined;
        if (startTime) {
          const duration = Date.now() - startTime;
          message += ` in ${duration}ms`;
        }
      }

      message += `: ${formatContext(context)}`;

      if (result.turn.usage) {
        message += ` tokens=${result.turn.usage.totalTokens}`;
      }

      log('info', message);

      if (opts.includeMessages && shouldLog('debug')) {
        log('debug', `Response: ${result.turn.response.text.substring(0, 200)}...`);
      }

      return result;
    },

    async onError(
      context: MiddlewareContext,
      error: Error,
    ): Promise<GenerateResult | void> {
      let message = `Execution failed: ${error.message}`;

      if (opts.includeTiming) {
        const startTime = context.metadata.get('_logging_startTime') as number | undefined;
        if (startTime) {
          const duration = Date.now() - startTime;
          message += ` after ${duration}ms`;
        }
      }

      message += `: ${formatContext(context)}`;

      log('error', message);

      // Allow error to propagate to the next middleware or caller
      return undefined;
    },
  };
}
