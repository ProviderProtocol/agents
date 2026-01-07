# How to Use @providerprotocol/agents

`@providerprotocol/agents` is a Unified Agent Protocol (UAP) 1.0 implementation built on `@providerprotocol/ai` (UPP-1.2). It provides a complete framework for building AI agents with explicit control, functional state management, and composable execution strategies.

**Core Philosophy: "UAP is a pipe, not a nanny."**
The protocol provides orchestration primitives; the developer provides the constraints. There are no artificial limits by default - infinite execution is standard.

## Quick Start

```typescript
import { agent, AgentState } from '@providerprotocol/agents';
import { anthropic } from '@providerprotocol/ai/anthropic';

// Create an agent
const coder = agent({
  model: anthropic('claude-sonnet-4-20250514'),
  params: { max_tokens: 4096 },
  system: 'You are an expert software engineer.',
  tools: [myReadTool, myWriteTool],
});

// Execute with immutable state
const state = AgentState.initial();
const { turn, state: newState } = await coder.generate('Hello!', state);
console.log(turn.response.text);
```

## Installation

```bash
bun install @providerprotocol/agents @providerprotocol/ai
```

The library requires `@providerprotocol/ai >= 0.0.11` as a peer dependency.

## Architecture Overview

```
Application Layer (your code)
        |
Agent Interface (generate, stream, ask, query)
        |
Middleware Pipeline (logging, guardrails, context pruning)
        |
Execution Strategies (loop, react, plan)
        |
UPP-1.2 Layer (@providerprotocol/ai)
        |
LLM Provider Adapters (Anthropic, OpenAI, Google, Ollama, etc.)
```

## Creating Agents

### Basic Agent

```typescript
import { agent, AgentState } from '@providerprotocol/agents';
import { anthropic } from '@providerprotocol/ai/anthropic';

const myAgent = agent({
  model: anthropic('claude-sonnet-4-20250514'),
  params: { max_tokens: 4096 },
  system: 'You are a helpful assistant.',
});
```

### Agent with Tools

```typescript
import { agent, AgentState } from '@providerprotocol/agents';
import { anthropic } from '@providerprotocol/ai/anthropic';

const calculator = {
  name: 'calculate',
  description: 'Perform arithmetic calculations',
  parameters: {
    type: 'object' as const,
    properties: {
      expression: { type: 'string' as const, description: 'Math expression' },
    },
    required: ['expression'],
  },
  run: async (params: { expression: string }) => {
    return String(eval(params.expression)); // Use a proper math parser in production
  },
};

const mathAgent = agent({
  model: anthropic('claude-sonnet-4-20250514'),
  params: { max_tokens: 1000 },
  tools: [calculator],
});
```

### Full Agent Options

```typescript
import { agent, AgentState } from '@providerprotocol/agents';
import { react } from '@providerprotocol/agents/execution';
import { logging } from '@providerprotocol/agents/middleware';
import { anthropic } from '@providerprotocol/ai/anthropic';

const fullAgent = agent({
  // Required: Model from UPP provider
  model: anthropic('claude-sonnet-4-20250514'),

  // LLM parameters (provider-specific)
  params: { max_tokens: 8192 },

  // Provider configuration
  config: {
    apiKey: 'sk-...',         // Override env var
    baseUrl: 'https://...',   // Custom endpoint
  },

  // System prompt
  system: 'You are an expert coder.',

  // Tools array
  tools: [readTool, writeTool, bashTool],

  // Execution strategy (default: loop())
  execution: react({ maxSteps: 20 }),

  // Middleware pipeline
  middleware: [logging({ level: 'info' })],

  // Lifecycle hooks
  strategy: {
    stopCondition: (state) => state.step > 50,
    onStepStart: (step, state) => console.log(`Step ${step}`),
    onComplete: (result) => console.log('Done!'),
  },

  // Tool execution hooks (passed to UPP)
  toolStrategy: {
    maxIterations: Infinity,
    onToolCall: (tool, params) => console.log(`Calling ${tool.name}`),
  },

  // Checkpointing for persistence
  checkpoints: fileCheckpoints({ dir: '.checkpoints' }),
  sessionId: 'my-session-123', // Auto-generated if not provided
});
```

