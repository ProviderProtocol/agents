import type { Message, MessageMetadata, TokenUsage } from '@providerprotocol/ai';

/**
 * Status of a plan step during agent execution.
 *
 * Represents the lifecycle of an individual step within an execution plan:
 * - `pending`: Step has not yet started
 * - `in_progress`: Step is currently being executed
 * - `completed`: Step finished successfully
 * - `failed`: Step encountered an error and could not complete
 */
export type PlanStepStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

/**
 * A single tool execution trace from a sub-agent.
 *
 * Captures the details of a tool invocation during sub-agent execution,
 * enabling debugging, auditing, and replay of agent behavior.
 *
 * @remarks
 * Conforms to UAP specification Section 8.8 for sub-agent tracing.
 *
 * @see {@link SubagentExecutionTrace} for the parent trace containing these records
 */
export interface ToolExecutionTrace {
  /** Name of the tool that was invoked */
  toolName: string;

  /** Unique identifier for this tool call, used for correlation with tool results */
  toolCallId?: string;

  /** Arguments passed to the tool as key-value pairs */
  arguments: Record<string, unknown>;

  /** Stringified result returned by the tool */
  result: string;

  /** Whether the tool execution resulted in an error */
  isError?: boolean;

  /** Execution duration in milliseconds */
  duration?: number;
}

/**
 * Sub-agent execution trace for checkpoint persistence and observability.
 *
 * Records the complete execution history of a sub-agent spawned by the parent agent,
 * including the task, timing, outcome, and all tool invocations. This enables
 * hierarchical agent debugging and audit trails.
 *
 * @remarks
 * Conforms to UAP specification Section 8.8 for sub-agent execution tracing.
 *
 * @example
 * ```typescript
 * const trace: SubagentExecutionTrace = {
 *   subagentId: 'sub-abc123',
 *   subagentType: 'research-agent',
 *   parentToolCallId: 'call-xyz789',
 *   prompt: 'Find information about quantum computing',
 *   startTime: Date.now(),
 *   endTime: Date.now() + 5000,
 *   success: true,
 *   result: 'Quantum computing uses qubits...',
 *   toolExecutions: [
 *     { toolName: 'web_search', arguments: { query: 'quantum computing' }, result: '...' }
 *   ],
 *   usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 }
 * };
 * ```
 *
 * @see {@link ToolExecutionTrace} for individual tool execution records
 */
export interface SubagentExecutionTrace {
  /** Unique identifier for this sub-agent instance */
  subagentId: string;

  /** Type or name identifying the sub-agent's role or capabilities */
  subagentType: string;

  /** Tool call ID from the parent agent that spawned this sub-agent */
  parentToolCallId: string;

  /** The task or prompt given to the sub-agent */
  prompt: string;

  /** Execution start timestamp in milliseconds since Unix epoch */
  startTime: number;

  /** Execution end timestamp in milliseconds since Unix epoch */
  endTime: number;

  /** Whether the sub-agent completed its task successfully */
  success: boolean;

  /** The sub-agent's final response (present when `success` is true) */
  result?: string;

  /** Error message describing what went wrong (present when `success` is false) */
  error?: string;

  /** Ordered list of tool executions performed by the sub-agent */
  toolExecutions?: ToolExecutionTrace[];

  /** Token usage statistics for the sub-agent's LLM calls */
  usage?: TokenUsage;
}

/**
 * JSON-serializable form of {@link SubagentExecutionTrace}.
 *
 * Used for persisting sub-agent traces to storage and transmitting
 * them across process boundaries.
 */
export interface SubagentExecutionTraceJSON {
  subagentId: string;
  subagentType: string;
  parentToolCallId: string;
  prompt: string;
  startTime: number;
  endTime: number;
  success: boolean;
  result?: string;
  error?: string;
  toolExecutions?: ToolExecutionTrace[];
  usage?: TokenUsage;
}

/**
 * A single step in an agent's execution plan.
 *
 * Represents a discrete unit of work within a larger plan, supporting
 * dependency tracking for proper execution ordering. Used by the Plan
 * execution strategy to decompose complex tasks.
 *
 * @example
 * ```typescript
 * const steps: PlanStep[] = [
 *   {
 *     id: 'step-1',
 *     description: 'Search for relevant files',
 *     tool: 'file_search',
 *     dependsOn: [],
 *     status: 'completed'
 *   },
 *   {
 *     id: 'step-2',
 *     description: 'Analyze file contents',
 *     tool: 'read_file',
 *     dependsOn: ['step-1'],
 *     status: 'pending'
 *   }
 * ];
 * ```
 */
export interface PlanStep {
  /** Unique identifier for this step within the plan */
  id: string;

  /** Human-readable description of what this step accomplishes */
  description: string;

  /** Name of the tool to invoke for this step (if applicable) */
  tool?: string;

  /** IDs of steps that must complete before this step can execute */
  dependsOn: string[];

  /** Current execution status of this step */
  status: PlanStepStatus;
}

/**
 * JSON-serializable form of {@link PlanStep}.
 *
 * Used for persisting execution plans to storage.
 */
export interface PlanStepJSON {
  id: string;
  description: string;
  tool?: string;
  dependsOn: string[];
  status: PlanStepStatus;
}

