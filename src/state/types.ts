import type { Message, MessageMetadata } from '@providerprotocol/ai';

/**
 * Status of a plan step during execution.
 */
export type PlanStepStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

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

  /** Return new state with message added */
  withMessage(message: Message): AgentStateInterface;
  /** Return new state with messages added */
  withMessages(messages: Message[]): AgentStateInterface;
  /** Return new state with updated step */
  withStep(step: number): AgentStateInterface;
  /** Return new state with metadata entry */
  withMetadata(key: string, value: unknown): AgentStateInterface;
  /** Return new state with reasoning added */
  withReasoning(reasoning: string): AgentStateInterface;
  /** Return new state with plan set */
  withPlan(plan: PlanStep[]): AgentStateInterface;
  /** Serialize to JSON */
  toJSON(): AgentStateJSON;
}

/** UAP version for serialization */
export const UAP_VERSION = '1.0.0';
