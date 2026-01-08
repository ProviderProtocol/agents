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
 * Result of agent generation containing the conversation turn and updated state.
 *
 * This is the primary return type from agent execution methods. It combines
 * the standard UPP Turn (which contains the model's response and token usage)
 * with the UAP AgentState (which tracks the full execution context).
 *
 * @example
 * ```typescript
 * const result = await agent.generate('What is the weather?');
 * console.log(result.turn.response.text); // Model's response
 * console.log(result.state.currentStep);  // Execution step count
 * ```
 */
export interface GenerateResult {
  /** Standard UPP Turn containing the model response, messages, and token usage */
  turn: Turn;
  /** New immutable state reflecting all changes from this generation */
  state: AgentState;
}

/**
 * Agent lifecycle hooks for execution control and observability.
 *
 * Strategies allow fine-grained control over agent execution by providing
 * callbacks at key points in the execution lifecycle. All hooks are optional
 * and can be sync or async where indicated.
 *
 * @remarks
 * Hooks are called in order: onStepStart -> onReason (if ReAct) -> onAct -> onObserve -> onStepEnd.
 * The stopCondition is evaluated after each step to determine if execution should halt.
 *
 * @example
 * ```typescript
 * const strategy: AgentStrategy = {
 *   stopCondition: (state) => state.currentStep >= 5,
 *   onStepStart: (step, state) => console.log(`Step ${step} starting`),
 *   onAct: (step, actions) => console.log(`${actions.length} tool calls`),
 *   onComplete: (result) => console.log(`Done: ${result.turn.response.text}`),
 * };
 * ```
 */
export interface AgentStrategy {
  /**
   * Evaluate whether execution should stop after the current step.
   * @param state - The current agent state after step completion
   * @returns true to stop execution, false to continue
   */
  stopCondition?: (state: AgentState) => boolean | Promise<boolean>;

  /**
   * Called when a step begins, before any LLM calls.
   * @param step - The 1-indexed step number
   * @param state - The current agent state at step start
   */
  onStepStart?: (step: number, state: AgentState) => void;

  /**
   * Called during the reasoning phase (ReAct strategy only).
   * @param step - The current step number
   * @param reasoning - The model's reasoning output text
   */
  onReason?: (step: number, reasoning: string) => void;

  /**
   * Called during the action phase when tool calls are made.
   * @param step - The current step number
   * @param actions - Array of tool calls the model wants to execute
   */
  onAct?: (step: number, actions: ToolCall[]) => void;

  /**
   * Called during the observation phase after tools execute.
   * @param step - The current step number
   * @param observations - Array of tool execution results
   */
  onObserve?: (step: number, observations: ToolExecution[]) => void;

  /**
   * Called when a step completes, after all tool executions.
   * @param step - The completed step number
   * @param result - Object containing the turn and updated state
   */
  onStepEnd?: (step: number, result: { turn: Turn; state: AgentState }) => void;

  /**
   * Called when execution completes successfully.
   * @param result - The final generation result
   */
  onComplete?: (result: GenerateResult) => void;

  /**
   * Called when an error occurs during execution.
   * Can optionally return a fallback result to recover from the error.
   * @param error - The error that occurred
   * @param state - The agent state at the time of the error
   * @returns Optional fallback result to use instead of throwing
   */
  onError?: (error: Error, state: AgentState) => void | GenerateResult;
}

/**
 * Forward declaration of Agent for use in ExecutionContext.
 *
 * This minimal interface provides the essential agent identification fields
 * needed by execution strategies without creating circular dependencies.
 * The full Agent interface is defined in agent/types.ts.
 */
export interface AgentRef {
  /** Unique identifier for the agent instance */
  id: string;
  /** Optional system prompt for the agent */
  system?: string;
}

/**
 * Context passed to execution strategies containing all resources needed for execution.
 *
 * The ExecutionContext bundles together the agent reference, LLM instance,
 * input message, current state, tools, and hooks. Execution strategies use
 * this context to perform their work without needing direct access to the
 * Agent instance.
 *
 * @remarks
 * The context is immutable - strategies should use `state.with*()` methods
 * to create new state snapshots rather than mutating the provided state.
 *
 * @example
 * ```typescript
 * // ExecutionContext is created internally by the Agent
 * const context: ExecutionContext = {
 *   agent: { id: 'agent-123', system: 'You are helpful.' },
 *   llm: llmInstance,
 *   input: new UserMessage('Hello'),
 *   state: AgentState.create(),
 *   tools: [weatherTool, searchTool],
 *   strategy: { maxIterations: 5 },
 * };
 *
 * const result = await strategy.execute(context);
 * ```
 */
export interface ExecutionContext {
  /** The agent being executed (minimal reference) */
  agent: AgentRef;
  /** The bound LLM instance configured for this agent */
  llm: LLMInstance;
  /** The user input message to process */
  input: Message;
  /** Current immutable state snapshot */
  state: AgentState;
  /** Resolved tools available for this execution */
  tools: Tool[];
  /** Agent lifecycle hooks for observability and control */
  strategy: AgentStrategy;
  /** Abort signal for cancellation support */
  signal?: AbortSignal;
  /** Checkpoint store for state persistence (optional) */
  checkpoints?: CheckpointStore;
  /** Session ID for checkpointing continuity */
  sessionId?: string;
}

/**
 * Result from an execution strategy containing the turn and final state.
 *
 * This is the internal result type used by execution strategies.
 * It is identical to GenerateResult but named separately for clarity
 * in the strategy interface.
 */
export interface ExecutionResult {
  /** The complete UPP Turn from the final LLM response */
  turn: Turn;
  /** New immutable state after execution completes */
  state: AgentState;
}

/**
 * UAP-level event types emitted during agent streaming execution.
 *
 * These events provide high-level visibility into the agent execution
 * lifecycle, complementing the lower-level UPP stream events.
 *
 * @remarks
 * - `step_start` / `step_end` - Bracket each execution step
 * - `reasoning` - Emitted during ReAct strategy reasoning phase
 * - `action` - Emitted when tool calls are made
 * - `observation` - Emitted when tool results are received
 * - `plan_*` - Emitted during Plan strategy planning and execution
 * - `subagent_*` - Emitted for hierarchical agent execution
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
 * Agent stream event that wraps both UAP and UPP events.
 *
 * During streaming execution, events from two sources are emitted:
 * - `uap`: High-level agent lifecycle events (step start/end, reasoning, etc.)
 * - `upp`: Low-level LLM stream events (text deltas, tool call deltas, etc.)
 *
 * @example
 * ```typescript
 * const stream = agent.stream('Count to 5');
 *
 * for await (const event of stream) {
 *   if (event.source === 'uap') {
 *     console.log(`Agent event: ${event.uap?.type}`);
 *   } else if (event.source === 'upp') {
 *     if (event.upp?.type === 'text_delta') {
 *       process.stdout.write(event.upp.delta.text ?? '');
 *     }
 *   }
 * }
 * ```
 */
export interface AgentStreamEvent {
  /** Event source: 'uap' for agent-level, 'upp' for LLM-level */
  source: 'uap' | 'upp';

  /** Present when source === 'uap' - contains agent lifecycle event data */
  uap?: {
    /** The type of UAP event */
    type: UAPEventType;
    /** The current step number (1-indexed) */
    step: number;
    /** The agent ID emitting this event */
    agentId: string;
    /** Event-specific data payload */
    data: Record<string, unknown>;
  };

  /** Present when source === 'upp' - contains LLM stream event */
  upp?: StreamEvent;
}

/**
 * Streaming result from agent execution providing async iteration and final result access.
 *
 * AgentStreamResult implements the async iterator protocol for consuming
 * stream events, provides a promise for the final result, and includes
 * an abort method for cancellation.
 *
 * @example
 * ```typescript
 * const stream = agent.stream('What is 2+2?');
 *
 * // Consume events as they arrive
 * for await (const event of stream) {
 *   handleEvent(event);
 * }
 *
 * // Get the final result after stream completes
 * const result = await stream.result;
 * console.log(result.turn.response.text);
 *
 * // Or abort early
 * stream.abort();
 * ```
 */
export interface AgentStreamResult {
  /** Async iterator for consuming stream events */
  [Symbol.asyncIterator](): AsyncIterator<AgentStreamEvent>;
  /** Promise that resolves to the final result after stream completes */
  result: Promise<GenerateResult>;
  /** Abort the stream and cancel execution */
  abort(): void;
}

/**
 * Execution strategy interface defining how an agent executes.
 *
 * Strategies encapsulate the execution pattern (loop, react, plan) and
 * provide both synchronous and streaming execution methods. Each strategy
 * implements a different approach to orchestrating LLM calls and tool use.
 *
 * @remarks
 * Built-in strategies:
 * - `loop()` - Simple tool loop, equivalent to UPP's native behavior
 * - `react()` - Reason-Act-Observe cycle with explicit reasoning steps
 * - `plan()` - Plan-then-execute with structured step dependencies
 *
 * @example
 * ```typescript
 * // Create a custom strategy
 * const myStrategy: ExecutionStrategy = {
 *   name: 'custom',
 *   async execute(context) {
 *     // Custom execution logic
 *     return { turn, state };
 *   },
 *   stream(context) {
 *     // Custom streaming logic
 *     return { [Symbol.asyncIterator]() { ... }, result, abort };
 *   },
 * };
 * ```
 */
export interface ExecutionStrategy {
  /** Unique name identifying this strategy (e.g., 'loop', 'react', 'plan') */
  name: string;

  /**
   * Execute the strategy synchronously (non-streaming).
   * @param context - The execution context with all required resources
   * @returns Promise resolving to the execution result
   */
  execute(context: ExecutionContext): Promise<ExecutionResult>;

  /**
   * Execute the strategy with streaming support.
   * @param context - The execution context with all required resources
   * @returns AgentStreamResult for async iteration and final result
   */
  stream(context: ExecutionContext): AgentStreamResult;
}

/**
 * Configuration options for the loop execution strategy.
 *
 * The loop strategy is the simplest execution pattern, equivalent to
 * the native tool loop behavior in UPP. It sends input to the LLM,
 * executes any tool calls, and repeats until no more tools are called.
 *
 * @example
 * ```typescript
 * const agent = createAgent({
 *   // ... other config
 *   strategy: loop({ maxIterations: 5 }),
 * });
 * ```
 */
export interface LoopOptions {
  /**
   * Maximum number of tool execution rounds before stopping.
   * @defaultValue Infinity (no limit)
   */
  maxIterations?: number;
}

/**
 * Configuration options for the ReAct execution strategy.
 *
 * The ReAct (Reason-Act-Observe) strategy adds an explicit reasoning
 * phase before each action, improving the model's decision-making
 * by encouraging step-by-step thinking.
 *
 * @see https://arxiv.org/abs/2210.03629 - ReAct: Synergizing Reasoning and Acting
 *
 * @example
 * ```typescript
 * const agent = createAgent({
 *   // ... other config
 *   strategy: react({
 *     maxSteps: 10,
 *     reasoningPrompt: 'Think carefully about what to do next.',
 *   }),
 * });
 * ```
 */
export interface ReactOptions {
  /**
   * Maximum number of reason-act-observe cycles before stopping.
   * @defaultValue Infinity (no limit)
   */
  maxSteps?: number;

  /**
   * Custom prompt appended to trigger the reasoning phase.
   * @defaultValue 'Think step by step about what you need to do next...'
   */
  reasoningPrompt?: string;
}

/**
 * Configuration options for the plan execution strategy.
 *
 * The plan strategy first generates a structured execution plan with
 * dependencies between steps, then executes each step in topological
 * order. This is useful for complex multi-step tasks.
 *
 * @example
 * ```typescript
 * const agent = createAgent({
 *   // ... other config
 *   strategy: plan({
 *     maxPlanSteps: 10,
 *     allowReplan: true,
 *   }),
 * });
 * ```
 */
export interface PlanOptions {
  /**
   * Maximum number of steps allowed in the generated plan.
   * @defaultValue Infinity (no limit)
   */
  maxPlanSteps?: number;

  /**
   * Whether to allow replanning when a step fails.
   * @defaultValue true
   */
  allowReplan?: boolean;

  /**
   * JSON Schema for validating the plan structure.
   * Override to customize the expected plan format.
   */
  planSchema?: Record<string, unknown>;
}

/**
 * Internal plan structure used by the plan execution strategy.
 *
 * Tracks the list of plan steps and the current execution position.
 */
export interface ExecutionPlan {
  /** Array of plan steps with dependencies and status */
  steps: PlanStep[];
  /** Index of the currently executing step (0-indexed) */
  currentStepIndex: number;
}

/**
 * Tool dependency options for execution ordering.
 *
 * These options extend the base UPP Tool interface with UAP-specific
 * fields for controlling tool execution order. Tools can declare
 * dependencies on other tools or require sequential execution.
 *
 * @see UAP-1.0 Spec Section 8.5
 *
 * @example
 * ```typescript
 * // Tool that must execute alone (barrier)
 * const readTool = {
 *   name: 'read_file',
 *   sequential: true,
 *   // ... other tool config
 * };
 *
 * // Tool that depends on another tool
 * const writeTool = {
 *   name: 'write_file',
 *   dependsOn: ['read_file'],
 *   // ... other tool config
 * };
 * ```
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
 *
 * Use this type when defining tools that need execution ordering.
 * Combines the standard UPP Tool interface with ToolDependencyOptions.
 *
 * @see UAP-1.0 Spec Section 8.5
 *
 * @example
 * ```typescript
 * const readTool: ToolWithDependencies = {
 *   name: 'read_file',
 *   description: 'Read a file',
 *   parameters: {
 *     type: 'object',
 *     properties: { path: { type: 'string' } },
 *     required: ['path'],
 *   },
 *   sequential: true, // Must complete before other tools
 *   run: async (params) => fs.readFile(params.path, 'utf-8'),
 * };
 *
 * const writeTool: ToolWithDependencies = {
 *   name: 'write_file',
 *   description: 'Write a file',
 *   parameters: {
 *     type: 'object',
 *     properties: {
 *       path: { type: 'string' },
 *       content: { type: 'string' },
 *     },
 *     required: ['path', 'content'],
 *   },
 *   dependsOn: ['read_file'], // Waits for read_file to complete
 *   run: async (params) => fs.writeFile(params.path, params.content),
 * };
 * ```
 */
export interface ToolWithDependencies extends Tool, ToolDependencyOptions {}

/**
 * Model-driven tool call with optional execution order hint.
 *
 * Extends the standard ToolCall with an `after` field that models
 * can use to signal dependencies between specific tool call instances.
 * This enables fine-grained ordering beyond tool-level dependencies.
 *
 * @see UAP-1.0 Spec Section 8.6
 *
 * @example
 * ```typescript
 * // Model might return tool calls like:
 * const toolCalls: OrderedToolCall[] = [
 *   { toolCallId: 'call-1', toolName: 'read', arguments: { path: 'a.txt' } },
 *   { toolCallId: 'call-2', toolName: 'read', arguments: { path: 'b.txt' } },
 *   {
 *     toolCallId: 'call-3',
 *     toolName: 'merge',
 *     arguments: {},
 *     after: ['call-1', 'call-2'], // Wait for both reads
 *   },
 * ];
 * ```
 */
export interface OrderedToolCall extends ToolCall {
  /** Tool call IDs that must complete before this call executes */
  after?: string[];
}

/**
 * Sub-agent event types for hierarchical agent execution.
 *
 * When tools spawn sub-agents, these event types track the sub-agent
 * lifecycle for observability and debugging.
 *
 * @see UAP-1.0 Spec Section 8.7
 */
export type SubagentEventType = 'subagent_start' | 'subagent_event' | 'subagent_end';

/**
 * Base fields present in all sub-agent events.
 *
 * Provides the common identification and relationship fields
 * that all sub-agent event types share.
 */
export interface SubagentEventBase {
  /** Unique ID of the sub-agent instance */
  subagentId: string;
  /** Type/name of the sub-agent (e.g., 'explorer', 'planner') */
  subagentType: string;
  /** The parent tool call ID that spawned this sub-agent */
  parentToolCallId: string;
}

/**
 * Event emitted when a sub-agent starts execution.
 *
 * Contains the prompt given to the sub-agent and the start timestamp
 * for duration tracking.
 */
export interface SubagentStartEvent extends SubagentEventBase {
  /** Event type discriminator */
  type: 'subagent_start';
  /** The task/prompt given to the sub-agent */
  prompt: string;
  /** Start timestamp in milliseconds since epoch */
  timestamp: number;
}

/**
 * Event emitted for forwarded events from sub-agent execution.
 *
 * Wraps inner events from the sub-agent to provide visibility
 * into nested execution while maintaining the parent context.
 */
export interface SubagentInnerEvent extends SubagentEventBase {
  /** Event type discriminator */
  type: 'subagent_event';
  /** The actual event from the sub-agent */
  innerEvent: AgentStreamEvent;
}

/**
 * Event emitted when a sub-agent completes execution.
 *
 * Contains success/failure status, the result or error message,
 * tool executions performed, and token usage statistics.
 */
export interface SubagentEndEvent extends SubagentEventBase {
  /** Event type discriminator */
  type: 'subagent_end';
  /** Whether the sub-agent completed successfully */
  success: boolean;
  /** Sub-agent's response text (if successful) */
  result?: string;
  /** Error message (if failed) */
  error?: string;
  /** End timestamp in milliseconds since epoch */
  timestamp: number;
  /** Tools used by the sub-agent during execution */
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
 * Use this type when handling sub-agent events and switch on the
 * `type` field to narrow to the specific event type.
 *
 * @see UAP-1.0 Spec Section 8.7
 *
 * @example
 * ```typescript
 * function handleSubagentEvent(event: SubagentEvent) {
 *   switch (event.type) {
 *     case 'subagent_start':
 *       console.log(`Sub-agent ${event.subagentId} started`);
 *       break;
 *     case 'subagent_event':
 *       console.log(`Inner event:`, event.innerEvent);
 *       break;
 *     case 'subagent_end':
 *       console.log(`Sub-agent ${event.subagentId} ended: ${event.success}`);
 *       break;
 *   }
 * }
 * ```
 */
export type SubagentEvent = SubagentStartEvent | SubagentInnerEvent | SubagentEndEvent;

/**
 * Callback type for receiving sub-agent events.
 *
 * Tools that spawn sub-agents should accept this callback to propagate
 * sub-agent lifecycle events to the parent execution context.
 *
 * @param event - The sub-agent event to handle
 */
export type OnSubagentEvent = (event: SubagentEvent) => void;

/**
 * Context injected into tools during execution.
 *
 * Per UAP-1.0 Section 8.4, ExecutionStrategy MUST inject this context
 * when invoking tools that accept a second parameter. This enables
 * tools to inherit agent configuration and propagate sub-agent events.
 *
 * @see UAP-1.0 Spec Section 8.4
 *
 * @example
 * ```typescript
 * // Tool implementation receiving context
 * const myTool: Tool = {
 *   name: 'my_tool',
 *   description: 'Tool that uses execution context',
 *   parameters: { type: 'object', properties: {} },
 *   run: async (params, context?: ToolExecutionContext) => {
 *     console.log('Executing in agent:', context?.agentId);
 *     if (context?.onSubagentEvent) {
 *       // Can spawn sub-agents and propagate events
 *     }
 *     return 'result';
 *   },
 * };
 * ```
 */
export interface ToolExecutionContext {
  /** Agent instance ID for context inheritance */
  agentId: string;
  /** Current state snapshot ID for tracing */
  stateId: string;
  /** Tool call ID from the model response */
  toolCallId: string;
  /** Callback for propagating sub-agent events to parent */
  onSubagentEvent?: OnSubagentEvent;
}

/**
 * Type for a tool run function that accepts execution context as a second parameter.
 *
 * Tools can optionally accept ToolExecutionContext for sub-agent inheritance
 * and event propagation. The context parameter is optional to maintain
 * compatibility with standard tools.
 *
 * @param params - The tool parameters from the model
 * @param context - Optional execution context for agent features
 * @returns Promise resolving to the tool result
 *
 * @example
 * ```typescript
 * const contextAwareRun: ContextAwareToolRun = async (params, context) => {
 *   if (context?.onSubagentEvent) {
 *     // This tool can spawn sub-agents
 *     context.onSubagentEvent({
 *       type: 'subagent_start',
 *       subagentId: 'sub-123',
 *       subagentType: 'explorer',
 *       parentToolCallId: context.toolCallId,
 *       prompt: 'Explore the codebase',
 *       timestamp: Date.now(),
 *     });
 *   }
 *   return 'result';
 * };
 * ```
 */
export type ContextAwareToolRun = (
  params: Record<string, unknown>,
  context?: ToolExecutionContext,
) => Promise<unknown>;
