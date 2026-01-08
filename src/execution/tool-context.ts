import type { Tool } from '@providerprotocol/ai';
import type {
  ExecutionContext,
  ToolExecutionContext,
  OnSubagentEvent,
  ContextAwareToolRun,
} from './types.ts';
import { generateUUID } from '../utils/uuid.ts';

/**
 * Options for configuring tool context injection behavior.
 *
 * @see {@link injectToolContext} for the main injection function
 */
export interface InjectToolContextOptions {
  /**
   * Callback for receiving sub-agent events emitted by tools.
   * Tools that spawn sub-agents can use this callback to propagate
   * lifecycle events (start, inner events, end) to the parent context.
   */
  onSubagentEvent?: OnSubagentEvent;
}

/**
 * Wraps tools to inject execution context when they support it.
 *
 * Per UAP-1.0 Section 8.4, tools that accept a second parameter should receive
 * execution context including agentId, stateId, and sub-agent event callbacks.
 * This function wraps an array of tools to automatically inject this context
 * when the tool's `run` function has arity > 1.
 *
 * This enables:
 * - **Sub-agent model/config inheritance**: Tools can create sub-agents that
 *   inherit configuration from the parent agent
 * - **Execution hierarchy tracking**: The agentId and stateId enable tracing
 *   through nested agent executions
 * - **Sub-agent event propagation**: Tools can emit events about sub-agent
 *   lifecycle that bubble up to the parent
 *
 * @param tools - Original tool array to wrap
 * @param context - Execution context from the agent
 * @param options - Additional options like event callbacks
 * @returns New array of wrapped tools with context injection
 *
 * @example
 * ```typescript
 * import { injectToolContext } from '@providerprotocol/agents/execution';
 *
 * // In an execution strategy
 * const wrappedTools = injectToolContext(tools, context, {
 *   onSubagentEvent: (event) => {
 *     // Handle sub-agent events (start, inner events, end)
 *     if (event.type === 'subagent_start') {
 *       console.log(`Sub-agent ${event.subagentId} started`);
 *     }
 *   },
 * });
 *
 * // Create LLM with wrapped tools
 * const llmWithContext = llm({ model, tools: wrappedTools });
 * ```
 *
 * @see UAP-1.0 Spec Section 8.4
 * @see {@link ToolExecutionContext} for the context structure
 * @see {@link isContextAwareTool} to check if a tool accepts context
 */
export function injectToolContext(
  tools: Tool[],
  context: ExecutionContext,
  options: InjectToolContextOptions = {},
): Tool[] {
  return tools.map((tool) => wrapToolWithContext(tool, context, options));
}

/**
 * Wraps a single tool with context injection.
 *
 * Creates a new tool object with the same properties but with
 * a wrapped `run` function that injects ToolExecutionContext
 * for tools that accept it (arity > 1).
 *
 * @param tool - The original tool to wrap
 * @param context - The execution context to inject
 * @param options - Options including event callbacks
 * @returns A new tool with context injection in the run function
 *
 * @internal
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
      // Build execution context for this specific tool call
      const toolContext: ToolExecutionContext = {
        agentId: context.agent.id,
        stateId: context.state.id,
        toolCallId: generateUUID(),
        onSubagentEvent: options.onSubagentEvent,
      };

      // Check if tool accepts context (function has arity > 1)
      if (originalRun.length > 1) {
        return (originalRun as ContextAwareToolRun)(params, toolContext);
      }

      // Standard tool - just pass params
      return originalRun(params);
    },
  };
}

/**
 * Checks if a tool is context-aware (accepts execution context as second parameter).
 *
 * Context-aware tools have a `run` function with arity > 1, meaning they
 * accept the optional `ToolExecutionContext` parameter. This allows them
 * to access agent information and emit sub-agent events.
 *
 * @param tool - The tool to check
 * @returns true if the tool's run function accepts more than one parameter
 *
 * @example
 * ```typescript
 * import { isContextAwareTool } from '@providerprotocol/agents/execution';
 *
 * const standardTool = {
 *   name: 'simple',
 *   run: async (params) => 'result', // arity = 1
 * };
 *
 * const contextTool = {
 *   name: 'advanced',
 *   run: async (params, context) => 'result', // arity = 2
 * };
 *
 * isContextAwareTool(standardTool); // false
 * isContextAwareTool(contextTool);  // true
 * ```
 */
export function isContextAwareTool(tool: Tool): boolean {
  return tool.run.length > 1;
}

/**
 * Creates a context-aware tool wrapper for existing tools.
 *
 * This utility function allows you to add context support to a tool
 * that doesn't natively support it. The handler function receives
 * both the parameters and the optional execution context.
 *
 * This is useful when:
 * - Wrapping third-party tools to add context awareness
 * - Creating tools that need to spawn sub-agents
 * - Adding logging or tracing to existing tools
 *
 * @param tool - The original tool to wrap
 * @param handler - Function that receives params and context, returns result
 * @returns New tool with context support via the provided handler
 *
 * @example
 * ```typescript
 * import { withToolContext } from '@providerprotocol/agents/execution';
 *
 * // Wrap an existing tool to add context awareness
 * const originalTool = {
 *   name: 'search',
 *   description: 'Search the web',
 *   parameters: { type: 'object', properties: { query: { type: 'string' } } },
 *   run: async (params) => searchWeb(params.query),
 * };
 *
 * const contextAwareTool = withToolContext(originalTool, async (params, context) => {
 *   // Log which agent is using this tool
 *   console.log(`Agent ${context?.agentId} searching for: ${params.query}`);
 *
 *   // Optionally emit sub-agent events
 *   if (context?.onSubagentEvent) {
 *     // Could spawn a sub-agent here and emit events
 *   }
 *
 *   // Call the original implementation
 *   return searchWeb(params.query as string);
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Create a tool that spawns sub-agents
 * const explorerTool = withToolContext(baseTool, async (params, context) => {
 *   const subagentId = generateUUID();
 *
 *   // Emit start event
 *   context?.onSubagentEvent?.({
 *     type: 'subagent_start',
 *     subagentId,
 *     subagentType: 'explorer',
 *     parentToolCallId: context.toolCallId,
 *     prompt: params.task as string,
 *     timestamp: Date.now(),
 *   });
 *
 *   try {
 *     const result = await runExploration(params.task);
 *
 *     // Emit end event on success
 *     context?.onSubagentEvent?.({
 *       type: 'subagent_end',
 *       subagentId,
 *       subagentType: 'explorer',
 *       parentToolCallId: context.toolCallId,
 *       success: true,
 *       result,
 *       timestamp: Date.now(),
 *     });
 *
 *     return result;
 *   } catch (error) {
 *     // Emit end event on failure
 *     context?.onSubagentEvent?.({
 *       type: 'subagent_end',
 *       subagentId,
 *       subagentType: 'explorer',
 *       parentToolCallId: context.toolCallId,
 *       success: false,
 *       error: error.message,
 *       timestamp: Date.now(),
 *     });
 *     throw error;
 *   }
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