## Agent Methods

### generate(input, state)

Execute agent and return result with new state.

```typescript
const state = AgentState.initial();
const { turn, state: newState } = await myAgent.generate('Hello!', state);

console.log(turn.response.text);       // Response text
console.log(turn.usage.totalTokens);   // Token usage
console.log(turn.toolExecutions);      // Tool executions
console.log(newState.step);            // Current step number
console.log(newState.messages.length); // Message count
```

### stream(input, state)

Execute agent with streaming events.

```typescript
const stream = myAgent.stream('Explain quantum computing', state);

// Iterate over events
for await (const event of stream) {
  if (event.source === 'upp' && event.upp?.type === 'text_delta') {
    // LLM text streaming
    process.stdout.write(event.upp.delta.text ?? '');
  }
  if (event.source === 'uap' && event.uap?.type === 'step_start') {
    // Agent-level events
    console.log(`\nStep ${event.uap.step} started`);
  }
}

// Get final result after stream completes
const { turn, state: newState } = await stream.result;

// Abort if needed
stream.abort();
```

### ask(input, state)

Multi-turn convenience method that automatically appends messages to state.

```typescript
let state = AgentState.initial();

// First turn
const result1 = await myAgent.ask('My name is Alice', state);
state = result1.state;

// Second turn (model remembers context)
const result2 = await myAgent.ask('What is my name?', state);
// result2.turn.response.text contains "Alice"
```

### query(input)

Stateless single-turn execution. Creates ephemeral state, executes, discards state.

```typescript
const turn = await myAgent.query('What is 2+2?');
console.log(turn.response.text); // "4"
```

## Execution Strategies

Import from `@providerprotocol/agents/execution`.

### loop() - Simple Tool Loop

Simplest strategy - equivalent to UPP's built-in tool loop.

```typescript
import { loop } from '@providerprotocol/agents/execution';

const agent = agent({
  model: anthropic('claude-sonnet-4-20250514'),
  execution: loop({ maxIterations: Infinity }), // Default
});
```

Behavior:
1. Send input to LLM
2. If response has tool calls, execute tools
3. Loop until no more tool calls or maxIterations reached

### react() - Reason-Act-Observe

ReAct pattern with explicit reasoning phase.

```typescript
import { react } from '@providerprotocol/agents/execution';

const agent = agent({
  model: anthropic('claude-sonnet-4-20250514'),
  execution: react({
    maxSteps: Infinity,  // Default
    reasoningPrompt: 'Think step by step about what you need to do next.',
  }),
});
```

Behavior:
1. **Reason**: LLM outputs reasoning about what to do
2. **Act**: LLM selects and executes tool(s)
3. **Observe**: Tool results fed back
4. Repeat until no actions or maxSteps reached

Stream events emitted: `step_start`, `reasoning`, `action`, `observation`, `step_end`

### plan() - Plan-then-Execute

Generate structured plan with dependencies, then execute.

```typescript
import { plan } from '@providerprotocol/agents/execution';

const agent = agent({
  model: anthropic('claude-sonnet-4-20250514'),
  execution: plan({
    maxPlanSteps: Infinity,  // Default
    allowReplan: true,       // Replan on failure
  }),
});
```

Behavior:
1. **Planning phase**: LLM generates structured plan with step dependencies
2. **Execution phase**: Execute steps in topological order
3. Optionally replan if a step fails

Stream events emitted: `plan_created`, `plan_step_start`, `action`, `observation`, `plan_step_end`

## State Management

`AgentState` is immutable - all operations return new instances.

### Creating State

```typescript
import { AgentState } from '@providerprotocol/agents';

// Create initial state
const state = AgentState.initial();
```

### State Operations

All operations return new `AgentState` instances:

