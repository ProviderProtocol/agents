import type { Tool } from '@providerprotocol/ai';
import type {
  ExecutionContext,
  ToolExecutionContext,
  OnSubagentEvent,
  ContextAwareToolRun,
} from './types.ts';
import { generateUUID } from '../utils/uuid.ts';

/**
 * Options for tool context injection.
 */
export interface InjectToolContextOptions {
  /** Callback for sub-agent events from tools */
  onSubagentEvent?: OnSubagentEvent;
}

/**
 * Wrap tools to inject execution context when they support it.
 *
 * Per UAP-1.0 Section 8.4, tools that accept a second parameter
 * should receive execution context including agentId, stateId,
 * and sub-agent event callbacks.
 *
 * This enables:
 * - Sub-agent model/config inheritance
 * - Execution hierarchy tracking
 * - Sub-agent event propagation
 *
 * @param tools - Original tool array
 * @param context - Execution context from the agent
 * @param options - Additional options like event callbacks
 * @returns Wrapped tools with context injection
 *
 * @example
 * ```typescript
 * // In execution strategy
 * const wrappedTools = injectToolContext(tools, context, {
 *   onSubagentEvent: (event) => {
 *     // Handle sub-agent events
 *     yield { source: 'uap', uap: { type: event.type, ... } };
 *   },
 * });
 *
 * // Pass wrapped tools to LLM
 * const llmWithContext = llm({ model, tools: wrappedTools });
 * ```
 */
export function injectToolContext(
  tools: Tool[],
  context: ExecutionContext,
  options: InjectToolContextOptions = {},
): Tool[] {
  return tools.map((tool) => wrapToolWithContext(tool, context, options));
}

/**
 * Wrap a single tool with context injection.
 */
function wrapToolWithContext(
  tool: Tool,
  context: ExecutionContext,
  options: InjectToolContextOptions,
): Tool {
  const originalRun = tool.run;

  return {
    ...tool,
    run: async (params: Record<string, unknown>): Promise<unknown> => {
      // Build execution context for this tool call
      const toolContext: ToolExecutionContext = {
        agentId: context.agent.id,
        stateId: context.state.id,
        toolCallId: generateUUID(), // Generate unique ID for this call
        onSubagentEvent: options.onSubagentEvent,
      };

      // Check if tool accepts context (function has arity > 1)
      // We detect this by checking if the function expects more than 1 parameter
      if (originalRun.length > 1) {
        // Tool expects context as second argument
        return (originalRun as ContextAwareToolRun)(params, toolContext);
      }

      // Standard tool - just pass params
      return originalRun(params);
    },
  };
}

/**
 * Check if a tool is context-aware (accepts second parameter).
 *
 * @param tool - Tool to check
 * @returns true if tool.run accepts more than one parameter
 */
export function isContextAwareTool(tool: Tool): boolean {
  return tool.run.length > 1;
}

/**
 * Create a context-aware tool wrapper for existing tools.
 * This is useful when you want to add context support to a tool
 * that doesn't natively support it.
 *
 * @param tool - Original tool
 * @param handler - Function that receives params and context, returns result
 * @returns New tool with context support
 *
 * @example
 * ```typescript
 * const originalTool = { name: 'my_tool', run: async (p) => 'result', ... };
 *
 * const contextAware = withToolContext(originalTool, async (params, context) => {
 *   console.log('Agent ID:', context?.agentId);
 *   // Call original or do something with context
 *   return originalTool.run(params);
 * });
 * ```
 */
export function withToolContext(
  tool: Tool,
  handler: ContextAwareToolRun,
): Tool {
  return {
    ...tool,
    run: handler as Tool['run'],
  };
}
