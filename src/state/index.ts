import type {
  Message,
  UserContent,
  AssistantContent,
  ToolCall,
  ToolResult,
} from '@providerprotocol/ai';
import { UserMessage, AssistantMessage, ToolResultMessage } from '@providerprotocol/ai';
import { generateUUID } from '../utils/uuid.ts';
import type {
  AgentStateInterface,
  AgentStateJSON,
  PlanStep,
  MessageJSON,
} from './types.ts';
import { UAP_VERSION } from './types.ts';

/**
 * Immutable agent state snapshot.
 * All operations return new instances - the original state is never mutated.
 */
export class AgentState implements AgentStateInterface {
  readonly id: string;

  readonly messages: readonly Message[];

  readonly step: number;

  readonly metadata: Readonly<Record<string, unknown>>;

  readonly reasoning: readonly string[];

  readonly plan: readonly PlanStep[] | undefined;

  private constructor(
    id: string,
    messages: readonly Message[],
    step: number,
    metadata: Readonly<Record<string, unknown>>,
    reasoning: readonly string[],
    plan: readonly PlanStep[] | undefined,
  ) {
    this.id = id;
    this.messages = messages;
    this.step = step;
    this.metadata = metadata;
    this.reasoning = reasoning;
    this.plan = plan;
  }

  /**
   * Create an initial empty state.
   */
  static initial(): AgentState {
    return new AgentState(
      generateUUID(),
      [],
      0,
      {},
      [],
      undefined,
    );
  }

  /**
   * Return new state with a message added.
   */
  withMessage(message: Message): AgentState {
    return new AgentState(
      generateUUID(),
      [...this.messages, message],
      this.step,
      this.metadata,
      this.reasoning,
      this.plan,
    );
  }

  /**
   * Return new state with messages added.
   */
  withMessages(messages: Message[]): AgentState {
    return new AgentState(
      generateUUID(),
      [...this.messages, ...messages],
      this.step,
      this.metadata,
      this.reasoning,
      this.plan,
    );
  }

  /**
   * Return new state with updated step number.
   */
  withStep(step: number): AgentState {
    return new AgentState(
      generateUUID(),
      this.messages,
      step,
      this.metadata,
      this.reasoning,
      this.plan,
    );
  }

  /**
   * Return new state with metadata entry added/updated.
   */
  withMetadata(key: string, value: unknown): AgentState {
    return new AgentState(
      generateUUID(),
      this.messages,
      this.step,
      { ...this.metadata, [key]: value },
      this.reasoning,
      this.plan,
    );
  }

  /**
   * Return new state with reasoning trace added.
   */
  withReasoning(reasoning: string): AgentState {
    return new AgentState(
      generateUUID(),
      this.messages,
      this.step,
      this.metadata,
      [...this.reasoning, reasoning],
      this.plan,
    );
  }

  /**
   * Return new state with plan set.
   */
  withPlan(plan: PlanStep[]): AgentState {
    return new AgentState(
      generateUUID(),
      this.messages,
      this.step,
      this.metadata,
      this.reasoning,
      [...plan],
    );
  }

  /**
   * Serialize state to JSON for persistence.
   */
  toJSON(): AgentStateJSON {
    return {
      version: UAP_VERSION,
      id: this.id,
      messages: this.messages.map((msg) => serializeMessage(msg)),
      step: this.step,
      metadata: { ...this.metadata },
      reasoning: [...this.reasoning],
      plan: this.plan ? this.plan.map((s) => ({ ...s })) : undefined,
    };
  }

  /**
   * Deserialize state from JSON.
   */
  static fromJSON(json: AgentStateJSON): AgentState {
    if (json.version !== UAP_VERSION) {
      throw new Error(`Unsupported UAP version: ${json.version}. Expected: ${UAP_VERSION}`);
    }

    return new AgentState(
      json.id,
      json.messages.map((msg) => deserializeMessage(msg)),
      json.step,
      json.metadata,
      json.reasoning,
      json.plan ? json.plan.map((s) => ({ ...s })) : undefined,
    );
  }
}

/**
 * Serialize a UPP Message to JSON.
 */
function serializeMessage(message: Message): MessageJSON {
  if (message instanceof UserMessage) {
    return {
      role: 'user',
      content: message.content,
      metadata: message.metadata,
    };
  }
  if (message instanceof AssistantMessage) {
    return {
      role: 'assistant',
      content: {
        content: message.content,
        toolCalls: message.toolCalls,
      },
      metadata: message.metadata,
    };
  }
  if (message instanceof ToolResultMessage) {
    return {
      role: 'tool_result',
      content: message.results,
      metadata: message.metadata,
    };
  }
  throw new Error(`Unknown message type: ${typeof message}`);
}

/**
 * Deserialize a JSON message to UPP Message.
 */
function deserializeMessage(json: MessageJSON): Message {
  switch (json.role) {
    case 'user':
      return new UserMessage(
        json.content as string | UserContent[],
        { metadata: json.metadata },
      );
    case 'assistant': {
      const assistantContent = json.content as {
        content: string | AssistantContent[];
        toolCalls?: ToolCall[];
      };
      return new AssistantMessage(
        assistantContent.content,
        assistantContent.toolCalls,
        { metadata: json.metadata },
      );
    }
    case 'tool_result':
      return new ToolResultMessage(
        json.content as ToolResult[],
        { metadata: json.metadata },
      );
    default:
      throw new Error(`Unknown message role: ${json.role}`);
  }
}

export type { AgentStateInterface, AgentStateJSON, PlanStep, PlanStepStatus } from './types.ts';