```typescript
// Add message
const state2 = state.withMessage(new UserMessage('Hello'));

// Add multiple messages
const state3 = state.withMessages([msg1, msg2]);

// Replace entire context (for pruning/summarization)
const state4 = state.withContext([prunedMessages]);

// Update step number
const state5 = state.withStep(5);

// Add metadata
const state6 = state.withMetadata('customKey', 'value');

// Add reasoning trace (ReAct)
const state7 = state.withReasoning('I should read the file first...');

// Set execution plan
const state8 = state.withPlan([
  { id: 'step1', description: 'Read file', status: 'pending', dependsOn: [] },
]);
```

### State Properties

```typescript
state.id           // UUIDv4 state identifier
state.messages     // Conversation messages (readonly)
state.step         // Current step number
state.metadata     // Key-value metadata
state.reasoning    // Reasoning traces (ReAct)
state.plan         // Execution plan steps
```

### Serialization

```typescript
// Save state
const json = state.toJSON();
await Bun.write('state.json', JSON.stringify(json));

// Restore state
const loaded = await Bun.file('state.json').json();
const restoredState = AgentState.fromJSON(loaded);
```

## Middleware

Import from `@providerprotocol/agents/middleware`.

### Built-in Logging Middleware

```typescript
import { logging } from '@providerprotocol/agents/middleware';

const agent = agent({
  model: anthropic('claude-sonnet-4-20250514'),
  middleware: [
    logging({
      level: 'info',           // 'debug' | 'info' | 'warn' | 'error'
      logger: console.log,     // Custom logger function
      includeMessages: false,  // Log message contents
      includeTiming: true,     // Log execution duration
    }),
  ],
});
```

### Custom Middleware

```typescript
import type { Middleware, MiddlewareContext } from '@providerprotocol/agents/middleware';
import type { GenerateResult } from '@providerprotocol/agents';

const myMiddleware: Middleware = {
  name: 'my-middleware',

  // Runs before execution (forward order)
  async before(context: MiddlewareContext) {
    console.log('Before:', context.input);
    // Optionally return modified context
    return context;
  },

  // Runs after execution (reverse order)
  async after(context: MiddlewareContext, result: GenerateResult) {
    console.log('After:', result.turn.response.text);
    // Must return result (possibly modified)
    return result;
  },

  // Runs on error (reverse order)
  async onError(context: MiddlewareContext, error: Error) {
    console.error('Error:', error.message);
    // Return recovery result or undefined to propagate error
    return undefined;
  },
};
```

### Middleware Execution Order

```
first.before() → second.before() → third.before()
  → Agent Execution
→ third.after() → second.after() → first.after()
```

## Thread Trees

For branching conversations. Import from `@providerprotocol/agents/thread-tree`.

```typescript
import { ThreadTree } from '@providerprotocol/agents/thread-tree';
import { agent, AgentState } from '@providerprotocol/agents';

// Create tree
const tree = new ThreadTree();

// Execute on current node
const { turn, state } = await myAgent.generate('Start conversation', tree.history());
tree.current.state = state;

// Create a branch
const branchId = tree.branch(tree.current.id, 'alternative-path');

// Switch to branch
tree.checkout(branchId);

// Execute on branch
const { turn: t2, state: s2 } = await myAgent.generate('Different direction', tree.history());
tree.current.state = s2;

// Navigation
tree.getLeaves();                    // All leaf node IDs
tree.getBranches();                  // Map of node IDs to names

// Serialization
const json = tree.toJSON();
const restored = ThreadTree.fromJSON(json);
```

## Checkpointing

For session persistence and recovery.

### File-based Checkpoints

```typescript
import { agent, AgentState } from '@providerprotocol/agents';
import { fileCheckpoints } from '@providerprotocol/agents/checkpoint';

const store = fileCheckpoints({ dir: '.checkpoints' });

const myAgent = agent({
  model: anthropic('claude-sonnet-4-20250514'),
  checkpoints: store,
  sessionId: 'my-session', // Auto-generated UUIDv4 if not provided
});

// Execute - checkpoints saved automatically after each step
const { turn, state } = await myAgent.generate('Hello', AgentState.initial());

// Later: manually load checkpoint
const savedState = await store.load('my-session');
if (savedState) {
  const restoredState = AgentState.fromJSON(savedState);
  // Continue from saved state
  const { turn: t2 } = await myAgent.generate('Continue', restoredState);
}

// List all sessions
const sessions = await store.list();

// Delete a session
await store.delete('my-session');
```

