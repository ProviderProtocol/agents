import type {
  LLMInstance,
  Message,
  Tool,
  Turn,
  ToolCall,
  ToolExecution,
  StreamEvent,
  TokenUsage,
} from '@providerprotocol/ai';
import type { AgentState, PlanStep } from '../state/index.ts';
import type { CheckpointStore } from '../checkpoint/types.ts';

/**
 * Result of agent generation.
 */
export interface GenerateResult {
  /** Standard UPP Turn */
  turn: Turn;
  /** New immutable state */
  state: AgentState;
}

/**
 * Agent lifecycle hooks for execution control.
 */
export interface AgentStrategy {
  /** Evaluate if execution should stop */
  stopCondition?: (state: AgentState) => boolean | Promise<boolean>;
  /** Called when step begins */
  onStepStart?: (step: number, state: AgentState) => void;
  /** Called during reasoning phase (ReAct) */
  onReason?: (step: number, reasoning: string) => void;
  /** Called during action phase */
  onAct?: (step: number, actions: ToolCall[]) => void;
  /** Called during observation phase */
  onObserve?: (step: number, observations: ToolExecution[]) => void;
  /** Called when step completes */
  onStepEnd?: (step: number, result: { turn: Turn; state: AgentState }) => void;
  /** Called when execution completes */
  onComplete?: (result: GenerateResult) => void;
  /** Called on execution error */
  onError?: (error: Error, state: AgentState) => void | GenerateResult;
}

/**
 * Forward declaration of Agent for use in ExecutionContext.
 * The actual Agent interface is defined in agent/types.ts.
 */
export interface AgentRef {
  id: string;
  system?: string;
}

/**
 * Context passed to execution strategies.
 */
export interface ExecutionContext {
  /** The agent being executed */
  agent: AgentRef;
  /** The bound LLM instance */
  llm: LLMInstance;
  /** The user input message */
  input: Message;
  /** Current immutable state */
  state: AgentState;
  /** Resolved tools */
  tools: Tool[];
  /** Agent lifecycle hooks */
  strategy: AgentStrategy;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Checkpoint store for persistence (optional) */
  checkpoints?: CheckpointStore;
  /** Session ID for checkpointing */
  sessionId?: string;
}

/**
 * Result from execution strategy.
 */
export interface ExecutionResult {
  /** The complete UPP Turn */
  turn: Turn;
  /** New immutable state */
  state: AgentState;
}

/**
 * UAP-level event types for streaming.
 */
export type UAPEventType =
  | 'step_start'
  | 'step_end'
  | 'reasoning'
  | 'action'
  | 'observation'
  | 'plan_created'
  | 'plan_step_start'
  | 'plan_step_end'
  | 'subagent_start'
  | 'subagent_event'
  | 'subagent_end';

/**
 * Agent stream event - wraps both UAP and UPP events.
 */
export interface AgentStreamEvent {
  /** Event source */
  source: 'uap' | 'upp';

  /** Present when source === 'uap' */
  uap?: {
    type: UAPEventType;
    step: number;
    agentId: string;
    data: Record<string, unknown>;
  };

  /** Present when source === 'upp' */
  upp?: StreamEvent;
}

/**
 * Streaming result from agent execution.
 */
export interface AgentStreamResult {
  /** Async iterator for stream events */
  [Symbol.asyncIterator](): AsyncIterator<AgentStreamEvent>;
  /** Resolves to final result after stream completes */
  result: Promise<GenerateResult>;
  /** Abort the stream */
  abort(): void;
}

/**
 * Execution strategy interface.
 * Strategies define HOW an agent executes (loop, react, plan).
 */
export interface ExecutionStrategy {
  /** Strategy name */
  name: string;
  /** Execute the strategy */
  execute(context: ExecutionContext): Promise<ExecutionResult>;
  /** Execute with streaming */
  stream(context: ExecutionContext): AgentStreamResult;
}

/**
 * Options for loop() strategy.
 */
export interface LoopOptions {
  /** Maximum tool execution rounds. Default: Infinity */
  maxIterations?: number;
}

/**
 * Options for react() strategy.
 */
export interface ReactOptions {
  /** Maximum reason-act-observe cycles. Default: Infinity */
  maxSteps?: number;
  /** Prompt suffix for reasoning phase */
  reasoningPrompt?: string;
}

/**
 * Options for plan() strategy.
 */
export interface PlanOptions {
  /** Maximum steps in a plan. Default: Infinity */
  maxPlanSteps?: number;
  /** Allow replanning on failure. Default: true */
  allowReplan?: boolean;
  /** Schema for plan structure */
  planSchema?: Record<string, unknown>;
}

/**
 * Internal plan structure used by plan() strategy.
 */
export interface ExecutionPlan {
  steps: PlanStep[];
  currentStepIndex: number;
}

/**
 * Tool dependency options for execution ordering.
 * These extend the base UPP Tool interface with UAP-specific fields.
 *
 * @see UAP-1.0 Spec Section 8.5
 */
