import type { Tool, ToolCall } from '@providerprotocol/ai';
import type { ToolWithDependencies, OrderedToolCall } from './types.ts';

/**
 * Represents a group of tool calls that can execute together.
 *
 * Execution groups are created by {@link orderToolCalls} to organize
 * tool calls for efficient execution while respecting dependencies.
 * Groups marked as barriers must execute sequentially (one call at a time),
 * while non-barrier groups can execute all calls in parallel.
 *
 * @see {@link orderToolCalls} for the function that creates these groups
 */
export interface ExecutionGroup {
  /** Tool calls in this group that can execute together */
  calls: ToolCall[];
  /**
   * Whether this group contains a sequential tool (acts as barrier).
   * When true, calls in this group execute one at a time.
   * When false, all calls can execute in parallel.
   */
  isBarrier: boolean;
}

/**
 * Builds a lookup map of tool definitions by name for efficient access.
 *
 * @param tools - Array of tool definitions
 * @returns Map from tool name to tool definition (with dependency options)
 *
 * @internal
 */
function buildToolMap(tools: Tool[]): Map<string, ToolWithDependencies> {
  const map = new Map<string, ToolWithDependencies>();
  for (const tool of tools) {
    map.set(tool.name, tool as ToolWithDependencies);
  }
  return map;
}

/**
 * Extracts model-driven dependencies from a tool call.
 *
 * Models can specify execution order hints via the `after` field
 * on tool calls, indicating which other calls must complete first.
 *
 * @param call - The tool call to check for dependencies
 * @returns Array of tool call IDs this call depends on
 *
 * @internal
 */
function getModelDependencies(call: ToolCall): string[] {
  const orderedCall = call as OrderedToolCall;
  return orderedCall.after ?? [];
}

/**
 * Orders tool calls into execution groups respecting all dependency types.
 *
 * This function implements the tool execution ordering algorithm per
 * UAP-1.0 Sections 8.5 and 8.6. It takes a list of tool calls and
 * groups them for execution while respecting three types of dependencies:
 *
 * 1. **Tool-level `sequential` flag**: Tools marked as sequential create
 *    execution barriers - they must complete before any other tool starts.
 *
 * 2. **Tool-level `dependsOn` array**: Tools can declare dependencies on
 *    other tool names, waiting for those tools to complete first.
 *
 * 3. **Model-driven `after` array**: Individual tool calls can specify
 *    dependencies on specific call IDs for fine-grained ordering.
 *
 * The algorithm performs a topological sort, grouping calls that have
 * all dependencies satisfied. Sequential tools are isolated into single-call
 * barrier groups, while non-sequential tools are grouped for parallel execution.
 *
 * @param toolCalls - Tool calls from the model response
 * @param tools - Tool definitions (may include dependency options)
 * @returns Ordered array of execution groups to process in sequence
 *
 * @example
 * ```typescript
 * import { orderToolCalls, ToolWithDependencies } from '@providerprotocol/agents/execution';
 *
 * // Define tools with dependencies
 * const readTool: ToolWithDependencies = {
 *   name: 'read_file',
 *   sequential: true, // Must complete alone
 *   run: async (params) => readFile(params.path),
 * };
 *
 * const analyzeTools = [
 *   { name: 'analyze_a', dependsOn: ['read_file'], run: async () => {} },
 *   { name: 'analyze_b', dependsOn: ['read_file'], run: async () => {} },
 * ];
 *
 * // Order the calls
 * const groups = orderToolCalls(toolCalls, [readTool, ...analyzeTools]);
 *
 * // Execute groups in order
 * for (const group of groups) {
 *   if (group.isBarrier) {
 *     // Sequential execution
 *     for (const call of group.calls) {
 *       await executeTool(call);
 *     }
 *   } else {
 *     // Parallel execution
 *     await Promise.all(group.calls.map(executeTool));
 *   }
 * }
 * ```
 *
 * @see UAP-1.0 Spec Section 8.5 for tool-level dependencies
 * @see UAP-1.0 Spec Section 8.6 for model-driven dependencies
 * @see {@link executeOrderedToolCalls} for a higher-level execution function
 */