### Custom Checkpoint Store

```typescript
import type { CheckpointStore, AgentStateJSON } from '@providerprotocol/agents';

const customStore: CheckpointStore = {
  async save(sessionId: string, state: AgentStateJSON): Promise<void> {
    // Save to database, S3, etc.
  },
  async load(sessionId: string): Promise<AgentStateJSON | null> {
    // Load from storage
  },
  async delete(sessionId: string): Promise<void> {
    // Delete from storage
  },
  async list(): Promise<string[]> {
    // List all session IDs
  },
};
```

## Strategy Hooks

Control agent lifecycle with hooks:

```typescript
const agent = agent({
  model: anthropic('claude-sonnet-4-20250514'),
  strategy: {
    // Stop execution when condition is met
    stopCondition: async (state) => {
      return state.step > 50 || state.metadata.shouldStop === true;
    },

    // Called when each step begins
    onStepStart: (step, state) => {
      console.log(`Step ${step} starting...`);
    },

    // Called during reasoning phase (ReAct strategy)
    onReason: (step, reasoning) => {
      console.log(`Reasoning: ${reasoning}`);
    },

    // Called when tools are invoked
    onAct: (step, toolCalls) => {
      console.log(`Tools: ${toolCalls.map(t => t.toolName).join(', ')}`);
    },

    // Called when tool results are received
    onObserve: (step, observations) => {
      console.log(`Results: ${observations.length} tool outputs`);
    },

    // Called when each step completes
    onStepEnd: (step, result) => {
      console.log(`Step ${step} complete, tokens: ${result.turn.usage?.totalTokens}`);
    },

    // Called when execution completes successfully
    onComplete: (result) => {
      console.log(`Done! Total steps: ${result.state.step}`);
    },

    // Called on error
    onError: (error, state) => {
      console.error(`Error at step ${state.step}: ${error.message}`);
      // Optionally return recovery result
      return undefined;
    },
  },
});
```

## Stream Events

### UAP Events (source: 'uap')

Agent-level events from execution strategies:

| Event | Data | Description |
|-------|------|-------------|
| `step_start` | `{ step, agentId, data }` | Step began |
| `step_end` | `{ step, agentId, data }` | Step completed |
| `reasoning` | `{ step, agentId, data: { reasoning } }` | ReAct reasoning |
| `action` | `{ step, agentId, data: { toolCalls } }` | Tools invoked |
| `observation` | `{ step, agentId, data: { observations } }` | Tool results |
| `plan_created` | `{ step, agentId, data: { plan } }` | Plan generated |
| `plan_step_start` | `{ step, agentId, data: { planStep } }` | Plan step began |
| `plan_step_end` | `{ step, agentId, data: { planStep } }` | Plan step done |
| `subagent_start` | `{ subagentId, subagentType, parentToolCallId, prompt, timestamp }` | Sub-agent started |
| `subagent_event` | `{ subagentId, subagentType, parentToolCallId, innerEvent }` | Sub-agent inner event |
| `subagent_end` | `{ subagentId, subagentType, parentToolCallId, success, result, error, timestamp, toolExecutions, usage }` | Sub-agent completed |

### UPP Events (source: 'upp')

LLM-level events from @providerprotocol/ai:

| Event | Data | Description |
|-------|------|-------------|
| `text_delta` | `{ delta: { text } }` | Streaming text |
| `tool_call_delta` | `{ delta: { toolCallId, toolName, argumentsJson } }` | Tool call streaming |
| `message_start` | - | Message began |
| `message_stop` | - | Message completed |
| `content_block_start` | - | Content block began |
| `content_block_stop` | - | Content block done |

