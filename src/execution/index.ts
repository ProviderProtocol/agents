export { loop } from './loop.ts';
export { react } from './react.ts';
export { plan } from './plan.ts';

// Tool ordering utilities (Section 8.5, 8.6)
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

// Tool context injection utilities (Section 8.4)
export {
  injectToolContext,
  isContextAwareTool,
  withToolContext,
} from './tool-context.ts';
export type { InjectToolContextOptions } from './tool-context.ts';

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
  // Sub-agent event types (Section 8.7)
  SubagentEventType,
  SubagentEventBase,
  SubagentStartEvent,
  SubagentInnerEvent,
  SubagentEndEvent,
  SubagentEvent,
  OnSubagentEvent,
  // Tool context types (Section 8.4)
  ToolExecutionContext,
  ContextAwareToolRun,
} from './types.ts';