export interface ToolDependencyOptions {
  /**
   * If true, this tool must complete before other tools start.
   * Sequential tools create a barrier in parallel execution.
   */
  sequential?: boolean;
  /**
   * Tool names that must complete before this tool can execute.
   * Used for explicit dependency chains.
   */
  dependsOn?: string[];
}

/**
 * Extended Tool interface with UAP dependency options.
 * Use this type when defining tools that need execution ordering.
 *
 * @example
 * ```typescript
 * const readTool: ToolWithDependencies = {
 *   name: 'read_file',
 *   description: 'Read a file',
 *   parameters: { ... },
 *   sequential: true, // Must complete before other tools
 *   run: async (params) => { ... },
 * };
 *
 * const writeTool: ToolWithDependencies = {
 *   name: 'write_file',
 *   description: 'Write a file',
 *   parameters: { ... },
 *   dependsOn: ['read_file'], // Waits for read_file to complete
 *   run: async (params) => { ... },
 * };
 * ```
 */
export interface ToolWithDependencies extends Tool, ToolDependencyOptions {}

/**
 * Model-driven tool call with optional execution order hint.
 * Models MAY include an `after` field to signal dependencies.
 *
 * @see UAP-1.0 Spec Section 8.6
 */
export interface OrderedToolCall extends ToolCall {
  /** Tool call IDs that must complete before this call executes */
  after?: string[];
}

/**
 * Sub-agent event types for hierarchical agent execution.
 *
 * @see UAP-1.0 Spec Section 8.7
 */
export type SubagentEventType = 'subagent_start' | 'subagent_event' | 'subagent_end';

/**
 * Base fields present in all subagent events.
 */
export interface SubagentEventBase {
  /** Unique ID of the sub-agent instance */
  subagentId: string;
  /** Type/name of the sub-agent (e.g., "explorer", "planner") */
  subagentType: string;
  /** The parent tool call ID that spawned this sub-agent */
  parentToolCallId: string;
}

/**
 * Event emitted when a sub-agent starts execution.
 */
export interface SubagentStartEvent extends SubagentEventBase {
  type: 'subagent_start';
  /** The task/prompt given to the sub-agent */
  prompt: string;
  /** Start timestamp in milliseconds */
  timestamp: number;
}

/**
 * Event emitted for forwarded events from sub-agent execution.
 */
export interface SubagentInnerEvent extends SubagentEventBase {
  type: 'subagent_event';
  /** The actual event from the sub-agent */
  innerEvent: AgentStreamEvent;
}

/**
 * Event emitted when a sub-agent completes execution.
 */
export interface SubagentEndEvent extends SubagentEventBase {
  type: 'subagent_end';
  /** Whether the sub-agent completed successfully */
  success: boolean;
  /** Sub-agent's response text (if successful) */
  result?: string;
  /** Error message (if failed) */
  error?: string;
  /** End timestamp in milliseconds */
  timestamp: number;
  /** Tools used by the sub-agent */
  toolExecutions?: Array<{
    toolName: string;
    arguments: Record<string, unknown>;
    result: string;
  }>;
  /** Token usage for this sub-agent run */
  usage?: TokenUsage;
}

/**
 * Union type for all sub-agent events.
 *
 * @see UAP-1.0 Spec Section 8.7
 */
export type SubagentEvent = SubagentStartEvent | SubagentInnerEvent | SubagentEndEvent;

/**
 * Callback type for receiving sub-agent events.
 * Tools that spawn sub-agents SHOULD accept this callback.
 */
export type OnSubagentEvent = (event: SubagentEvent) => void;

/**
 * Context injected into tools during execution.
 * Per UAP-1.0 Section 8.4, ExecutionStrategy MUST inject this context
 * when invoking tools that accept a second parameter.
 *
 * @see UAP-1.0 Spec Section 8.4
 */
export interface ToolExecutionContext {
  /** Agent instance ID */
  agentId: string;
  /** Current state snapshot ID */
  stateId: string;
  /** Tool call ID from the model response */
  toolCallId: string;
  /** Callback for sub-agent events */
  onSubagentEvent?: OnSubagentEvent;
}

/**
 * Type for a tool that accepts execution context as a second parameter.
 * Tools can optionally accept this context for sub-agent inheritance
 * and event propagation.
 *
 * @example
 * ```typescript
 * const contextAwareTool: Tool = {
 *   name: 'my_tool',
 *   description: 'Tool that uses execution context',
 *   parameters: { ... },
 *   run: async (params, context?: ToolExecutionContext) => {
 *     if (context?.onSubagentEvent) {
 *       // Can propagate sub-agent events
 *     }
 *     return 'result';
 *   },
 * };
 * ```
 */
export type ContextAwareToolRun = (
  params: Record<string, unknown>,
  context?: ToolExecutionContext,
) => Promise<unknown>;