## Tool Dependencies

Tools can declare execution ordering:

```typescript
import type { ToolWithDependencies } from '@providerprotocol/agents/execution';

const readTool: ToolWithDependencies = {
  name: 'read_file',
  description: 'Read file contents',
  parameters: { /* ... */ },
  sequential: true,  // Must complete before other tools
  run: async (params) => { /* ... */ },
};

const writeTool: ToolWithDependencies = {
  name: 'write_file',
  description: 'Write file contents',
  parameters: { /* ... */ },
  dependsOn: ['read_file'],  // Waits for read_file
  run: async (params) => { /* ... */ },
};
```

## Sub-agents

Agents can spawn sub-agents via tools. The SDK provides utilities for proper event propagation.

### Using createSubAgentTool()

The recommended way to create sub-agent tools with full event propagation:

```typescript
import { agent, createSubAgentTool } from '@providerprotocol/agents';
import { anthropic } from '@providerprotocol/ai/anthropic';

// Create the sub-agent
const explorer = agent({
  model: anthropic('claude-3-5-haiku-latest'),
  params: { max_tokens: 2000 },
  tools: [globTool, grepTool, readTool],
  system: 'You explore codebases to find relevant information.',
});

// Wrap as a tool with event propagation
const explorerTool = createSubAgentTool({
  agent: explorer,
  name: 'explore',
  description: 'Explore codebase for information',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to search for' },
    },
    required: ['query'],
  },
  buildPrompt: (params) => `Find: ${params.query}`,
  subagentType: 'explorer',  // Used in events
  stream: true,              // Forward inner events (default: true)
});

// Use in parent agent
const coder = agent({
  model: anthropic('claude-sonnet-4-20250514'),
  tools: [explorerTool, writeTool],
});
```

### Sub-agent Events

When using `createSubAgentTool()`, these events are automatically emitted:

| Event | Fields | Description |
|-------|--------|-------------|
| `subagent_start` | `subagentId`, `subagentType`, `parentToolCallId`, `prompt`, `timestamp` | Sub-agent execution began |
| `subagent_event` | `subagentId`, `subagentType`, `parentToolCallId`, `innerEvent` | Forwarded event from sub-agent |
| `subagent_end` | `subagentId`, `subagentType`, `parentToolCallId`, `success`, `result`, `error`, `timestamp`, `toolExecutions`, `usage` | Sub-agent completed |

### Handling Sub-agent Events

```typescript
import type { OnSubagentEvent } from '@providerprotocol/agents';

const onSubagentEvent: OnSubagentEvent = (event) => {
  switch (event.type) {
    case 'subagent_start':
      console.log(`Sub-agent ${event.subagentType} started: ${event.prompt}`);
      break;
    case 'subagent_event':
      if (event.innerEvent.source === 'upp' && event.innerEvent.upp?.type === 'text_delta') {
        process.stdout.write(event.innerEvent.upp.delta.text ?? '');
      }
      break;
    case 'subagent_end':
      console.log(`Sub-agent completed: ${event.success ? event.result : event.error}`);
      break;
  }
};
```

### Manual Sub-agent Tool

For custom control, you can create sub-agent tools manually:

```typescript
const explorerTool = {
  name: 'explore',
  description: 'Explore codebase for information',
  parameters: {
    type: 'object' as const,
    properties: {
      query: { type: 'string' as const },
    },
    required: ['query'],
  },
  run: async (params: { query: string }) => {
    const explorer = agent({
      model: anthropic('claude-3-5-haiku-latest'),
      params: { max_tokens: 2000 },
      tools: [globTool, grepTool, readTool],
    });

    const turn = await explorer.query(params.query);
    return turn.response.text;
  },
};
```

## Tool Context Injection

Tools can receive execution context (agentId, stateId, toolCallId) for tracing and sub-agent event propagation.

### Context-Aware Tools

Define tools that accept a second context parameter:

