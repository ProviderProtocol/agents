import type {
  ModelReference,
  Tool,
  Turn,
  Message,
  LLMInstance,
  LLMOptions,
} from '@providerprotocol/ai';
import type { AgentState } from '../state/index.ts';
import type {
  ExecutionStrategy,
  AgentStrategy,
  GenerateResult,
  AgentStreamResult,
} from '../execution/types.ts';
import type { Middleware } from '../middleware/types.ts';
import type { CheckpointStore } from '../checkpoint/types.ts';

/**
 * Configuration options for creating an agent instance.
 *
 * Extends LLMOptions from `@providerprotocol/ai` for full UPP (Unified Provider Protocol)
 * passthrough, allowing all provider-specific parameters to be configured.
 *
 * @remarks
 * The agent options combine UAP-specific configuration (execution strategy, middleware,
 * checkpointing) with UPP LLM configuration (model, params, tools, system prompt).
 * This enables agents to leverage the full power of the underlying LLM while adding
 * agentic capabilities like state management and middleware pipelines.
 *
 * @example
 * ```typescript
 * import { agent } from '@providerprotocol/agents';
 * import { anthropic } from '@providerprotocol/ai/anthropic';
 * import { loop } from '@providerprotocol/agents/execution';
 *
 * const options: AgentOptions = {
 *   model: anthropic('claude-sonnet-4-20250514'),
 *   params: { max_tokens: 4096 },
 *   tools: [myTool],
 *   system: 'You are a helpful assistant.',
 *   execution: loop({ maxIterations: 10 }),
 *   middleware: [loggingMiddleware],
 * };
 * ```
 */
export interface AgentOptions extends Partial<Omit<LLMOptions, 'model'>> {
  /**
   * Model reference from a UPP provider factory.
   *
   * @remarks
   * Must be created using a provider factory function like `anthropic()`, `openai()`,
   * `google()`, etc. from `@providerprotocol/ai`.
   *
   * @example
   * ```typescript
   * import { anthropic } from '@providerprotocol/ai/anthropic';
   * model: anthropic('claude-sonnet-4-20250514')
   * ```
   */
  model: ModelReference;

  /**
   * Execution strategy that controls how the agent processes requests.
   *
   * @remarks
   * The execution strategy determines the control flow of agent execution,
   * including how tool calls are handled and when to stop iterating.
   *
   * @defaultValue `loop()` - Standard agentic loop with tool execution
   */
  execution?: ExecutionStrategy;

  /**
   * Ordered middleware pipeline for request/response processing.
   *
   * @remarks
   * Middleware functions are executed in order for `before` hooks and in
   * reverse order for `after` hooks. This enables cross-cutting concerns
   * like logging, context management, and error handling.
   *
   * @see {@link Middleware}
   */
  middleware?: Middleware[];

  /**
   * Agent lifecycle hooks for customizing execution behavior.
   *
   * @remarks
   * Strategy hooks provide fine-grained control over the execution loop,
   * including iteration limits and custom termination conditions.
   */
  strategy?: AgentStrategy;

  /**
   * Checkpoint store for step-level state persistence.
   *
   * @remarks
   * When provided, the agent will persist state checkpoints after each
   * execution step, enabling recovery and replay capabilities.
   *
   * @see {@link CheckpointStore}
   */
  checkpoints?: CheckpointStore;

  /**
   * Session identifier for checkpointing.
   *
   * @remarks
   * Per UAP-1.0 Section 3.4, session IDs must be UUIDv4. If not provided
   * and checkpoints are enabled, a UUIDv4 will be auto-generated.
   */
  sessionId?: string;

  /**
   * Pre-created LLM instance for dependency injection.
   *
   * @internal
   * @remarks
   * Used primarily for testing to inject mock LLM instances. Not intended
   * for production use.
   */
  _llmInstance?: LLMInstance;
}

/**
 * Core agent interface for AI-powered autonomous execution.
 *
 * The Agent interface defines the contract for all agent instances created via
 * the `agent()` factory function. It provides multiple execution modes to support
 * different use cases, from simple stateless queries to complex multi-turn
 * conversations with full state management.
 *
 * @remarks
 * Agents wrap an underlying LLM instance from `@providerprotocol/ai` and add:
 * - Immutable state management via `AgentState`
 * - Middleware pipeline for cross-cutting concerns
 * - Execution strategies for custom control flow
 * - Checkpointing for durability and recovery
 *
 * All execution methods are designed around immutable state: the input state
 * is never modified, and a new state is returned with each execution.
 *
 * @example
 * ```typescript
 * import { agent, AgentState } from '@providerprotocol/agents';
 * import { anthropic } from '@providerprotocol/ai/anthropic';
 *
 * const myAgent = agent({
 *   model: anthropic('claude-sonnet-4-20250514'),
 *   system: 'You are a helpful assistant.',
 * });
 *
 * // Stateless single query
 * const turn = await myAgent.query('What is 2+2?');
 * console.log(turn.response.text);
 *
 * // Stateful multi-turn conversation
 * let state = AgentState.initial();
 * const result1 = await myAgent.ask('My name is Alice.', state);
 * state = result1.state;
 * const result2 = await myAgent.ask('What is my name?', state);
 * console.log(result2.turn.response.text); // "Alice"
 * ```
 */