export function orderToolCalls(
  toolCalls: ToolCall[],
  tools: Tool[],
): ExecutionGroup[] {
  if (toolCalls.length === 0) {
    return [];
  }

  const toolMap = buildToolMap(tools);
  const groups: ExecutionGroup[] = [];

  // Track completed tool calls and tool names for dependency resolution
  const completedCallIds = new Set<string>();
  const completedToolNames = new Set<string>();

  // Create a queue of pending calls to process
  const pending = [...toolCalls];

  while (pending.length > 0) {
    const readyForExecution: ToolCall[] = [];
    let hasSequential = false;

    // Find all calls that can execute now (dependencies satisfied)
    const stillPending: ToolCall[] = [];

    for (const call of pending) {
      const tool = toolMap.get(call.toolName);
      const toolDependsOn = tool?.dependsOn ?? [];
      const modelDependsOn = getModelDependencies(call);

      // Check if tool-level dependencies are satisfied
      const toolDepsOk = toolDependsOn.every(
        (depName) => completedToolNames.has(depName),
      );

      // Check if model-level dependencies are satisfied
      const modelDepsOk = modelDependsOn.every(
        (depId) => completedCallIds.has(depId),
      );

      if (toolDepsOk && modelDepsOk) {
        readyForExecution.push(call);
        if (tool?.sequential) {
          hasSequential = true;
        }
      } else {
        stillPending.push(call);
      }
    }

    // If nothing is ready but we have pending items, there's a cycle
    if (readyForExecution.length === 0 && stillPending.length > 0) {
      // Break the cycle by executing remaining items as a fallback
      // Ideally dependencies should be acyclic, but we handle this gracefully
      groups.push({
        calls: stillPending,
        isBarrier: false,
      });
      break;
    }

    // If we have sequential tools, they form barriers and execute one at a time
    if (hasSequential) {
      for (const call of readyForExecution) {
        const tool = toolMap.get(call.toolName);
        groups.push({
          calls: [call],
          isBarrier: tool?.sequential ?? false,
        });
        completedCallIds.add(call.toolCallId);
        completedToolNames.add(call.toolName);
      }
    } else {
      // Non-sequential tools can be grouped for parallel execution
      groups.push({
        calls: readyForExecution,
        isBarrier: false,
      });
      for (const call of readyForExecution) {
        completedCallIds.add(call.toolCallId);
        completedToolNames.add(call.toolName);
      }
    }

    // Update pending list for next iteration
    pending.length = 0;
    pending.push(...stillPending);
  }

  return groups;
}

/**
 * Checks if any tools in the array have execution dependencies defined.
 *
 * This is a quick check to determine if tool ordering is needed.
 * If no tools have dependencies, all calls can execute in parallel
 * without the overhead of dependency resolution.
 *
 * @param tools - Tool definitions to check
 * @returns true if any tool has `sequential` or `dependsOn` set
 *
 * @example
 * ```typescript
 * import { hasToolDependencies } from '@providerprotocol/agents/execution';
 *
 * if (hasToolDependencies(tools)) {
 *   // Need to use orderToolCalls for proper ordering
 *   const groups = orderToolCalls(toolCalls, tools);
 * } else {
 *   // Can execute all calls in parallel
 *   await Promise.all(toolCalls.map(executeTool));
 * }
 * ```
 */
export function hasToolDependencies(tools: Tool[]): boolean {
  for (const tool of tools) {
    const t = tool as ToolWithDependencies;
    if (t.sequential || (t.dependsOn && t.dependsOn.length > 0)) {
      return true;
    }
  }
  return false;
}

/**
 * Checks if any tool calls have model-driven dependencies.
 *
 * Models can specify execution order hints via the `after` field
 * on tool calls. This function checks if any calls have such hints.
 *
 * @param toolCalls - Tool calls to check
 * @returns true if any call has the `after` field set
 *
 * @example
 * ```typescript
 * import { hasCallDependencies } from '@providerprotocol/agents/execution';
 *
 * if (hasCallDependencies(toolCalls) || hasToolDependencies(tools)) {
 *   // Need dependency-aware execution
 *   const groups = orderToolCalls(toolCalls, tools);
 * }
 * ```
 */
export function hasCallDependencies(toolCalls: ToolCall[]): boolean {
  for (const call of toolCalls) {
    const ordered = call as OrderedToolCall;
    if (ordered.after && ordered.after.length > 0) {
      return true;
    }
  }
  return false;
}

/**
 * Result of executing a single tool call, including timing and error information.
 *
 * @see {@link executeOrderedToolCalls} for the function that returns these
 */
export interface ToolExecutionResult {
  /** The tool call that was executed */
  call: ToolCall;
  /** The result returned from the tool (null if error) */
  result: unknown;
  /** Whether the tool execution threw an error */
  isError: boolean;
  /** Error message if isError is true */
  error?: string;
  /** Execution duration in milliseconds */
  duration: number;
}

