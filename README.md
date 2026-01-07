# @providerprotocol/agents

A powerful, flexible agent framework implementing the Unified Agent Protocol (UAP) 1.0. Built on top of [@providerprotocol/ai](https://github.com/providerprotocol/ai) for seamless multi-provider LLM support.

## Features

- **Functional State Management** - Immutable state with explicit data flow
- **Execution Strategies** - Choose from `loop`, `react`, or `plan` patterns
- **Middleware Pipeline** - Composable before/after hooks for logging, guardrails, etc.
- **Multi-Provider Support** - Works with Anthropic, OpenAI, Google, Ollama, and more
- **Streaming** - Full streaming support with UAP and UPP events
- **Checkpointing** - Built-in session persistence and recovery
- **Thread Trees** - Branching conversation support
- **Type-Safe** - 100% TypeScript with full type inference

## Installation

```bash
bun install @providerprotocol/agents @providerprotocol/ai
```

## Quick Start

```typescript
import { agent, AgentState } from '@providerprotocol/agents';
import { anthropic } from '@providerprotocol/ai/anthropic';

// Create an agent
const assistant = agent({
  model: anthropic('claude-sonnet-4-20250514'),
  params: { max_tokens: 4096 },
  system: 'You are a helpful assistant.',
});

// Single query (stateless)
const turn = await assistant.query('What is the capital of France?');
console.log(turn.response.text);

// Multi-turn conversation (stateful)
let state = AgentState.initial();
const r1 = await assistant.ask('My name is Alice.', state);
state = r1.state;

const r2 = await assistant.ask('What is my name?', state);
console.log(r2.turn.response.text); // "Alice"
```

## Adding Tools

```typescript
import { agent, AgentState } from '@providerprotocol/agents';
import { anthropic } from '@providerprotocol/ai/anthropic';

const calculator = {
  name: 'calculate',
  description: 'Evaluate a math expression',
  parameters: {
    type: 'object' as const,
    properties: {
      expression: { type: 'string' as const },
    },
    required: ['expression'],
  },
  run: async (params: { expression: string }) => {
    // Use a proper math parser in production
    return String(eval(params.expression));
  },
};

const mathBot = agent({
  model: anthropic('claude-sonnet-4-20250514'),
  params: { max_tokens: 1000 },
  tools: [calculator],
});

const turn = await mathBot.query('What is 42 * 17?');
console.log(turn.response.text);
console.log(turn.toolExecutions); // Shows calculator was used
```

## Execution Strategies

Choose how your agent thinks and acts:

### Loop (Default)

Simple tool loop - keeps executing until no more tool calls.

```typescript
import { loop } from '@providerprotocol/agents/execution';

const myAgent = agent({
  model: anthropic('claude-sonnet-4-20250514'),
  execution: loop({ maxIterations: 10 }),
});
```

### ReAct

Reason-Act-Observe pattern with explicit reasoning phase.

```typescript
import { react } from '@providerprotocol/agents/execution';

const myAgent = agent({
  model: anthropic('claude-sonnet-4-20250514'),
  execution: react({ maxSteps: 20 }),
});
```

### Plan

Generate a structured plan, then execute steps with dependencies.

```typescript
import { plan } from '@providerprotocol/agents/execution';

const myAgent = agent({
  model: anthropic('claude-sonnet-4-20250514'),
  execution: plan({ maxPlanSteps: 10, allowReplan: true }),
});
```

## Streaming

```typescript
const stream = myAgent.stream('Explain quantum computing', state);

for await (const event of stream) {
  if (event.source === 'upp' && event.upp?.type === 'text_delta') {
    process.stdout.write(event.upp.delta.text ?? '');
  }
}

const { turn, state: newState } = await stream.result;
```

## Middleware

```typescript
import { logging } from '@providerprotocol/agents/middleware';

const myAgent = agent({
  model: anthropic('claude-sonnet-4-20250514'),
  middleware: [
    logging({ level: 'info', includeTiming: true }),
  ],
});
```

Create custom middleware:

```typescript
import type { Middleware } from '@providerprotocol/agents/middleware';

const rateLimiter: Middleware = {
  name: 'rate-limiter',
  async before(context) {
    await checkRateLimit(context.agent.id);
    return context;
  },
  async after(context, result) {
    recordUsage(result.turn.usage);
    return result;
  },
};
```

## Checkpointing

Persist agent sessions for recovery:

```typescript
import { fileCheckpoints } from '@providerprotocol/agents/checkpoint';

const store = fileCheckpoints({ dir: '.checkpoints' });

const myAgent = agent({
  model: anthropic('claude-sonnet-4-20250514'),
  checkpoints: store,
  sessionId: 'my-session',
});

// Execute - state automatically saved after each step
await myAgent.generate('Hello', AgentState.initial());

// Later: restore and continue
const saved = await store.load('my-session');
if (saved) {
  const state = AgentState.fromJSON(saved);
  await myAgent.generate('Continue...', state);
}
```

## Lifecycle Hooks

```typescript
const myAgent = agent({
  model: anthropic('claude-sonnet-4-20250514'),
  strategy: {
    stopCondition: (state) => state.step > 50,
    onStepStart: (step, state) => console.log(`Step ${step}`),
    onAct: (step, toolCalls) => console.log('Tools:', toolCalls),
    onComplete: (result) => console.log('Done!'),
    onError: (error, state) => console.error(error),
  },
});
```

## Provider Support

Works with all providers from `@providerprotocol/ai`:

```typescript
import { anthropic } from '@providerprotocol/ai/anthropic';
import { openai } from '@providerprotocol/ai/openai';
import { google } from '@providerprotocol/ai/google';
import { ollama } from '@providerprotocol/ai/ollama';

// Anthropic
agent({ model: anthropic('claude-sonnet-4-20250514'), params: { max_tokens: 4096 } });

// OpenAI
agent({ model: openai('gpt-4o'), params: { max_output_tokens: 4096 } });

// Google
agent({ model: google('gemini-2.0-flash'), params: { maxOutputTokens: 4096 } });

// Ollama (local)
agent({ model: ollama('llama3:8b'), params: { num_predict: 4096 } });
```

## Environment Variables

Create a `.env` file with your API keys:

```env
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=AI...
```

## API Reference

### agent(options)

Creates an agent instance.

| Option | Type | Description |
|--------|------|-------------|
| `model` | `ModelReference` | Required. Model from UPP provider |
| `params` | `object` | LLM parameters (provider-specific) |
| `system` | `string` | System prompt |
| `tools` | `Tool[]` | Available tools |
| `execution` | `ExecutionStrategy` | Strategy: `loop()`, `react()`, `plan()` |
| `middleware` | `Middleware[]` | Middleware pipeline |
| `strategy` | `AgentStrategy` | Lifecycle hooks |
| `checkpoints` | `CheckpointStore` | Session persistence |
| `sessionId` | `string` | Session identifier |

### Agent Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `generate(input, state)` | `Promise<GenerateResult>` | Execute with state |
| `stream(input, state)` | `AgentStreamResult` | Stream execution |
| `ask(input, state)` | `Promise<GenerateResult>` | Multi-turn convenience |
| `query(input)` | `Promise<Turn>` | Stateless single-turn |

### AgentState

Immutable state with chainable operations:

```typescript
state.withMessage(msg)       // Add message
state.withMessages(msgs)     // Add messages
state.withContext(msgs)      // Replace all messages
state.withStep(n)            // Set step number
state.withMetadata(k, v)     // Add metadata
state.withReasoning(text)    // Add reasoning trace
state.withPlan(steps)        // Set execution plan
state.toJSON()               // Serialize
AgentState.fromJSON(json)    // Deserialize
```

## Examples

See the [`examples/`](./examples) directory for complete examples:

- **coding-agent** - A Claude Code-style coding assistant with file operations, bash, search, and sub-agents

Run the coding agent example:

```bash
ANTHROPIC_API_KEY=sk-... bun examples/coding-agent/index.ts "List all TypeScript files"
```

Interactive mode:

```bash
ANTHROPIC_API_KEY=sk-... bun examples/coding-agent/index.ts -i
```

TUI mode:

```bash
ANTHROPIC_API_KEY=sk-... bun examples/coding-agent/index.ts --tui
```

## Testing

```bash
bun test              # All tests
bun test:unit         # Unit tests
bun test:live         # Live API tests
bun lint              # Lint
bun typecheck         # Type check
```

## Philosophy

**"UAP is a pipe, not a nanny."**

This framework provides orchestration primitives with sensible defaults but no artificial limits. By default:

- Execution continues until naturally complete (no max iterations)
- State is explicit and immutable
- All UPP types flow through without abstraction
- You control safety, budgets, and constraints

## Documentation

- [llms.md](./llms.md) - Comprehensive API documentation for LLMs and developers
- [CLAUDE.md](./CLAUDE.md) - Project coding guidelines and @providerprotocol/ai usage

## License

MIT

## Related

- [@providerprotocol/ai](https://github.com/providerprotocol/ai) - Unified Provider Protocol for LLM inference
