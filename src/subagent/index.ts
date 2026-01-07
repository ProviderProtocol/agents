/**
 * Sub-agent tool creation utilities.
 *
 * Per UAP-1.0 Section 8.7, implementations SHOULD provide helper utilities
 * for creating sub-agent tools with event propagation.
 *
 * @example
 * ```typescript
 * import { agent } from '@providerprotocol/agents';
 * import { createSubAgentTool } from '@providerprotocol/agents/subagent';
 *
 * // Create a sub-agent
 * const explorer = agent({
 *   model: anthropic('claude-haiku-4-20250514'),
 *   tools: [Glob, Grep, Read],
 *   system: 'You explore codebases.',
 * });
 *
 * // Wrap as a tool with event propagation
 * const explorerTool = createSubAgentTool({
 *   agent: explorer,
 *   name: 'explore_codebase',
 *   description: 'Explore and find relevant code',
 *   parameters: {
 *     type: 'object',
 *     properties: {
 *       query: { type: 'string', description: 'What to find' },
 *     },
 *     required: ['query'],
 *   },
 *   buildPrompt: (params) => `Find: ${params.query}`,
 *   subagentType: 'explorer',
 * });
 *
 * // Use in parent agent
 * const coder = agent({
 *   model: anthropic('claude-sonnet-4-20250514'),
 *   tools: [Bash, Write, explorerTool],
 * });
 * ```
 *
 * @packageDocumentation
 */

import type { Tool, JSONSchema } from '@providerprotocol/ai';
import type { Agent } from '../agent/types.ts';
import type {
  ToolExecutionContext,
  SubagentEvent,
  SubagentStartEvent,
  SubagentEndEvent,
} from '../execution/types.ts';
import { AgentState } from '../state/index.ts';
import { generateUUID } from '../utils/uuid.ts';

/**
 * Options for creating a sub-agent tool.
 */
export interface CreateSubAgentToolOptions {
  /** The sub-agent to expose as a tool */
  agent: Agent;
  /** Tool name (must be unique within parent agent's tools) */
  name: string;
  /** Tool description for the model */
  description: string;
  /** JSON Schema for tool parameters */
  parameters: JSONSchema;
  /** Convert tool parameters to a prompt for the sub-agent */
  buildPrompt: (params: Record<string, unknown>) => string;
  /**
   * Identifier for the sub-agent type (used in events).
   * Defaults to the tool name.
   */
  subagentType?: string;
  /**
   * Whether to stream the sub-agent execution.
   * When true, inner events are forwarded to parent.
   * Default: true
   */
  stream?: boolean;
}

/**
 * Create a UPP Tool from a UAP Agent with full event propagation.
 *
 * Per UAP-1.0 Section 8.7, this helper:
 * 1. Emits `subagent_start` before execution begins
 * 2. Forwards inner events during streaming execution
 * 3. Emits `subagent_end` after completion (success or failure)
 * 4. Provides execution context to sub-agent for tracing
 *
 * The created tool accepts an optional `ToolExecutionContext` as a second
 * parameter, which is injected by `injectToolContext()` during execution.
 *
 * @param options - Configuration for the sub-agent tool
 * @returns A Tool that executes the sub-agent and propagates events
 *
 * @example
 * ```typescript
 * const summarizer = agent({
 *   model: anthropic('claude-haiku-4-20250514'),
 *   system: 'You summarize text concisely.',
 * });
 *
 * const summarizerTool = createSubAgentTool({
 *   agent: summarizer,
 *   name: 'summarize',
 *   description: 'Summarize the given text',
 *   parameters: {
 *     type: 'object',
 *     properties: {
 *       text: { type: 'string', description: 'Text to summarize' },
 *       maxLength: { type: 'number', description: 'Max summary length' },
 *     },
 *     required: ['text'],
 *   },
 *   buildPrompt: (params) =>
 *     `Summarize this in ${params.maxLength ?? 100} words:\n\n${params.text}`,
 *   subagentType: 'summarizer',
 * });
 * ```
 */
