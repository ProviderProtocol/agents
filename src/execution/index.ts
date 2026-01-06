export { loop } from './loop.ts';
export { react } from './react.ts';
export { plan } from './plan.ts';

// Tool ordering utilities
export {
  orderToolCalls,
  hasToolDependencies,
  hasCallDependencies,
} from './tool-ordering.ts';
export type { ExecutionGroup } from './tool-ordering.ts';

export type {
  ExecutionStrategy,
  ExecutionContext,
  ExecutionResult,
  LoopOptions,
  ReactOptions,
  PlanOptions,
  AgentStrategy,
  GenerateResult,
  AgentStreamResult,
  AgentStreamEvent,
  UAPEventType,
  // Tool dependency types (Section 8.5)
  ToolDependencyOptions,
  ToolWithDependencies,
  OrderedToolCall,
} from './types.ts';