export interface Agent {
  /**
   * Unique agent identifier in UUIDv4 format.
   *
   * @remarks
   * Generated automatically when the agent is created. Useful for logging,
   * tracing, and correlating agent activity across systems.
   */
  readonly id: string;

  /**
   * The model reference bound to this agent.
   *
   * @remarks
   * This is the model reference passed to `agent()` during creation.
   * It cannot be changed after the agent is instantiated.
   */
  readonly model: ModelReference;

  /**
   * Tools available to this agent for execution.
   *
   * @remarks
   * These tools are passed to the underlying LLM and can be invoked
   * during agent execution when the model decides to use them.
   */
  readonly tools: Tool[];

  /**
   * System prompt that guides agent behavior.
   *
   * @remarks
   * The system prompt is sent with every LLM request and shapes how
   * the agent responds to user inputs.
   */
  readonly system?: string;

  /**
   * Execute the agent and return the turn result with updated state.
   *
   * This is the primary execution method for stateful agent interactions.
   * It processes the input through the middleware pipeline, executes the
   * configured execution strategy, and returns both the turn result and
   * the new immutable state.
   *
   * @param input - User input as a string or Message object
   * @param state - Current immutable agent state
   * @returns Promise resolving to the turn result and new state
   *
   * @example
   * ```typescript
   * const state = AgentState.initial();
   * const { turn, state: newState } = await agent.generate('Hello!', state);
   * console.log(turn.response.text);
   * console.log(newState.messages.length);
   * ```
   */
  generate(input: string | Message, state: AgentState): Promise<GenerateResult>;

  /**
   * Execute the agent with streaming response.
   *
   * Returns an async iterable that yields events as they arrive from the LLM,
   * plus a promise that resolves to the final result when streaming completes.
   * Supports abort functionality for canceling long-running streams.
   *
   * @param input - User input as a string or Message object
   * @param state - Current immutable agent state
   * @returns Stream result with async iterator, result promise, and abort method
   *
   * @example
   * ```typescript
   * const state = AgentState.initial();
   * const stream = agent.stream('Count from 1 to 10.', state);
   *
   * for await (const event of stream) {
   *   if (event.type === 'text_delta') {
   *     process.stdout.write(event.delta.text ?? '');
   *   }
   * }
   *
   * const { turn, state: newState } = await stream.result;
   * ```
   */
  stream(input: string | Message, state: AgentState): AgentStreamResult;

  /**
   * Multi-turn execution with automatic conversation history management.
   *
   * This is a convenience method that wraps `generate()` with automatic
   * message history management. Per UAP-1.0 Section 4.6, the execution
   * strategy handles adding the input to state and appending the response.
   *
   * @param input - User input as a string or Message object
   * @param state - Current immutable agent state
   * @returns Promise resolving to the turn result and new state with updated history
   *
   * @remarks
   * Use `ask()` when building conversational agents where you want the
   * framework to manage message history automatically. The returned state
   * includes both the user's input and the assistant's response.
   *
   * @example
   * ```typescript
   * let state = AgentState.initial();
   *
   * // First turn
   * const result1 = await agent.ask('My name is Alice.', state);
   * state = result1.state;
   *
   * // Second turn - agent remembers context
   * const result2 = await agent.ask('What is my name?', state);
   * state = result2.state;
   * // result2.turn.response.text contains "Alice"
   * ```
   */
  ask(input: string | Message, state: AgentState): Promise<GenerateResult>;

  /**
   * Stateless single-turn execution for one-off queries.
   *
   * Creates an ephemeral initial state, executes the agent, and returns
   * only the turn result (discarding the state). Use this for simple
   * queries where conversation history is not needed.
   *
   * @param input - User input as a string or Message object
   * @returns Promise resolving to the Turn result
   *
   * @example
   * ```typescript
   * // Simple one-off query - no state management needed
   * const turn = await agent.query('What is the capital of France?');
   * console.log(turn.response.text);
   * ```
   */
  query(input: string | Message): Promise<Turn>;
}

export type { GenerateResult, AgentStreamResult, AgentStrategy } from '../execution/types.ts';