export function createSubAgentTool(options: CreateSubAgentToolOptions): Tool {
  const {
    agent,
    name,
    description,
    parameters,
    buildPrompt,
    subagentType = name,
    stream: shouldStream = true,
  } = options;

  return {
    name,
    description,
    parameters,
    run: async (
      params: Record<string, unknown>,
      context?: ToolExecutionContext,
    ): Promise<string> => {
      const subagentId = generateUUID();
      const toolCallId = context?.toolCallId ?? generateUUID();
      const emit = context?.onSubagentEvent;
      const prompt = buildPrompt(params);
      const startTime = Date.now();

      // Emit start event
      const startEvent: SubagentStartEvent = {
        type: 'subagent_start',
        subagentId,
        subagentType,
        parentToolCallId: toolCallId,
        prompt,
        timestamp: startTime,
      };
      emit?.(startEvent);

      try {
        if (shouldStream) {
          return await executeWithStreaming(
            agent,
            prompt,
            subagentId,
            subagentType,
            toolCallId,
            emit,
          );
        }
        return await executeWithoutStreaming(
          agent,
          prompt,
          subagentId,
          subagentType,
          toolCallId,
          emit,
        );
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));

        // Emit end event with error
        const endEvent: SubagentEndEvent = {
          type: 'subagent_end',
          subagentId,
          subagentType,
          parentToolCallId: toolCallId,
          success: false,
          error: err.message,
          timestamp: Date.now(),
        };
        emit?.(endEvent);

        throw err;
      }
    },
  };
}

/**
 * Execute sub-agent with streaming and forward events.
 */
async function executeWithStreaming(
  agent: Agent,
  prompt: string,
  subagentId: string,
  subagentType: string,
  toolCallId: string,
  emit?: (event: SubagentEvent) => void,
): Promise<string> {
  const stream = agent.stream(prompt, AgentState.initial());

  // Forward inner events
  for await (const event of stream) {
    emit?.({
      type: 'subagent_event',
      subagentId,
      subagentType,
      parentToolCallId: toolCallId,
      innerEvent: event,
    });
  }

  const result = await stream.result;

  // Emit end event
  const endEvent: SubagentEndEvent = {
    type: 'subagent_end',
    subagentId,
    subagentType,
    parentToolCallId: toolCallId,
    success: true,
    result: result.turn.response.text,
    timestamp: Date.now(),
    toolExecutions: result.turn.toolExecutions?.map((te) => ({
      toolName: te.toolName,
      arguments: te.arguments as Record<string, unknown>,
      result: String(te.result),
    })),
    usage: result.turn.usage,
  };
  emit?.(endEvent);

  return result.turn.response.text;
}

/**
 * Execute sub-agent without streaming (simpler, but no inner events).
 */
async function executeWithoutStreaming(
  agent: Agent,
  prompt: string,
  subagentId: string,
  subagentType: string,
  toolCallId: string,
  emit?: (event: SubagentEvent) => void,
): Promise<string> {
  const result = await agent.generate(prompt, AgentState.initial());

  // Emit end event
  const endEvent: SubagentEndEvent = {
    type: 'subagent_end',
    subagentId,
    subagentType,
    parentToolCallId: toolCallId,
    success: true,
    result: result.turn.response.text,
    timestamp: Date.now(),
    toolExecutions: result.turn.toolExecutions?.map((te) => ({
      toolName: te.toolName,
      arguments: te.arguments as Record<string, unknown>,
      result: String(te.result),
    })),
    usage: result.turn.usage,
  };
  emit?.(endEvent);

  return result.turn.response.text;
}

/**
 * Type for the run function of a sub-agent tool.
 * Accepts params and optional execution context.
 */
export type SubAgentToolRun = (
  params: Record<string, unknown>,
  context?: ToolExecutionContext,
) => Promise<string>;
