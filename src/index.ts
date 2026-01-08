/**
 * @providerprotocol/agents - Unified Agent Protocol (UAP) 1.0 Implementation
 *
 * UAP provides agent abstractions built on @providerprotocol/ai (UPP-1.2):
 * - Functional state management with immutable AgentState
 * - Decoupled execution strategies (loop, react, plan)
 * - Middleware pipeline for cross-cutting concerns
 * - Thread trees for branching conversations
 *
 * Core Philosophy: "UAP is a pipe, not a nanny."
 * The protocol provides orchestration primitives; the developer provides the constraints.
 *
 * @example
 * ```typescript
 * import { agent, AgentState } from '@providerprotocol/agents';
 * import { react } from '@providerprotocol/agents/execution';
 * import { logging } from '@providerprotocol/agents/middleware';
 * import { anthropic } from '@providerprotocol/ai/anthropic';
 *
 * const coder = agent({
 *   model: anthropic('claude-sonnet-4-20250514'),
 *   execution: react(),
 *   tools: [Bash, Read, Write],
 *   system: 'You are an expert software engineer.',
 *   middleware: [logging({ level: 'info' })],
 * });
 *
 * const state = AgentState.initial();
 * const { turn, state: newState } = await coder.generate('Fix the bug', state);
 * console.log(turn.response.text);
 * ```
 *
 * @packageDocumentation
 */

/**
 * Factory function for creating agent instances with configurable execution strategies.
 *
 * @see {@link AgentOptions} for configuration options
 * @see {@link Agent} for the returned agent interface
 */
export { agent } from './agent/index.ts';

/**
 * Immutable state container for agent execution, tracking conversation history,
 * tool executions, and planning state.
 *
 * @see {@link AgentStateInterface} for the state interface
 */
export { AgentState } from './state/index.ts';

/**
 * Type exports for agent configuration and execution results.
 *
 * @remarks
 * - {@link Agent} - The agent interface returned by the `agent()` factory
 * - {@link AgentOptions} - Configuration options for creating agents
 * - {@link GenerateResult} - Result of non-streaming generation
 * - {@link AgentStreamResult} - Result of streaming generation
 * - {@link AgentStreamEvent} - Events emitted during streaming
 * - {@link UAPEventType} - Event type discriminators
 * - {@link AgentStrategy} - Execution strategy type union
 * - Sub-agent event types for nested agent orchestration (Section 8.7)
 */
export type {
  Agent,
  AgentOptions,
  GenerateResult,
  AgentStreamResult,
  AgentStreamEvent,
  UAPEventType,
  AgentStrategy,
  SubagentEventType,
  SubagentEventBase,
  SubagentStartEvent,
  SubagentInnerEvent,
  SubagentEndEvent,
  SubagentEvent,
  OnSubagentEvent,
} from './agent/index.ts';

/**
 * Type exports for agent state management.
 *
 * @remarks
 * - {@link AgentStateInterface} - Interface for agent state operations
 * - {@link AgentStateJSON} - JSON-serializable state representation
 * - {@link PlanStep} - Individual step in an execution plan
 * - {@link PlanStepStatus} - Status values for plan steps
 * - {@link SubagentExecutionTrace} - Trace of sub-agent execution
 * - {@link ToolExecutionTrace} - Trace of tool execution
 */
export type {
  AgentStateInterface,
  AgentStateJSON,
  PlanStep,
  PlanStepStatus,
  SubagentExecutionTrace,
  SubagentExecutionTraceJSON,
  ToolExecutionTrace,
} from './state/index.ts';

/**
 * Thread tree data structures for managing branching conversation histories.
 * Enables exploration of alternative conversation paths and state management
 * for multi-branch dialogues.
 *
 * @remarks
 * Thread trees are an optional Level 3 feature for advanced conversation management.
 */
export { ThreadTree, ThreadNode } from './thread-tree/index.ts';

/**
 * JSON-serializable types for thread tree persistence.
 */
export type { ThreadTreeJSON, ThreadNodeJSON } from './thread-tree/index.ts';