/**
 * JSON-serializable form of {@link AgentState} for persistence.
 *
 * Captures the complete state of an agent at a point in time, enabling
 * checkpointing, recovery, and debugging. The version field ensures
 * forward compatibility as the schema evolves.
 *
 * @remarks
 * The `version` field follows semantic versioning and must match
 * {@link UAP_VERSION} for successful deserialization.
 *
 * @see {@link AgentStateInterface} for the runtime representation
 */
export interface AgentStateJSON {
  /** UAP version string for schema compatibility checking */
  version: string;

  /** Unique identifier for this state snapshot */
  id: string;

  /** Serialized conversation messages */
  messages: MessageJSON[];

  /** Current step number in the agent's execution */
  step: number;

  /** User-defined metadata attached to the state */
  metadata: Record<string, unknown>;

  /** Reasoning traces captured during ReAct-style execution */
  reasoning: string[];

  /** Execution plan for Plan-strategy agents */
  plan?: PlanStepJSON[];

  /** Sub-agent execution traces per UAP spec Section 8.8 */
  subagentTraces?: SubagentExecutionTraceJSON[];
}

/**
 * JSON-serializable form of a UPP Message.
 *
 * Preserves the essential structure of messages from the providerprotocol/ai
 * library while enabling JSON serialization for persistence and transport.
 *
 * @remarks
 * The `content` field is typed as `unknown` because it varies by role:
 * - `user`: string or UserContent[]
 * - `assistant`: object with content and optional toolCalls
 * - `tool_result`: ToolResult[]
 */
export interface MessageJSON {
  /** Message role indicating the sender */
  role: 'user' | 'assistant' | 'tool_result';

  /** Role-specific message content (structure varies by role) */
  content: unknown;

  /** Optional metadata attached to the message */
  metadata?: MessageMetadata;
}

/**
 * Interface defining the contract for agent state operations.
 *
 * All methods follow immutable patterns, returning new state instances
 * rather than mutating the existing state. This enables safe state
 * management, easy rollback, and predictable behavior.
 *
 * @remarks
 * Implementations should ensure thread-safety by never mutating
 * internal data structures.
 *
 * @see {@link AgentState} for the concrete implementation
 */
export interface AgentStateInterface {
  /** Unique identifier for this state snapshot (UUIDv4) */
  readonly id: string;

  /** Immutable conversation history containing UPP Messages */
  readonly messages: readonly Message[];

  /** Current step number in the agent's execution lifecycle */
  readonly step: number;

  /** User-defined metadata for storing arbitrary state */
  readonly metadata: Readonly<Record<string, unknown>>;

  /** Reasoning traces captured during ReAct-style execution */
  readonly reasoning: readonly string[];

  /** Execution plan for Plan-strategy agents (undefined if not using Plan strategy) */
  readonly plan: readonly PlanStep[] | undefined;

  /** Sub-agent execution traces per UAP spec Section 8.8 */
  readonly subagentTraces: readonly SubagentExecutionTrace[];

  /**
   * Creates a new state with the given message appended.
   *
   * @param message - The message to add to the conversation history
   * @returns A new AgentState instance with the message appended
   */
  withMessage(message: Message): AgentStateInterface;

  /**
   * Creates a new state with multiple messages appended.
   *
   * @param messages - The messages to add to the conversation history
   * @returns A new AgentState instance with all messages appended
   */
  withMessages(messages: Message[]): AgentStateInterface;

  /**
   * Creates a new state with the entire message context replaced.
   *
   * @remarks
   * Use this for context window management operations like pruning
   * or summarization, where you need to replace the entire history.
   *
   * @param messages - The new complete message history
   * @returns A new AgentState instance with the replaced context
   */
  withContext(messages: Message[]): AgentStateInterface;

  /**
   * Creates a new state with an updated step number.
   *
   * @param step - The new step number
   * @returns A new AgentState instance with the updated step
   */
  withStep(step: number): AgentStateInterface;

  /**
   * Creates a new state with a metadata entry added or updated.
   *
   * @param key - The metadata key
   * @param value - The value to store
   * @returns A new AgentState instance with the updated metadata
   */
  withMetadata(key: string, value: unknown): AgentStateInterface;

  /**
   * Creates a new state with a reasoning trace appended.
   *
   * @param reasoning - The reasoning trace to add
   * @returns A new AgentState instance with the reasoning appended
   */
  withReasoning(reasoning: string): AgentStateInterface;

  /**
   * Creates a new state with the execution plan set.
   *
   * @param plan - The execution plan steps
   * @returns A new AgentState instance with the plan set
   */
  withPlan(plan: PlanStep[]): AgentStateInterface;

  /**
   * Creates a new state with a sub-agent execution trace appended.
   *
   * @param trace - The sub-agent execution trace to add
   * @returns A new AgentState instance with the trace appended
   */
  withSubagentTrace(trace: SubagentExecutionTrace): AgentStateInterface;

  /**
   * Serializes the state to JSON for persistence.
   *
   * @returns A JSON-serializable representation of the state
   */
  toJSON(): AgentStateJSON;
}

/**
 * Current UAP (Unified Agent Protocol) version for serialization compatibility.
 *
 * This version string is embedded in serialized state to ensure that
 * deserialization uses a compatible schema.
 */
export const UAP_VERSION = '1.0.0';
