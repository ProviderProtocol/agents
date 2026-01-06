import type { Middleware, LoggingOptions, MiddlewareContext } from './types.ts';
import type { GenerateResult } from '../execution/types.ts';

const DEFAULT_LOGGING_OPTIONS: Required<LoggingOptions> = {
  level: 'info',
  logger: console.log,
  includeMessages: false,
  includeTiming: true,
};

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
} as const;

/**
 * Create a logging middleware.
 *
 * Logs agent execution with configurable detail level:
 * - Execution start/end
 * - Timing information (if enabled)
 * - Message content (if enabled)
 * - Errors
 *
 * @param options - Logging configuration options
 * @returns Middleware
 */
export function logging(options: LoggingOptions = {}): Middleware {
  const opts = { ...DEFAULT_LOGGING_OPTIONS, ...options };
  const currentLevel = LOG_LEVELS[opts.level];

  function shouldLog(level: keyof typeof LOG_LEVELS): boolean {
    return LOG_LEVELS[level] >= currentLevel;
  }

  function log(level: keyof typeof LOG_LEVELS, message: string): void {
    if (shouldLog(level)) {
      const prefix = `[UAP:${level.toUpperCase()}]`;
      opts.logger(`${prefix} ${message}`);
    }
  }

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

      // Let the error propagate
      return undefined;
    },
  };
}
