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

// Main exports
export { agent } from './agent/index.ts';
export { AgentState } from './state/index.ts';

// Type exports from agent
export type {
  Agent,
  AgentOptions,
  GenerateResult,
  AgentStreamResult,
  AgentStreamEvent,
  UAPEventType,
  AgentStrategy,
  // Sub-agent event types (Section 8.7)
  SubagentEventType,
  SubagentEventBase,
  SubagentStartEvent,
  SubagentInnerEvent,
  SubagentEndEvent,
  SubagentEvent,
  OnSubagentEvent,
} from './agent/index.ts';

// Type exports from state
export type {
  AgentStateInterface,
  AgentStateJSON,
  PlanStep,
  PlanStepStatus,
  SubagentExecutionTrace,
  SubagentExecutionTraceJSON,
  ToolExecutionTrace,
} from './state/index.ts';

// Thread tree exports (Level 3 - optional)
export { ThreadTree, ThreadNode } from './thread-tree/index.ts';
export type { ThreadTreeJSON, ThreadNodeJSON } from './thread-tree/index.ts';

// Checkpoint exports (Section 12.4)
export type {
  CheckpointStore,
  FileCheckpointOptions,
  CheckpointMetadata,
  CheckpointData,
} from './checkpoint/index.ts';