```typescript
import type { ToolExecutionContext } from '@providerprotocol/agents';

const myTool = {
  name: 'my_tool',
  description: 'A context-aware tool',
  parameters: { type: 'object', properties: {} },
  run: async (
    params: Record<string, unknown>,
    context?: ToolExecutionContext,
  ) => {
    console.log('Agent ID:', context?.agentId);
    console.log('State ID:', context?.stateId);
    console.log('Tool Call ID:', context?.toolCallId);

    // Forward sub-agent events
    if (context?.onSubagentEvent) {
      context.onSubagentEvent({
        type: 'subagent_start',
        subagentId: 'sub-1',
        subagentType: 'helper',
        parentToolCallId: context.toolCallId,
        prompt: 'Task prompt',
        timestamp: Date.now(),
      });
    }

    return 'result';
  },
};
```

### Injecting Context into Tools

Use `injectToolContext()` to wrap tools with context injection:

```typescript
import { injectToolContext } from '@providerprotocol/agents';

const wrappedTools = injectToolContext(
  [tool1, tool2],
  executionContext,
  { onSubagentEvent: handleSubagentEvents },
);
```

### Checking for Context-Aware Tools

```typescript
import { isContextAwareTool } from '@providerprotocol/agents';

if (isContextAwareTool(myTool)) {
  // Tool accepts context as second parameter
}
```

### Wrapping Tools with Context Handlers

```typescript
import { withToolContext } from '@providerprotocol/agents';

const wrapped = withToolContext(originalTool, async (params, context) => {
  // Custom logic with access to context
  console.log('Executing with context:', context?.agentId);
  return await originalTool.run(params);
});
```

## Tool Ordering

Execute tool calls respecting dependencies and sequential barriers.

### Declaring Tool Dependencies

```typescript
import type { ToolWithDependencies } from '@providerprotocol/agents/execution';

const readTool: ToolWithDependencies = {
  name: 'read_file',
  description: 'Read file contents',
  parameters: { /* ... */ },
  sequential: true,  // Creates a barrier - must complete before others
  run: async (params) => { /* ... */ },
};

const writeTool: ToolWithDependencies = {
  name: 'write_file',
  description: 'Write file contents',
  parameters: { /* ... */ },
  dependsOn: ['read_file'],  // Explicit dependency
  run: async (params) => { /* ... */ },
};
```

### Executing Ordered Tool Calls

```typescript
import { executeOrderedToolCalls } from '@providerprotocol/agents/execution';

const results = await executeOrderedToolCalls(
  toolCalls,  // ToolCall[] from model response
  tools,      // Tool[] with optional dependencies
  async (call, tool) => {
    // Custom executor
    return await tool.run(call.arguments);
  },
);

// Results include timing and error info
for (const result of results) {
  console.log(`${result.call.toolName}: ${result.isError ? result.error : result.result}`);
  console.log(`Duration: ${result.duration}ms`);
}
```

### Model-Driven Ordering

Models can hint at ordering via `after` field:

```typescript
import type { OrderedToolCall } from '@providerprotocol/agents/execution';

// Model response might include:
const toolCall: OrderedToolCall = {
  toolCallId: 'call-2',
  toolName: 'write_file',
  arguments: { path: 'out.txt', content: '...' },
  after: ['call-1'],  // Execute after call-1 completes
};
```

## Provider Support

All providers from `@providerprotocol/ai` are supported:

```typescript
// Anthropic
import { anthropic } from '@providerprotocol/ai/anthropic';
agent({ model: anthropic('claude-sonnet-4-20250514'), params: { max_tokens: 4096 } });

// OpenAI
import { openai } from '@providerprotocol/ai/openai';
agent({ model: openai('gpt-4o'), params: { max_output_tokens: 4096 } });

// Google
import { google } from '@providerprotocol/ai/google';
agent({ model: google('gemini-2.0-flash'), params: { maxOutputTokens: 4096 } });

// Ollama (local)
import { ollama } from '@providerprotocol/ai/ollama';
agent({ model: ollama('llama3:8b'), params: { num_predict: 4096 } });

// OpenRouter
import { openrouter } from '@providerprotocol/ai/openrouter';
agent({ model: openrouter('anthropic/claude-3.5-sonnet'), params: { max_tokens: 4096 } });

// xAI
import { xai } from '@providerprotocol/ai/xai';
agent({ model: xai('grok-2'), params: { max_tokens: 4096 } });
```

