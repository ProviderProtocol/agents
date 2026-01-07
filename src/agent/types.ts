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
 * Options for creating an agent.
 * Extends LLMOptions for full UPP passthrough.
 */
export interface AgentOptions extends Partial<Omit<LLMOptions, 'model'>> {
  /** Model reference from a UPP provider factory */
  model: ModelReference;
  /** Execution strategy. Default: loop() */
  execution?: ExecutionStrategy;
  /** Ordered middleware pipeline */
  middleware?: Middleware[];
  /** Agent lifecycle hooks */
  strategy?: AgentStrategy;
  /** Checkpoint store for step-level persistence */
  checkpoints?: CheckpointStore;
  /** Session identifier for checkpointing (auto-generated if not provided) */
  sessionId?: string;
  /** @internal Pre-created LLM instance for testing */
  _llmInstance?: LLMInstance;
}

/**
 * Agent interface.
 */
export interface Agent {
  /** Unique agent identifier (UUIDv4) */
  readonly id: string;
  /** The bound model */
  readonly model: ModelReference;
  /** Available tools */
  readonly tools: Tool[];
  /** System prompt */
  readonly system?: string;

  /**
   * Execute agent and return Turn with new state.
   *
   * @param input - User input (string or Message)
   * @param state - Current immutable state
   * @returns Promise resolving to { turn, state }
   */
  generate(input: string | Message, state: AgentState): Promise<GenerateResult>;

  /**
   * Execute agent with streaming.
   *
   * @param input - User input (string or Message)
   * @param state - Current immutable state
   * @returns AgentStreamResult with async iterator and result promise
   */
  stream(input: string | Message, state: AgentState): AgentStreamResult;

  /**
   * Multi-turn execution with automatic history management.
   * Appends input to state, calls generate(), appends response to returned state.
   *
   * @param input - User input (string or Message)
   * @param state - Current immutable state
   * @returns Promise resolving to { turn, state }
   */
  ask(input: string | Message, state: AgentState): Promise<GenerateResult>;

  /**
   * Stateless single-turn execution.
   * Creates ephemeral state, executes, and discards state.
   *
   * @param input - User input (string or Message)
   * @returns Promise resolving to Turn
   */
  query(input: string | Message): Promise<Turn>;
}

export type { GenerateResult, AgentStreamResult, AgentStrategy } from '../execution/types.ts';
