import type {
  Message,
  UserContent,
  AssistantContent,
  ToolCall,
  ToolResult,
} from '@providerprotocol/ai';
import {
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  isUserMessage,
  isAssistantMessage,
  isToolResultMessage,
} from '@providerprotocol/ai';
import { generateUUID } from '../utils/uuid.ts';
import type {
  AgentStateInterface,
  AgentStateJSON,
  PlanStep,
  MessageJSON,
  SubagentExecutionTrace,
} from './types.ts';
import { UAP_VERSION } from './types.ts';

/**
 * Immutable agent state container for tracking execution context.
 *
 * AgentState captures the complete execution state of an agent at any point in time,
 * including conversation history, execution metadata, reasoning traces, and sub-agent
 * execution records. All operations return new instances, leaving the original state
 * unchanged.
 *
 * @remarks
 * The immutable design enables:
 * - Safe concurrent access without locks
 * - Easy state rollback and history tracking
 * - Predictable debugging with state snapshots
 * - Simple serialization for checkpointing
 *
 * Each state transition generates a new UUID to uniquely identify the snapshot.
 *
 * @example
 * ```typescript
 * // Create initial state
 * const state = AgentState.initial();
 *
 * // Add messages immutably
 * const state2 = state.withMessage(new UserMessage('Hello'));
 * const state3 = state2.withMessage(new AssistantMessage('Hi there!'));
 *
 * // Add reasoning traces
 * const state4 = state3.withReasoning('User greeted me, responding politely.');
 *
 * // Serialize for persistence
 * const json = state4.toJSON();
 * const restored = AgentState.fromJSON(json);
 * ```
 *
 * @see {@link AgentStateInterface} for the interface contract
 * @see {@link AgentStateJSON} for the serialization format
 */
export class AgentState implements AgentStateInterface {
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

  /** Execution plan for Plan-strategy agents */
  readonly plan: readonly PlanStep[] | undefined;

  /** Sub-agent execution traces per UAP spec Section 8.8 */
  readonly subagentTraces: readonly SubagentExecutionTrace[];

  /**
   * Private constructor to enforce creation through factory methods.
   *
   * @param id - Unique state snapshot identifier
   * @param messages - Conversation message history
   * @param step - Current execution step number
   * @param metadata - User-defined metadata
   * @param reasoning - Reasoning trace entries
   * @param plan - Execution plan steps
   * @param subagentTraces - Sub-agent execution traces
   */
  private constructor(
    id: string,
    messages: readonly Message[],
    step: number,
    metadata: Readonly<Record<string, unknown>>,
    reasoning: readonly string[],
    plan: readonly PlanStep[] | undefined,
    subagentTraces: readonly SubagentExecutionTrace[],
  ) {
    this.id = id;
    this.messages = messages;
    this.step = step;
    this.metadata = metadata;
    this.reasoning = reasoning;
    this.plan = plan;
    this.subagentTraces = subagentTraces;
  }

  /**
   * Creates a fresh initial state with no history.
   *
   * Use this to start a new agent execution session with empty
   * messages, metadata, and traces.
   *
   * @returns A new AgentState with default empty values
   *
   * @example
   * ```typescript
   * const state = AgentState.initial();
   * console.log(state.messages.length); // 0
   * console.log(state.step); // 0
   * ```
   */
  static initial(): AgentState {
    return new AgentState(
      generateUUID(),
      [],
      0,
      {},
      [],
      undefined,
      [],
    );
  }

  /**
   * Creates a new state with a single message appended.
   *
   * @param message - The UPP Message to add to the conversation history
   * @returns A new AgentState with the message appended
   *
   * @example
   * ```typescript
   * const state = AgentState.initial();
   * const updated = state.withMessage(new UserMessage('What is 2+2?'));
   * console.log(updated.messages.length); // 1
   * ```
   */
  withMessage(message: Message): AgentState {
    return new AgentState(
      generateUUID(),
      [...this.messages, message],
      this.step,
      this.metadata,
      this.reasoning,
      this.plan,
      this.subagentTraces,
    );
  }

  /**
   * Creates a new state with multiple messages appended.
   *
   * Useful for adding a complete turn (e.g., user message + assistant response)
   * in a single operation.
   *
   * @param messages - Array of UPP Messages to append
   * @returns A new AgentState with all messages appended
   *
   * @example
   * ```typescript
   * const state = AgentState.initial();
   * const updated = state.withMessages([
   *   new UserMessage('Hello'),
   *   new AssistantMessage('Hi! How can I help?')
   * ]);
   * console.log(updated.messages.length); // 2
   * ```
   */
  withMessages(messages: Message[]): AgentState {
    return new AgentState(
      generateUUID(),
      [...this.messages, ...messages],
      this.step,
      this.metadata,
      this.reasoning,
      this.plan,
      this.subagentTraces,
    );
  }