/**
 * Type exports for checkpoint persistence (Section 12.4).
 *
 * @remarks
 * - {@link CheckpointStore} - Interface for checkpoint storage backends
 * - {@link FileCheckpointOptions} - Options for file-based checkpoint storage
 * - {@link CheckpointMetadata} - Metadata attached to checkpoints
 * - {@link CheckpointData} - Complete checkpoint data structure
 */
export type {
  CheckpointStore,
  FileCheckpointOptions,
  CheckpointMetadata,
  CheckpointData,
} from './checkpoint/index.ts';

/**
 * Factory function for creating tools that delegate to sub-agents.
 * Enables hierarchical agent orchestration where a parent agent can
 * spawn child agents as tools (Section 8.7).
 *
 * @see {@link CreateSubAgentToolOptions} for configuration options
 */
export { createSubAgentTool } from './subagent/index.ts';

/**
 * Type exports for sub-agent tool creation.
 */
export type {
  CreateSubAgentToolOptions,
  SubAgentToolRun,
} from './subagent/index.ts';

/**
 * Utilities for injecting execution context into tool functions.
 * Allows tools to access agent state, conversation history, and other
 * contextual information during execution (Section 8.4).
 *
 * @remarks
 * - {@link injectToolContext} - Wraps tools to receive context
 * - {@link isContextAwareTool} - Type guard for context-aware tools
 * - {@link withToolContext} - HOF for creating context-aware tool runners
 */
export {
  injectToolContext,
  isContextAwareTool,
  withToolContext,
} from './execution/tool-context.ts';

/**
 * Options for tool context injection.
 */
export type { InjectToolContextOptions } from './execution/tool-context.ts';

/**
 * Type exports for execution strategies and tool orchestration (Section 8).
 *
 * @remarks
 * - {@link ExecutionStrategy} - Interface for custom execution strategies
 * - {@link ExecutionContext} - Context passed to execution strategies
 * - {@link ExecutionResult} - Result of strategy execution
 * - {@link ExecutionPlan} - Plan structure for plan-based execution
 * - {@link LoopOptions} - Options for loop execution strategy
 * - {@link ReactOptions} - Options for ReAct execution strategy
 * - {@link PlanOptions} - Options for plan-based execution strategy
 * - Tool dependency types for ordered tool execution
 */
export type {
  AgentRef,
  ContextAwareToolRun,
  ExecutionContext,
  ExecutionPlan,
  ExecutionResult,
  ExecutionStrategy,
  LoopOptions,
  OrderedToolCall,
  PlanOptions,
  ReactOptions,
  ToolDependencyOptions,
  ToolExecutionContext,
  ToolWithDependencies,
} from './execution/types.ts';

/**
 * Type exports for middleware configuration (Section 9).
 *
 * @remarks
 * - {@link Middleware} - Interface for creating middleware functions
 * - {@link MiddlewareContext} - Context passed through middleware pipeline
 * - {@link LoggingOptions} - Configuration for the built-in logging middleware
 */
export type {
  LoggingOptions,
  Middleware,
  MiddlewareContext,
} from './middleware/types.ts';

/**
 * Utilities for ordering and executing tool calls based on dependencies.
 * Enables parallel execution of independent tools while respecting
 * dependency constraints (Sections 8.5-8.6).
 *
 * @remarks
 * - {@link orderToolCalls} - Sorts tool calls into dependency-respecting groups
 * - {@link executeOrderedToolCalls} - Executes tool call groups in order
 * - {@link hasToolDependencies} - Type guard for tools with dependencies
 * - {@link hasCallDependencies} - Type guard for tool calls with dependencies
 */
export {
  executeOrderedToolCalls,
  hasCallDependencies,
  hasToolDependencies,
  orderToolCalls,
} from './execution/tool-ordering.ts';

/**
 * Type exports for tool ordering and execution.
 */
export type {
  ExecutionGroup,
  ToolExecutionResult,
  ToolExecutor,
} from './execution/tool-ordering.ts';