## Environment Variables

Set API keys in `.env` (Bun auto-loads):

```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=AI...
XAI_API_KEY=xai-...
OPENROUTER_API_KEY=sk-or-...
```

## Testing

Run tests with Bun:

```bash
bun test              # All tests
bun test:unit         # Unit tests only
bun test:live         # Live API tests
```

## Complete Example

```typescript
import { agent, AgentState } from '@providerprotocol/agents';
import { react } from '@providerprotocol/agents/execution';
import { logging } from '@providerprotocol/agents/middleware';
import { anthropic } from '@providerprotocol/ai/anthropic';

// Define tools
const readFile = {
  name: 'read_file',
  description: 'Read contents of a file',
  parameters: {
    type: 'object' as const,
    properties: {
      path: { type: 'string' as const, description: 'File path' },
    },
    required: ['path'],
  },
  run: async (params: { path: string }) => {
    return await Bun.file(params.path).text();
  },
};

// Create agent
const coder = agent({
  model: anthropic('claude-sonnet-4-20250514'),
  params: { max_tokens: 8192 },
  system: `You are an expert software engineer.
Always read files before suggesting changes.
Think step by step about the best approach.`,
  tools: [readFile],
  execution: react({ maxSteps: 10 }),
  middleware: [logging({ level: 'info' })],
  strategy: {
    onStepEnd: (step, result) => {
      console.log(`Step ${step}: ${result.turn.usage?.totalTokens} tokens`);
    },
  },
});

// Interactive session
async function main() {
  let state = AgentState.initial();

  // First turn
  const r1 = await coder.ask('Read package.json and summarize dependencies', state);
  console.log(r1.turn.response.text);
  state = r1.state;

  // Follow-up (with context)
  const r2 = await coder.ask('Which of these are dev dependencies?', state);
  console.log(r2.turn.response.text);
}

main();
```

## Key Exports

```typescript
// Main entry
import { agent, AgentState } from '@providerprotocol/agents';

// Types
import type {
  Agent,
  AgentOptions,
  GenerateResult,
  AgentStreamResult,
  AgentStreamEvent,
  AgentStrategy,
} from '@providerprotocol/agents';

// Execution strategies
import { loop, react, plan } from '@providerprotocol/agents/execution';
import type { LoopOptions, ReactOptions, PlanOptions } from '@providerprotocol/agents/execution';

// Tool ordering
import { executeOrderedToolCalls, orderToolCalls } from '@providerprotocol/agents/execution';
import type {
  ToolWithDependencies,
  OrderedToolCall,
  ExecutionGroup,
  ToolExecutionResult,
  ToolExecutor,
} from '@providerprotocol/agents/execution';

// Sub-agent tools
import { createSubAgentTool } from '@providerprotocol/agents';
import type { CreateSubAgentToolOptions, SubAgentToolRun } from '@providerprotocol/agents';

// Tool context injection
import { injectToolContext, withToolContext, isContextAwareTool } from '@providerprotocol/agents';
import type { ToolExecutionContext, ContextAwareToolRun } from '@providerprotocol/agents';

// Sub-agent events
import type {
  SubagentEvent,
  SubagentStartEvent,
  SubagentInnerEvent,
  SubagentEndEvent,
  OnSubagentEvent,
} from '@providerprotocol/agents';

// Middleware
import { logging } from '@providerprotocol/agents/middleware';
import type { Middleware, LoggingOptions } from '@providerprotocol/agents/middleware';

// Thread trees
import { ThreadTree, ThreadNode } from '@providerprotocol/agents/thread-tree';

// Checkpoints
import { fileCheckpoints } from '@providerprotocol/agents/checkpoint';
import type { CheckpointStore } from '@providerprotocol/agents';
```