  /**
   * Creates a new state with the entire message context replaced.
   *
   * Use this for context window management operations such as:
   * - Pruning old messages to stay within token limits
   * - Replacing history with a summarized version
   * - Implementing sliding window contexts
   *
   * @param messages - The new complete message history
   * @returns A new AgentState with the replaced context
   *
   * @example
   * ```typescript
   * // Prune to last 10 messages
   * const pruned = state.withContext(state.messages.slice(-10));
   *
   * // Replace with summarized context
   * const summary = new AssistantMessage('Previous discussion summary...');
   * const summarized = state.withContext([summary, ...recentMessages]);
   * ```
   */
  withContext(messages: Message[]): AgentState {
    return new AgentState(
      generateUUID(),
      [...messages],
      this.step,
      this.metadata,
      this.reasoning,
      this.plan,
      this.subagentTraces,
    );
  }

  /**
   * Creates a new state with an updated step number.
   *
   * The step number tracks the agent's position in its execution lifecycle,
   * useful for progress tracking and debugging.
   *
   * @param step - The new step number
   * @returns A new AgentState with the updated step
   *
   * @example
   * ```typescript
   * const state = AgentState.initial();
   * const afterStep1 = state.withStep(1);
   * const afterStep2 = afterStep1.withStep(2);
   * console.log(afterStep2.step); // 2
   * ```
   */
  withStep(step: number): AgentState {
    return new AgentState(
      generateUUID(),
      this.messages,
      step,
      this.metadata,
      this.reasoning,
      this.plan,
      this.subagentTraces,
    );
  }

  /**
   * Creates a new state with a metadata entry added or updated.
   *
   * Use metadata to store arbitrary application-specific data that should
   * persist with the agent state, such as user preferences, session info,
   * or custom tracking data.
   *
   * @param key - The metadata key
   * @param value - The value to store (must be JSON-serializable)
   * @returns A new AgentState with the updated metadata
   *
   * @example
   * ```typescript
   * const state = AgentState.initial()
   *   .withMetadata('userId', 'user-123')
   *   .withMetadata('sessionStart', Date.now());
   *
   * console.log(state.metadata.userId); // 'user-123'
   * ```
   */
  withMetadata(key: string, value: unknown): AgentState {
    return new AgentState(
      generateUUID(),
      this.messages,
      this.step,
      { ...this.metadata, [key]: value },
      this.reasoning,
      this.plan,
      this.subagentTraces,
    );
  }

  /**
   * Creates a new state with a reasoning trace appended.
   *
   * Reasoning traces capture the agent's internal thought process during
   * ReAct-style execution, enabling debugging and explainability.
   *
   * @param reasoning - The reasoning trace entry to add
   * @returns A new AgentState with the reasoning appended
   *
   * @example
   * ```typescript
   * const state = AgentState.initial()
   *   .withReasoning('User asked about weather, need to call weather API')
   *   .withReasoning('Weather API returned sunny, 72F');
   *
   * console.log(state.reasoning);
   * // ['User asked about weather...', 'Weather API returned...']
   * ```
   */
  withReasoning(reasoning: string): AgentState {
    return new AgentState(
      generateUUID(),
      this.messages,
      this.step,
      this.metadata,
      [...this.reasoning, reasoning],
      this.plan,
      this.subagentTraces,
    );
  }

  /**
   * Creates a new state with the execution plan set.
   *
   * Used by Plan-strategy agents to store their decomposed task plan.
   * The plan is copied to ensure immutability.
   *
   * @param plan - Array of plan steps defining the execution strategy
   * @returns A new AgentState with the plan set
   *
   * @example
   * ```typescript
   * const plan: PlanStep[] = [
   *   { id: 'step-1', description: 'Research topic', dependsOn: [], status: 'pending' },
   *   { id: 'step-2', description: 'Write outline', dependsOn: ['step-1'], status: 'pending' }
   * ];
   * const state = AgentState.initial().withPlan(plan);
   * ```
   *
   * @see {@link PlanStep} for the plan step structure
   */
  withPlan(plan: PlanStep[]): AgentState {
    return new AgentState(
      generateUUID(),
      this.messages,
      this.step,
      this.metadata,
      this.reasoning,
      [...plan],
      this.subagentTraces,
    );
  }

  /**
   * Creates a new state with a sub-agent execution trace appended.
   *
   * Records the execution details of a sub-agent spawned by the parent agent,
   * enabling hierarchical debugging and audit trails.
   *
   * @remarks
   * Conforms to UAP specification Section 8.8 for sub-agent tracing.
   *
   * @param trace - The sub-agent execution trace to record
   * @returns A new AgentState with the trace appended
   *
   * @example
   * ```typescript
   * const trace: SubagentExecutionTrace = {
   *   subagentId: 'sub-123',
   *   subagentType: 'researcher',
   *   parentToolCallId: 'call-456',
   *   prompt: 'Find information about...',
   *   startTime: Date.now() - 5000,
   *   endTime: Date.now(),
   *   success: true,
   *   result: 'Found the following...'
   * };
   * const updated = state.withSubagentTrace(trace);
   * ```
   *
   * @see {@link SubagentExecutionTrace} for the trace structure
   */
  withSubagentTrace(trace: SubagentExecutionTrace): AgentState {
    return new AgentState(
      generateUUID(),
      this.messages,
      this.step,
      this.metadata,
      this.reasoning,
      this.plan,
      [...this.subagentTraces, trace],
    );
  }

