/**
 * Execution module for AI agent strategies.
 *
 * This module provides execution strategies that define HOW an agent executes,
 * including tool orchestration, reasoning patterns, and state management.
 *
 * ## Execution Strategies
 *
 * Three built-in strategies are provided:
 *
 * - **loop()** - Simple tool loop, equivalent to UPP's native behavior.
 *   Ideal for straightforward tool-use scenarios.
 *
 * - **react()** - ReAct (Reason-Act-Observe) pattern with explicit reasoning.
 *   Best for complex tasks requiring step-by-step deliberation.
 *
 * - **plan()** - Plan-then-execute with structured step dependencies.
 *   Suitable for multi-step tasks with interdependencies.
 *
 * ## Tool Ordering (UAP-1.0 Section 8.5, 8.6)
 *
 * Tools can declare execution dependencies:
 * - `sequential: true` - Tool must complete before others start
 * - `dependsOn: ['tool_name']` - Wait for named tools to complete
 *
 * Tool calls can specify ordering hints:
 * - `after: ['call_id']` - Wait for specific calls to complete
 *
 * ## Tool Context Injection (UAP-1.0 Section 8.4)
 *
 * Tools that accept a second parameter receive execution context,
 * enabling sub-agent spawning and event propagation.
 *
 * @example
 * ```typescript
 * import {
 *   loop,
 *   react,
 *   plan,
 *   orderToolCalls,
 *   injectToolContext,
 * } from '@providerprotocol/agents/execution';
 *
 * // Use a strategy
 * const agent = createAgent({
 *   llm: myLLM,
 *   strategy: react({ maxSteps: 10 }),
 * });
 *
 * // Order tool calls manually
 * const groups = orderToolCalls(toolCalls, tools);
 * ```
 *
 * @module execution
 */

// Execution strategies
export { loop } from './loop.ts';
export { react } from './react.ts';
export { plan } from './plan.ts';

// Tool ordering utilities (UAP-1.0 Section 8.5, 8.6)
export {
  orderToolCalls,
  hasToolDependencies,
  hasCallDependencies,
  executeOrderedToolCalls,
} from './tool-ordering.ts';
export type {
  ExecutionGroup,
  ToolExecutionResult,
  ToolExecutor,
} from './tool-ordering.ts';

// Tool context injection utilities (UAP-1.0 Section 8.4)
export {
  injectToolContext,
  isContextAwareTool,
  withToolContext,
} from './tool-context.ts';
export type { InjectToolContextOptions } from './tool-context.ts';

// Core types
export type {
  // Strategy and execution types
  ExecutionStrategy,
  ExecutionContext,
  ExecutionResult,
  LoopOptions,
  ReactOptions,
  PlanOptions,
  AgentStrategy,
  GenerateResult,
  // Streaming types
  AgentStreamResult,
  AgentStreamEvent,
  UAPEventType,
  // Tool dependency types (UAP-1.0 Section 8.5)
  ToolDependencyOptions,
  ToolWithDependencies,
  OrderedToolCall,
  // Sub-agent event types (UAP-1.0 Section 8.7)
  SubagentEventType,
  SubagentEventBase,
  SubagentStartEvent,
  SubagentInnerEvent,
  SubagentEndEvent,
  SubagentEvent,
  OnSubagentEvent,
  // Tool context types (UAP-1.0 Section 8.4)
  ToolExecutionContext,
  ContextAwareToolRun,
} from './types.ts';
