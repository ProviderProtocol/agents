import type { Message, MessageMetadata, TokenUsage } from '@providerprotocol/ai';

/**
 * Status of a plan step during execution.
 */
export type PlanStepStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

/**
 * A single tool execution trace from a sub-agent.
 * Per UAP spec Section 8.8.
 */
export interface ToolExecutionTrace {
  /** Name of the tool */
  toolName: string;
  /** Tool call ID */
  toolCallId?: string;
  /** Arguments passed to the tool */
  arguments: Record<string, unknown>;
  /** Tool result */
  result: string;
  /** Whether the tool errored */
  isError?: boolean;
  /** Execution time in milliseconds */
  duration?: number;
}

/**
 * Sub-agent execution trace for checkpoint persistence.
 * Per UAP spec Section 8.8.
 */
export interface SubagentExecutionTrace {
  /** Unique ID of the sub-agent instance */
  subagentId: string;
  /** Type/name of the sub-agent */
  subagentType: string;
  /** Tool call ID that spawned this sub-agent */
  parentToolCallId: string;
  /** The task given to the sub-agent */
  prompt: string;
  /** Start timestamp (ms since epoch) */
  startTime: number;
  /** End timestamp (ms since epoch) */
  endTime: number;
  /** Whether execution succeeded */
  success: boolean;
  /** Sub-agent's response (if successful) */
  result?: string;
  /** Error message (if failed) */
  error?: string;
  /** Tools used by sub-agent */
  toolExecutions?: ToolExecutionTrace[];
  /** Token usage for sub-agent */
  usage?: TokenUsage;
}

/**
 * Serialized form of SubagentExecutionTrace.
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
 * A single step in an execution plan.
 */
export interface PlanStep {
  /** Unique step identifier */
  id: string;
  /** Description of what this step does */
  description: string;
  /** Tool to use (if applicable) */
  tool?: string;
  /** IDs of steps this depends on */
  dependsOn: string[];
  /** Current status */
  status: PlanStepStatus;
}

/**
 * Serialized form of a PlanStep.
 */
export interface PlanStepJSON {
  id: string;
  description: string;
  tool?: string;
  dependsOn: string[];
  status: PlanStepStatus;
}

/**
 * Serialized form of AgentState for persistence.
 */
export interface AgentStateJSON {
  /** UAP version */
  version: string;
  /** State snapshot ID */
  id: string;
  /** Serialized messages */
  messages: MessageJSON[];
  /** Current step number */
  step: number;
  /** User-defined metadata */
  metadata: Record<string, unknown>;
  /** Reasoning traces (for ReAct) */
  reasoning: string[];
  /** Execution plan (for Plan strategy) */
  plan?: PlanStepJSON[];
  /** Sub-agent execution traces (per UAP spec Section 8.8) */
  subagentTraces?: SubagentExecutionTraceJSON[];
}

/**
 * Serialized form of a Message.
 * This preserves the UPP Message structure for serialization.
 */
export interface MessageJSON {
  role: 'user' | 'assistant' | 'tool_result';
  content: unknown;
  metadata?: MessageMetadata;
}

/**
 * Interface for AgentState operations.
 * All operations return new instances (immutable).
 */
export interface AgentStateInterface {
  /** State snapshot ID (UUIDv4) */
  readonly id: string;
  /** Conversation history (UPP Messages) */
  readonly messages: readonly Message[];
  /** Current step number */
  readonly step: number;
  /** User-defined metadata */
  readonly metadata: Readonly<Record<string, unknown>>;
  /** Reasoning traces (for ReAct) */
  readonly reasoning: readonly string[];
  /** Execution plan (for Plan strategy) */
  readonly plan: readonly PlanStep[] | undefined;
  /** Sub-agent execution traces (per UAP spec Section 8.8) */
  readonly subagentTraces: readonly SubagentExecutionTrace[];

  /** Return new state with message added */
  withMessage(message: Message): AgentStateInterface;
  /** Return new state with messages added */
  withMessages(messages: Message[]): AgentStateInterface;
  /** Return new state with context replaced (all messages) */
  withContext(messages: Message[]): AgentStateInterface;
  /** Return new state with updated step */
  withStep(step: number): AgentStateInterface;
  /** Return new state with metadata entry */
  withMetadata(key: string, value: unknown): AgentStateInterface;
  /** Return new state with reasoning added */
  withReasoning(reasoning: string): AgentStateInterface;
  /** Return new state with plan set */
  withPlan(plan: PlanStep[]): AgentStateInterface;
  /** Return new state with sub-agent trace added */
  withSubagentTrace(trace: SubagentExecutionTrace): AgentStateInterface;
  /** Serialize to JSON */
  toJSON(): AgentStateJSON;
}

/** UAP version for serialization */
export const UAP_VERSION = '1.0.0';