  /**
   * Serializes the state to JSON for persistence or transport.
   *
   * The output includes a version identifier for forward compatibility
   * and can be restored using {@link AgentState.fromJSON}.
   *
   * @returns A JSON-serializable representation of the complete state
   *
   * @example
   * ```typescript
   * const state = AgentState.initial().withMessage(new UserMessage('Hello'));
   * const json = state.toJSON();
   *
   * // Persist to storage
   * await Bun.write('checkpoint.json', JSON.stringify(json));
   * ```
   *
   * @see {@link AgentStateJSON} for the serialization format
   * @see {@link AgentState.fromJSON} for deserialization
   */
  toJSON(): AgentStateJSON {
    return {
      version: UAP_VERSION,
      id: this.id,
      messages: this.messages.map((msg) => serializeMessage(msg)),
      step: this.step,
      metadata: { ...this.metadata },
      reasoning: [...this.reasoning],
      plan: this.plan ? this.plan.map((s) => ({ ...s })) : undefined,
      subagentTraces: this.subagentTraces.length > 0
        ? this.subagentTraces.map((t) => ({ ...t }))
        : undefined,
    };
  }

  /**
   * Restores an AgentState from its JSON representation.
   *
   * Validates the UAP version and reconstructs all message types
   * to their proper UPP Message class instances.
   *
   * @param json - The serialized state from {@link AgentState.toJSON}
   * @returns A fully hydrated AgentState instance
   * @throws Error if the UAP version is unsupported
   *
   * @example
   * ```typescript
   * // Load from storage
   * const file = await Bun.file('checkpoint.json').text();
   * const json = JSON.parse(file) as AgentStateJSON;
   * const state = AgentState.fromJSON(json);
   *
   * console.log(state.messages.length);
   * ```
   *
   * @see {@link AgentStateJSON} for the expected format
   * @see {@link AgentState.toJSON} for serialization
   */
  static fromJSON(json: AgentStateJSON): AgentState {
    if (json.version !== UAP_VERSION) {
      throw new Error(`Unsupported UAP version: ${json.version}. Expected: ${UAP_VERSION}`);
    }

    return new AgentState(
      json.id,
      json.messages.map((msg) => deserializeMessage(msg)),
      json.step,
      json.metadata,
      json.reasoning,
      json.plan ? json.plan.map((s) => ({ ...s })) : undefined,
      json.subagentTraces ? json.subagentTraces.map((t) => ({ ...t })) : [],
    );
  }
}

/**
 * Serializes a UPP Message to its JSON representation.
 *
 * Converts the class-based message instances to plain objects suitable
 * for JSON serialization while preserving the message structure.
 *
 * @param message - The UPP Message to serialize
 * @returns A plain object representation of the message
 * @throws Error if the message type is unrecognized
 *
 * @internal
 */
function serializeMessage(message: Message): MessageJSON {
  if (isUserMessage(message)) {
    return {
      role: 'user',
      content: message.content,
      metadata: message.metadata,
    };
  }
  if (isAssistantMessage(message)) {
    return {
      role: 'assistant',
      content: {
        content: message.content,
        toolCalls: message.toolCalls,
      },
      metadata: message.metadata,
    };
  }
  if (isToolResultMessage(message)) {
    return {
      role: 'tool_result',
      content: message.results,
      metadata: message.metadata,
    };
  }
  throw new Error(`Unknown message type: ${typeof message}`);
}

/**
 * Deserializes a JSON message back to its UPP Message class instance.
 *
 * Reconstructs the proper message class (UserMessage, AssistantMessage,
 * or ToolResultMessage) from the serialized representation.
 *
 * @param json - The serialized message object
 * @returns The hydrated UPP Message instance
 * @throws Error if the message role is unrecognized
 *
 * @internal
 */
function deserializeMessage(json: MessageJSON): Message {
  switch (json.role) {
    case 'user':
      return new UserMessage(
        json.content as string | UserContent[],
        { metadata: json.metadata },
      );
    case 'assistant': {
      const assistantContent = json.content as {
        content: string | AssistantContent[];
        toolCalls?: ToolCall[];
      };
      return new AssistantMessage(
        assistantContent.content,
        assistantContent.toolCalls,
        { metadata: json.metadata },
      );
    }
    case 'tool_result':
      return new ToolResultMessage(
        json.content as ToolResult[],
        { metadata: json.metadata },
      );
    default:
      throw new Error(`Unknown message role: ${json.role}`);
  }
}

export type {
  AgentStateInterface,
  AgentStateJSON,
  PlanStep,
  PlanStepStatus,
  SubagentExecutionTrace,
  SubagentExecutionTraceJSON,
  ToolExecutionTrace,
} from './types.ts';
