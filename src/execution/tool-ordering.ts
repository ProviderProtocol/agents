import type { Tool, ToolCall } from '@providerprotocol/ai';
import type { ToolWithDependencies, OrderedToolCall } from './types.ts';

/**
 * Execution group - a set of tool calls that can execute in parallel.
 */
export interface ExecutionGroup {
  /** Tool calls in this group */
  calls: ToolCall[];
  /** Whether this group contains a sequential tool (acts as barrier) */
  isBarrier: boolean;
}

/**
 * Build a map of tool definitions by name for quick lookup.
 */
function buildToolMap(tools: Tool[]): Map<string, ToolWithDependencies> {
  const map = new Map<string, ToolWithDependencies>();
  for (const tool of tools) {
    map.set(tool.name, tool as ToolWithDependencies);
  }
  return map;
}

/**
 * Check if a tool call has an explicit dependency via model hint.
 */
function getModelDependencies(call: ToolCall): string[] {
  const orderedCall = call as OrderedToolCall;
  return orderedCall.after ?? [];
}

/**
 * Order tool calls into execution groups respecting dependencies.
 *
 * This function takes a list of tool calls and the available tools,
 * then groups them for execution while respecting:
 * 1. Tool-level `sequential` flag (creates execution barriers)
 * 2. Tool-level `dependsOn` array (tool must wait for named tools)
 * 3. Model-driven `after` array on tool calls (call must wait for specific calls)
 *
 * @param toolCalls - Tool calls from the model response
 * @param tools - Tool definitions (may include dependency options)
 * @returns Ordered array of execution groups
 *
 * @example
 * ```typescript
 * const groups = orderToolCalls(turn.response.toolCalls, agent.tools);
 *
 * for (const group of groups) {
 *   if (group.isBarrier) {
 *     // Execute sequentially
 *     for (const call of group.calls) {
 *       await executeTool(call);
 *     }
 *   } else {
 *     // Execute in parallel
 *     await Promise.all(group.calls.map(executeTool));
 *   }
 * }
 * ```
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

  // Track completed tool calls and tool names
  const completedCallIds = new Set<string>();
  const completedToolNames = new Set<string>();

  // Create a queue of pending calls
  const pending = [...toolCalls];

  while (pending.length > 0) {
    const readyForExecution: ToolCall[] = [];
    let hasSequential = false;

    // Find all calls that can execute now
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
      // Break the cycle by executing remaining items
      // This is a fallback - ideally dependencies should be acyclic
      groups.push({
        calls: stillPending,
        isBarrier: false,
      });
      break;
    }

    // If we have sequential tools, they form a barrier
    // Process them one at a time
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

    // Update pending list
    pending.length = 0;
    pending.push(...stillPending);
  }

  return groups;
}

/**
 * Check if any tools have execution dependencies defined.
 *
 * @param tools - Tool definitions to check
 * @returns true if any tool has sequential or dependsOn set
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
 * Check if any tool calls have model-driven dependencies.
 *
 * @param toolCalls - Tool calls to check
 * @returns true if any call has the `after` field set
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
 * Result of executing a tool call.
 */
export interface ToolExecutionResult {
  /** The tool call that was executed */
  call: ToolCall;
  /** The result from the tool */
  result: unknown;
  /** Whether the tool threw an error */
  isError: boolean;
  /** Error message if isError is true */
  error?: string;
  /** Execution duration in milliseconds */
  duration: number;
}

/**
 * Function type for executing a single tool call.
 */
export type ToolExecutor = (call: ToolCall, tool: Tool) => Promise<unknown>;

/**
 * Execute tool calls respecting dependency ordering.
 *
 * This function takes tool calls, orders them using `orderToolCalls()`,
 * and executes them respecting barriers (sequential tools) and
 * dependencies (dependsOn, after).
 *
 * Per UAP-1.0 Sections 8.5 and 8.6:
 * - Tools with `sequential: true` execute alone (barrier)
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
 * import { executeOrderedToolCalls } from '@providerprotocol/agents/execution';
 *
 * // Define tools with dependencies
 * const readTool: ToolWithDependencies = {
 *   name: 'read_file',
 *   sequential: true, // Must complete before others
 *   run: async (params) => readFile(params.path),
 * };
 *
 * const processTool: ToolWithDependencies = {
 *   name: 'process',
 *   dependsOn: ['read_file'], // Wait for read_file
 *   run: async (params) => process(params.data),
 * };
 *
 * // Execute with ordering
 * const results = await executeOrderedToolCalls(
 *   turn.response.toolCalls,
 *   [readTool, processTool],
 *   async (call, tool) => tool.run(call.arguments),
 * );
 * ```
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
      // Sequential execution - one at a time
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
      // Parallel execution
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
 * Execute a single tool call with timing and error handling.
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
