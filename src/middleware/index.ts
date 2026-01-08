/**
 * Middleware module for agent lifecycle hooks and cross-cutting concerns.
 *
 * This module provides an extensible middleware system for intercepting and
 * augmenting agent execution. Middleware can be used for:
 *
 * - **Logging** - Track agent activity and debug execution
 * - **Metrics** - Record performance data and usage statistics
 * - **Validation** - Validate inputs or outputs
 * - **Error handling** - Implement custom error recovery strategies
 * - **Tracing** - Add distributed tracing context
 *
 * @example
 * Using the built-in logging middleware:
 * ```typescript
 * import { createAgent } from '@providerprotocol/agents';
 * import { logging } from '@providerprotocol/agents/middleware';
 * import { anthropic } from '@providerprotocol/ai/anthropic';
 *
 * const agent = createAgent({
 *   model: anthropic('claude-sonnet-4-20250514'),
 *   middleware: [logging({ level: 'debug' })],
 * });
 * ```
 *
 * @example
 * Creating a custom middleware:
 * ```typescript
 * import type { Middleware } from '@providerprotocol/agents/middleware';
 *
 * const metricsMiddleware: Middleware = {
 *   name: 'metrics',
 *   async before(context) {
 *     context.metadata.set('startTime', performance.now());
 *     return context;
 *   },
 *   async after(context, result) {
 *     const duration = performance.now() - (context.metadata.get('startTime') as number);
 *     metrics.recordLatency('agent.execution', duration);
 *     metrics.recordCount('agent.tokens', result.turn.usage?.totalTokens ?? 0);
 *     return result;
 *   },
 * };
 * ```
 *
 * @packageDocumentation
 */

export { logging } from './logging.ts';

export type {
  Middleware,
  MiddlewareContext,
  LoggingOptions,
} from './types.ts';