/**
 * Function type for executing a single tool call.
 *
 * Implementations receive the tool call and tool definition,
 * and should return the result (or throw on error).
 *
 * @param call - The tool call to execute
 * @param tool - The tool definition
 * @returns Promise resolving to the tool result
 */
export type ToolExecutor = (call: ToolCall, tool: Tool) => Promise<unknown>;

/**
 * Executes tool calls respecting dependency ordering.
 *
 * This is a high-level function that combines {@link orderToolCalls} with
 * execution logic. It orders the tool calls, then executes them in groups
 * while respecting barriers and dependencies.
 *
 * Per UAP-1.0 Sections 8.5 and 8.6:
 * - Tools with `sequential: true` execute alone (as barriers)
 * - Tools with `dependsOn` wait for named tools to complete
 * - Tool calls with `after` wait for specific call IDs to complete
 *
 * @param toolCalls - Tool calls from the model response
 * @param tools - Tool definitions with potential dependencies
 * @param executor - Function to execute a single tool call
 * @returns Array of execution results in completion order
 *
 * @example
 * ```typescript
 * import {
 *   executeOrderedToolCalls,
 *   ToolWithDependencies,
 * } from '@providerprotocol/agents/execution';
 *
 * // Define tools with dependencies
 * const readTool: ToolWithDependencies = {
 *   name: 'read_file',
 *   description: 'Read a file',
 *   parameters: { type: 'object', properties: { path: { type: 'string' } } },
 *   sequential: true, // Must complete before others
 *   run: async (params) => readFile(params.path as string),
 * };
 *
 * const processTool: ToolWithDependencies = {
 *   name: 'process',
 *   description: 'Process data',
 *   parameters: { type: 'object', properties: { data: { type: 'string' } } },
 *   dependsOn: ['read_file'], // Wait for read_file
 *   run: async (params) => process(params.data as string),
 * };
 *
 * // Execute with automatic ordering
 * const results = await executeOrderedToolCalls(
 *   turn.response.toolCalls,
 *   [readTool, processTool],
 *   async (call, tool) => tool.run(call.arguments),
 * );
 *
 * // Check results
 * for (const result of results) {
 *   if (result.isError) {
 *     console.error(`${result.call.toolName} failed: ${result.error}`);
 *   } else {
 *     console.log(`${result.call.toolName} took ${result.duration}ms`);
 *   }
 * }
 * ```
 *
 * @see {@link orderToolCalls} for just the ordering logic
 * @see UAP-1.0 Spec Sections 8.5 and 8.6
 */
export async function executeOrderedToolCalls(
  toolCalls: ToolCall[],
  tools: Tool[],
  executor: ToolExecutor,
): Promise<ToolExecutionResult[]> {
  if (toolCalls.length === 0) {
    return [];
  }

  const toolMap = new Map<string, Tool>();
  for (const tool of tools) {
    toolMap.set(tool.name, tool);
  }

  const groups = orderToolCalls(toolCalls, tools);
  const results: ToolExecutionResult[] = [];

  for (const group of groups) {
    if (group.isBarrier) {
      // Sequential execution - one at a time within barrier groups
      for (const call of group.calls) {
        const tool = toolMap.get(call.toolName);
        if (!tool) {
          results.push({
            call,
            result: null,
            isError: true,
            error: `Tool not found: ${call.toolName}`,
            duration: 0,
          });
          continue;
        }

        const result = await executeOne(call, tool, executor);
        results.push(result);
      }
    } else {
      // Parallel execution - all calls in group run concurrently
      const groupResults = await Promise.all(
        group.calls.map(async (call) => {
          const tool = toolMap.get(call.toolName);
          if (!tool) {
            return {
              call,
              result: null,
              isError: true,
              error: `Tool not found: ${call.toolName}`,
              duration: 0,
            };
          }
          return executeOne(call, tool, executor);
        }),
      );
      results.push(...groupResults);
    }
  }

  return results;
}

/**
 * Executes a single tool call with timing and error handling.
 *
 * @param call - The tool call to execute
 * @param tool - The tool definition
 * @param executor - The executor function
 * @returns Execution result with timing and error information
 *
 * @internal
 */
async function executeOne(
  call: ToolCall,
  tool: Tool,
  executor: ToolExecutor,
): Promise<ToolExecutionResult> {
  const startTime = Date.now();

  try {
    const result = await executor(call, tool);
    return {
      call,
      result,
      isError: false,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return {
      call,
      result: null,
      isError: true,
      error: err.message,
      duration: Date.now() - startTime,
    };
  }
}
