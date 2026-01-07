import type { Message } from '@providerprotocol/ai';
import type { AgentState } from '../state/index.ts';
import type { AgentRef, GenerateResult } from '../execution/types.ts';

/**
 * Context passed to middleware functions.
 */
export interface MiddlewareContext {
  /** The agent being executed */
  agent: AgentRef;
  /** User input message */
  input: Message;
  /** Current state */
  state: AgentState;
  /** Request metadata (mutable within middleware) */
  metadata: Map<string, unknown>;
}

/**
 * Middleware interface for cross-cutting concerns.
 *
 * Middleware executes in order for `before`, reverse order for `after`:
 * - before: first -> second -> third
 * - after: third -> second -> first
 */
export interface Middleware {
  /** Middleware name */
  name: string;

  /**
   * Called before agent execution.
   * Can modify context or short-circuit by returning a modified context.
   */
  before?(context: MiddlewareContext): Promise<MiddlewareContext | void>;

  /**
   * Called after agent execution.
   * Can modify the result before returning.
   */
  after?(context: MiddlewareContext, result: GenerateResult): Promise<GenerateResult>;

  /**
   * Called when an error occurs during execution.
   * Can return a result to recover, or void to let the error propagate.
   */
  onError?(context: MiddlewareContext, error: Error): Promise<GenerateResult | void>;
}

/**
 * Options for the logging middleware.
 */
export interface LoggingOptions {
  /** Log level. Default: 'info' */
  level?: 'debug' | 'info' | 'warn' | 'error';
  /** Custom logger function. Default: console.log */
  logger?: (message: string) => void;
  /** Include full message content. Default: false */
  includeMessages?: boolean;
  /** Include execution timing. Default: true */
  includeTiming?: boolean;
}
