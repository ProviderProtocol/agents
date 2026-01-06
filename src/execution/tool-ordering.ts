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
