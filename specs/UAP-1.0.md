# UAP-1.0: Unified Agent Protocol Specification

**Version:** 1.0.0
**Status:** Approved
**Built on:** UPP-1.2 (Unified Provider Protocol)
**Authors:** UAP Working Group

---

## Abstract

The Unified Agent Protocol (UAP) is a specification for building AI agents on top of the Unified Provider Protocol (UPP-1.2). This document defines the protocol semantics, data structures, and implementation requirements for building UAP-compliant agents, sessions, and execution strategies.

UAP extends UPP-1.2 with agent-level abstractions including decoupled execution strategies (ReAct, Plan, Loop), functional state management, sub-agent composition, and middleware pipelines. UAP preserves complete type uniformity with UPP-1.2, using all types from `@providerprotocol/ai` directly without abstraction or re-export.

**Core Philosophy:** UAP is a pipe, not a nanny. The protocol provides orchestration primitives; the developer provides the constraints.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Design Principles](#2-design-principles)
3. [Core Concepts](#3-core-concepts)
4. [Agent Interface](#4-agent-interface)
5. [Execution Strategies](#5-execution-strategies)
6. [Functional State Management](#6-functional-state-management)
7. [Thread Trees](#7-thread-trees)
8. [Sub-Agent Protocol](#8-sub-agent-protocol)
9. [Middleware](#9-middleware)
10. [Agent Strategy Hooks](#10-agent-strategy-hooks)
    - [10.4 ToolUseStrategy (UPP Passthrough)](#104-toolusestrategy-upp-passthrough)
11. [Streaming](#11-streaming)
12. [Serialization](#12-serialization)
    - [12.4 Checkpointing](#124-checkpointing)
13. [Data Type Definitions](#13-data-type-definitions)
14. [Conformance](#14-conformance)
15. [Security Considerations](#15-security-considerations)

---

## 1. Introduction

### 1.1 Purpose

AI agents require orchestration beyond simple LLM inference. UAP-1.0 establishes a standard protocol that:

- Provides agent abstractions built on UPP-1.2 primitives
- Decouples execution strategies from agent definitions
- Uses functional state management with explicit data flow
- Supports hierarchical agent composition (sub-agents)
- Provides middleware for cross-cutting concerns
- Maintains complete type uniformity with the underlying LLM library
- Places full control and responsibility with the developer

### 1.2 Scope

This specification covers:

- The `agent()` function interface for defining agents
- Execution strategies (`react()`, `plan()`, `loop()`)
- Functional state management with explicit state passing
- Thread tree structures for branching conversations
- Sub-agent communication via `ask()` and `query()` methods
- Middleware composition
- Agent strategy hooks
- Serialization format for persistence

### 1.3 Relationship to UPP-1.2

UAP-1.0 builds on UPP-1.2 and MUST use the following types directly from `@providerprotocol/ai`:

- `llm`, `LLMInstance`, `LLMOptions`
- `Thread`, `Turn`, `TokenUsage`
- `Message`, `UserMessage`, `AssistantMessage`, `ToolResultMessage`
- `Tool`, `ToolCall`, `ToolResult`, `ToolExecution`
- `ToolUseStrategy` (passed through to `llm()` for tool execution hooks)
- `StreamResult`, `StreamEvent`, `StreamEventType`
- `UPPError`, `ErrorCode`
- All provider factories (`anthropic`, `openai`, `google`, etc.)

UAP MUST NOT re-export, wrap, or abstract these types. Applications import directly from `@providerprotocol/ai` for these types.

### 1.4 Terminology

| Term | Definition |
|------|------------|
| **Agent** | An AI entity with a model, execution strategy, tools, and optional sub-agents |
| **AgentState** | An immutable snapshot of agent execution state |
| **Step** | A single cycle of an execution strategy (reason-act-observe in ReAct) |
| **Sub-Agent** | An agent declared as a tool dependency for another agent |
| **Middleware** | A composable function that wraps agent execution |
| **Turn** | A UPP Turn representing the complete result of one LLM inference call |
| **Thread Tree** | A tree-structured collection of threads with parent-child relationships |

### 1.5 Requirements Language

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in RFC 2119.

### 1.6 Notation Conventions

This specification uses language-agnostic pseudocode for examples. The pseudocode follows these conventions:

- Function calls: `function_name(arg1, arg2)`
- Object/map literals: `{key: value, key2: value2}`
- Array/list literals: `[item1, item2, item3]`
- Property access: `object.property`
- Method calls: `object.method(args)`
- Async operations: `await expression`
- Iteration: `for item in collection`
- Type annotations: `variable: Type`
- Optional values: `Type?` or `Optional<Type>`
- Comments: `// comment text`

### 1.7 Code Examples

Code examples in this specification use the placeholder package name `agents`. Implementations MUST choose an appropriate package name for their ecosystem:

| Language | Example Package Name |
|----------|---------------------|
| JavaScript/TypeScript | `@providerprotocol/agents` |
| Python | `providerprotocol-agents` |
| Go | `github.com/providerprotocol/agents` |
| Rust | `providerprotocol-agents` |

Import examples throughout this specification use JavaScript-style imports for readability:

```pseudocode
// Agent SDK imports
import { agent } from "agents"
import { react, plan, loop } from "agents/execution"
import { logging } from "agents/middleware"

// UPP-1.2 imports (used directly, never re-exported)
import { llm, Thread, UserMessage, Tool } from "upp"
import anthropic from "upp/anthropic"
```

---

## 2. Design Principles

### 2.1 Type Uniformity with UPP-1.2

UAP MUST NOT create abstractions around UPP-1.2 types. All data flows through standard UPP types directly. This ensures:

- No impedance mismatch between agent and LLM layers
- Full access to provider-specific features
- No data truncation or morphing
- Transparent debugging and logging

```pseudocode
// CORRECT: Use UPP types directly
import { Thread, Turn, UserMessage } from "upp"

{ turn, state } = await agent.generate("Hello", initialState)
// turn is standard UPP Turn, state is explicit AgentState

// INCORRECT: Creating wrapper types
import { AgentTurn } from "agents"  // DO NOT DO THIS
```

**Rationale:** Wrapping library types creates maintenance burden, obscures debugging, and prevents access to provider-specific metadata. UAP agents operate on the same data structures as raw LLM calls.

### 2.2 Functional State Management

UAP adopts a functional state pattern. Agent execution is a pure transformation:

```
(Input, State) -> (Turn, NewState)
```

**Core Requirements:**

- `AgentState` is immutable—each operation returns a new state
- State is explicitly passed and returned, never mutated internally
- No "ghost history" from hidden state accumulation
- Developer controls what state persists between calls

```pseudocode
// Explicit state flow
state0 = AgentState.initial()

{ turn: turn1, state: state1 } = await agent.generate("First message", state0)
{ turn: turn2, state: state2 } = await agent.generate("Second message", state1)

// State is explicit and inspectable
print(state2.messages.length)  // Developer knows exactly what's there
print(state2.step)             // Current step count

// Branching is trivial—just use different states
{ turn: turn3a, state: state3a } = await agent.generate("Option A", state1)
{ turn: turn3b, state: state3b } = await agent.generate("Option B", state1)
```

**Rationale:** Implicit state mutation violates UPP's "Explicit Over Magic" principle. Functional state makes data flow visible, debugging tractable, and serialization trivial.

### 2.3 Decoupled Execution

Execution strategies are separate from agent definitions:

- Agents define WHAT (model, tools, system prompt)
- Strategies define HOW (ReAct loop, plan-then-execute, simple loop)
- Strategies are interchangeable without changing agent definition

```pseudocode
// Same agent definition, different execution strategies
const coder = agent({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: [Bash, Read, Write],
  system: "You are a coding assistant.",
})

// Use ReAct for complex reasoning
const reactCoder = agent({ ...coder, execution: react() })

// Use simple loop for straightforward tasks
const loopCoder = agent({ ...coder, execution: loop() })
```

**Rationale:** Separating execution from definition mirrors UPP's separation of model binding from inference. It enables experimentation with different strategies without redefining agents.

### 2.4 Infinite by Default

UAP SHALL NOT impose artificial execution limits. Default behavior is unbounded execution:

- `maxIterations`: `Infinity` (not 10)
- `maxSteps`: `Infinity` (not 10)
- `toolStrategy.maxIterations`: `Infinity` (UPP tool loop limit)
- `timeout`: `undefined` (no timeout)

**Rationale:** UAP is a pipe, not a nanny. The model should complete tasks based on its own internal logic. Artificial ceilings create unexpected truncation and incomplete results.

Developers who want limits MUST explicitly configure them:

```pseudocode
// No limits - model runs until it decides to stop
agent({
  model: anthropic("claude-sonnet-4-20250514"),
  execution: react(),  // maxSteps: Infinity by default
  // toolStrategy.maxIterations: Infinity by default (UPP level)
})

// Developer explicitly sets limits
agent({
  model: anthropic("claude-sonnet-4-20250514"),
  execution: react({ maxSteps: 20 }),  // Explicit UAP step limit
  toolStrategy: {
    maxIterations: 50,  // Explicit UPP tool iteration limit
  },
  strategy: {
    stopCondition: (state) => state.metadata.budget > 10000,  // Custom limit
  },
})
```

### 2.5 Developer Responsibility

UAP places full control and full responsibility with the developer:

- The protocol provides orchestration primitives
- The developer provides safety constraints
- Runaway agents are a developer concern, not a protocol concern
- Resource exhaustion is a deployment concern, not a protocol concern

This is analogous to how operating systems provide `fork()` without limiting process count—the administrator manages resources.

### 2.6 Explicit Sub-Agent Declaration

Sub-agents are tools. Tools require explicit schemas. Therefore, sub-agents require explicit schemas.

UAP MUST NOT auto-generate tool schemas from agent definitions. This prevents:

- Leaky abstractions from system prompt inference
- Unpredictable behavior from schema guessing
- Hidden coupling between parent and child agents

```pseudocode
// CORRECT: Explicit sub-agent tool declaration
explorer = agent({
  model: anthropic("claude-haiku-4-20250514"),
  tools: [Glob, Grep, Read],
})

// Must explicitly define the tool interface
explorerTool: Tool = {
  name: "explore_codebase",
  description: "Explores and analyzes codebase structure",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "What to explore" },
      depth: { type: "number", description: "Search depth" },
    },
    required: ["query"],
  },
  run: async (params) => {
    { turn } = await explorer.generate(params.query, AgentState.initial())
    return turn.response.text
  },
}

// INCORRECT: Magic schema generation
explorerTool = explorer.toTool()  // DO NOT DO THIS
```

---

## 3. Core Concepts

### 3.1 The Agent Architecture

```
+-----------------------------------------------------------------------+
|                        Application Code                                |
+-----------------------------------------------------------------------+
            |
            v
     +-------------+
     |   agent()   |  generate(input, state) -> { turn, state }
     +-------------+
            |
            v
+-----------------------------------------------------------------------+
|                       Middleware Pipeline                              |
|    +----------+  +------------+  +---------+                          |
|    | logging  |->| guardrails |->| budget  |  (ordered, composable)   |
|    +----------+  +------------+  +---------+                          |
+-----------------------------------------------------------------------+
            |
            v
+-----------------------------------------------------------------------+
|                     Execution Strategy                                 |
|    +----------+      +--------+      +--------+                       |
|    |  react() |      | plan() |      | loop() |                       |
|    +----------+      +--------+      +--------+                       |
+-----------------------------------------------------------------------+
            |
            v
+-----------------------------------------------------------------------+
|                    @providerprotocol/ai (UPP-1.2)                      |
|    +-------+  +--------+  +--------+  +------+  +--------+            |
|    | llm() |  | Thread |  |  Turn  |  | Tool |  | Stream |            |
|    +-------+  +--------+  +--------+  +------+  +--------+            |
+-----------------------------------------------------------------------+
            |
            v
+-----------------------------------------------------------------------+
|                       Provider Adapters                                |
|    +----------+  +--------+  +--------+  +--------+                   |
|    | anthropic|  | openai |  | google |  | ollama |                   |
|    +----------+  +--------+  +--------+  +--------+                   |
+-----------------------------------------------------------------------+
```

### 3.2 Import Patterns

UAP implementations MUST provide separate entry points for different functionality:

```pseudocode
// Main entry point - agent factory
import { agent, AgentState } from "agents"

// Execution strategies
import { loop, react, plan } from "agents/execution"

// Middleware (v1: logging only)
import { logging } from "agents/middleware"

// UPP imports remain unchanged
import { llm, Thread, Turn, UserMessage, Tool } from "upp"
import anthropic from "upp/anthropic"
import openai from "upp/openai"
```

### 3.3 Data Flow

The functional data flow:

```
Input + State₀  →  Agent.generate()  →  Turn + State₁
                        │
                        ├── Middleware.before(context)
                        │
                        ├── Strategy.execute()
                        │       │
                        │       ├── llm.generate() [UPP]
                        │       │
                        │       ├── Tool execution (parallel/sequential)
                        │       │
                        │       └── Step hooks
                        │
                        └── Middleware.after(context, turn)
```

Each call is stateless from the agent's perspective—all state is passed in and returned explicitly.

### 3.4 Identity Model

All agent entities MUST have UUIDv4 identifiers:

| Entity | ID Field | Description |
|--------|----------|-------------|
| Agent | `agent.id` | Unique agent instance ID |
| AgentState | `state.id` | State snapshot ID (changes on mutation) |
| Session | `sessionId` | Session identifier for checkpointing |
| Checkpoint | `checkpointId` | Unique checkpoint snapshot ID |

**Note:** Step numbers (`step`) are integers representing sequential execution order, not UUIDs.

**Session ID Generation:**
- When `checkpoints` is provided to `agent()`, a `sessionId` MUST be generated if not provided
- Session IDs MUST be UUIDv4
- The `sessionId` MUST be included in `state.metadata.sessionId` after execution

Turn identity comes from UPP. UAP tracks execution context separately:

```pseudocode
// Execution context tracks lineage
context = {
  agentId: agent.id,
  stateId: state.id,
  sessionId?: sessionId,         // For checkpointing
  parentContext?: parentContext,  // For sub-agent calls
}
```

---

## 4. Agent Interface

### 4.1 Function Signature

```pseudocode
agent(options: AgentOptions) -> Agent
```

### 4.2 AgentOptions Structure

`AgentOptions` extends `LLMOptions` from UPP-1.2 for full passthrough of LLM configuration. This ensures complete type uniformity—any option valid for `llm()` is valid for `agent()`.

**UAP-Specific Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `model` | ModelReference | Yes | A model reference from a UPP provider factory |
| `execution` | ExecutionStrategy | No | Execution strategy (default: loop()) |
| `middleware` | List<Middleware> | No | Ordered middleware pipeline |
| `strategy` | AgentStrategy | No | Agent lifecycle hooks |
| `checkpoints` | CheckpointStore | No | Checkpoint store for step-level persistence |
| `sessionId` | String | No | Session identifier (auto-generated if not provided) |

**LLM Passthrough Fields (from LLMOptions):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `params` | Map | No | Model-specific parameters (passed to llm()) |
| `config` | ProviderConfig | No | Provider infrastructure configuration |
| `tools` | List<Tool> | No | Tools available to the agent |
| `system` | String | No | System prompt |
| `structure` | JSONSchema | No | Structured output schema |
| `toolStrategy` | ToolUseStrategy | No | Tool execution hooks (passed to llm()) |

**Note:** The `tools` field accepts only `Tool` objects. Sub-agents must be explicitly converted to tools with defined schemas (see Section 8).

**Note:** The `toolStrategy` field is passed directly to the underlying `llm()` instance. Per Section 2.4, `toolStrategy.maxIterations` defaults to `Infinity` when not specified.

### 4.3 Agent Interface

| Property/Method | Type | Description |
|-----------------|------|-------------|
| `id` | String | Unique agent identifier (UUIDv4) |
| `model` | ModelReference | The bound model |
| `tools` | List<Tool> | Available tools |
| `system` | String? | System prompt |
| `generate(input, state)` | Function | Execute agent, return Turn and new state |
| `stream(input, state)` | Function | Execute agent with streaming |
| `ask(input, state)` | Function | Multi-turn execution, history preserved |
| `query(input)` | Function | Stateless single-turn execution |

### 4.4 generate() Method

The primary execution method. Follows the functional pattern `(Input, State) -> (Turn, NewState)`.

**Signature:**

```pseudocode
generate(input: String | Message, state: AgentState) -> Promise<GenerateResult>
```

**GenerateResult Structure:**

| Field | Type | Description |
|-------|------|-------------|
| `turn` | Turn | Standard UPP Turn |
| `state` | AgentState | New immutable state |

**Usage:**

```pseudocode
import { agent, AgentState } from "agents"
import anthropic from "upp/anthropic"

coder = agent({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: [Bash, Read, Write],
  system: "You are a coding assistant.",
})

// Initialize state
state0 = AgentState.initial()

// First generation
{ turn: turn1, state: state1 } = await coder.generate(
  "Create a hello world program",
  state0
)
print(turn1.response.text)

// Second generation with updated state
{ turn: turn2, state: state2 } = await coder.generate(
  "Add error handling",
  state1
)
```

### 4.5 stream() Method

Streaming execution with the same functional pattern.

**Signature:**

```pseudocode
stream(input: String | Message, state: AgentState) -> AgentStreamResult
```

**AgentStreamResult:**

- Async iterable of `AgentStreamEvent`
- `result: Promise<GenerateResult>` - resolves after completion
- `abort(): void` - cancel the stream

```pseudocode
stream = coder.stream("Implement a feature", state0)

for await (event of stream) {
  // Process events
}

{ turn, state: newState } = await stream.result
```

### 4.6 ask() Method

Multi-turn execution where history is preserved in state. This is a convenience method that:
1. Appends input to state history
2. Calls generate()
3. Appends response to returned state

**Signature:**

```pseudocode
ask(input: String | Message, state: AgentState) -> Promise<GenerateResult>
```

**Usage:**

```pseudocode
state0 = AgentState.initial()

// ask() automatically manages conversation history
{ turn: t1, state: s1 } = await agent.ask("My name is Alice", state0)
{ turn: t2, state: s2 } = await agent.ask("What is my name?", s1)
// t2.response.text contains "Alice" - context preserved
```

**Equivalence:**

```pseudocode
// ask() is equivalent to:
ask(input, state) {
  newState = state.withMessage(UserMessage(input))
  result = await this.generate(input, newState)
  return {
    turn: result.turn,
    state: result.state.withMessages(result.turn.messages),
  }
}
```

**Implementation Note:** The pseudocode above describes the *conceptual* behavior of `ask()`. In practice, execution strategies typically add input to state internally (see Section 5). Implementations where strategies handle message addition MAY implement `ask()` as a simple delegation to `generate()`:

```pseudocode
// Alternative implementation when strategies add input:
ask(input, state) {
  return this.generate(input, state)
}
```

The key requirement is that the returned state contains the complete conversation history (input + response). Implementations MUST NOT duplicate messages regardless of approach.

### 4.7 query() Method

Stateless single-turn execution. Creates ephemeral state, executes, and discards state. Useful for one-off questions that don't need context.

**Signature:**

```pseudocode
query(input: String | Message) -> Promise<Turn>
```

**Usage:**

```pseudocode
// No state management needed
turn = await agent.query("What is 2 + 2?")
print(turn.response.text)  // "4"

// State is not preserved - each query is independent
turn2 = await agent.query("What did I just ask?")
// turn2 has no context from turn1
```

**Equivalence:**

```pseudocode
// query() is equivalent to:
query(input) {
  { turn } = await this.generate(input, AgentState.initial())
  return turn
}
```

---

## 5. Execution Strategies

### 5.1 ExecutionStrategy Interface

```pseudocode
interface ExecutionStrategy {
  name: String
  execute(context: ExecutionContext) -> Promise<ExecutionResult>
  stream(context: ExecutionContext) -> AgentStreamResult
}
```

**ExecutionContext Structure:**

| Field | Type | Description |
|-------|------|-------------|
| `agent` | Agent | The agent being executed |
| `llm` | LLMInstance | The bound LLM instance |
| `input` | Message | The user input message |
| `state` | AgentState | Current immutable state |
| `tools` | List<Tool> | Resolved tools |
| `strategy` | AgentStrategy | Agent lifecycle hooks |
| `signal` | AbortSignal? | Abort signal for cancellation |

**ExecutionResult Structure:**

| Field | Type | Description |
|-------|------|-------------|
| `turn` | Turn | The complete UPP Turn |
| `state` | AgentState | New immutable state |

### 5.2 loop() Strategy

The simplest strategy—equivalent to UPP's tool loop behavior.

```pseudocode
loop(options?: LoopOptions) -> ExecutionStrategy
```

**LoopOptions Structure:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxIterations` | Integer | Infinity | Maximum tool execution rounds |

**Behavior:**

1. Send input to LLM
2. If response has tool calls, execute tools and loop
3. Continue until no tool calls or max iterations (if set)
4. Return final response as UPP Turn

```pseudocode
import { agent } from "agents"
import { loop } from "agents/execution"

// Infinite by default - loops until model stops calling tools
simple = agent({
  model: anthropic("claude-sonnet-4-20250514"),
  execution: loop(),  // maxIterations: Infinity
  tools: [calculator],
})

// Explicit limit when needed
limited = agent({
  model: anthropic("claude-sonnet-4-20250514"),
  execution: loop({ maxIterations: 5 }),
  tools: [calculator],
})
```

### 5.3 react() Strategy

ReAct (Reason-Act-Observe) loop with explicit reasoning phases.

```pseudocode
react(options?: ReactOptions) -> ExecutionStrategy
```

**ReactOptions Structure:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxSteps` | Integer | Infinity | Maximum reason-act-observe cycles |
| `reasoningPrompt` | String | (default) | Prompt suffix for reasoning phase |

**Behavior:**

1. **Reason**: LLM outputs reasoning about what to do next
2. **Act**: LLM selects and executes tool(s)
3. **Observe**: Tool results are formatted as observations
4. Repeat until stop condition, no more actions, or max steps (if set)

**Step Lifecycle:**

```pseudocode
step = 0
while (true) {
  step++
  newState = state.withStep(step)
  strategy.onStepStart?.(step, newState)

  // Reason phase
  reasoningTurn = await llm.generate(
    buildHistory(newState),
    "Think about what to do next."
  )
  reasoning = reasoningTurn.response.text
  newState = newState.withReasoning(reasoning)
  strategy.onReason?.(step, reasoning)

  // Act phase
  actionTurn = await llm.generate(
    buildHistory(newState),
    "Based on your reasoning, take action."
  )

  if (actionTurn.response.hasToolCalls) {
    strategy.onAct?.(step, actionTurn.response.toolCalls)
    // Tool execution happens via UPP
    strategy.onObserve?.(step, actionTurn.toolExecutions)
  }

  newState = newState.withMessages(actionTurn.messages)
  strategy.onStepEnd?.(step, { turn: actionTurn, state: newState })

  // Check termination
  if (strategy.stopCondition?.(newState)) break
  if (!actionTurn.response.hasToolCalls) break
  // Note: No maxSteps check if maxSteps is Infinity
  if (options.maxSteps !== Infinity && step >= options.maxSteps) break
}

return { turn: buildFinalTurn(newState), state: newState }
```

**MUST Requirements:**

1. MUST emit `onReason`, `onAct`, `onObserve` hooks at appropriate phases
2. MUST track reasoning in state
3. MUST call `stopCondition` after each step
4. MUST NOT impose artificial limits unless explicitly configured

### 5.4 plan() Strategy

Plan-then-execute strategy with upfront planning phase.

```pseudocode
plan(options?: PlanOptions) -> ExecutionStrategy
```

**PlanOptions Structure:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxPlanSteps` | Integer | Infinity | Maximum steps in a plan |
| `allowReplan` | Boolean | true | Allow replanning on failure |
| `planSchema` | JSONSchema | (default) | Schema for plan structure |

**PlanStep Structure:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Step identifier |
| `description` | String | What this step does |
| `tool` | String? | Tool to use (if applicable) |
| `dependsOn` | List<String> | IDs of steps this depends on |
| `status` | String | "pending" \| "in_progress" \| "completed" \| "failed" |

**Behavior:**

1. **Plan**: LLM generates structured plan with steps and dependencies
2. **Execute**: Execute each plan step respecting dependency order
3. **Replan**: If a step fails and `allowReplan`, generate new plan

**MUST Requirements:**

1. MUST produce structured plan via structured output
2. MUST respect step dependencies (topological order)
3. MUST track plan in state
4. MUST update step status during execution

### 5.5 Custom Strategies

Implementations MUST allow custom execution strategies:

```pseudocode
customStrategy: ExecutionStrategy = {
  name: "custom",

  execute: async (context) => {
    { agent, llm, input, state, strategy } = context

    strategy.onStepStart?.(1, state)

    // Custom execution logic
    turn = await llm.generate(state.messages, input)
    newState = state.withMessages(turn.messages)

    strategy.onStepEnd?.(1, { turn, state: newState })

    return { turn, state: newState }
  },

  stream: (context) => {
    // Streaming implementation
  },
}
```

---

## 6. Functional State Management

### 6.1 AgentState Structure

`AgentState` is an immutable snapshot of agent execution state.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | State snapshot ID (UUIDv4) |
| `messages` | List<Message> | Conversation history (UPP Messages) |
| `step` | Integer | Current step number |
| `metadata` | Map | User-defined metadata |
| `reasoning` | List<String> | Reasoning traces (for ReAct) |
| `plan` | List<PlanStep>? | Execution plan (for Plan strategy) |

### 6.2 State Operations

All state operations return new state instances:

```pseudocode
interface AgentState {
  // Factory
  static initial() -> AgentState

  // Immutable operations - all return new AgentState
  withMessage(message: Message) -> AgentState
  withMessages(messages: List<Message>) -> AgentState
  withContext(messages: List<Message>) -> AgentState
  withStep(step: Integer) -> AgentState
  withMetadata(key: String, value: Any) -> AgentState
  withReasoning(reasoning: String) -> AgentState
  withPlan(plan: List<PlanStep>) -> AgentState

  // Serialization
  toJSON() -> AgentStateJSON
  static fromJSON(json: AgentStateJSON) -> AgentState
}
```

**Message Operations:**

- `withMessage(message)` — Appends a single message to history
- `withMessages(messages)` — Appends multiple messages to history
- `withContext(messages)` — **Replaces** entire message history

The distinction between `withMessages` and `withContext` is critical:

```pseudocode
state = AgentState.initial()
  .withMessage(UserMessage("Hello"))
  .withMessage(AssistantMessage("Hi"))

// Append: messages = [Hello, Hi, Goodbye]
state.withMessages([UserMessage("Goodbye")])

// Replace: messages = [Fresh start]
state.withContext([UserMessage("Fresh start")])
```

**Context Window Management:**

`withContext(messages)` enables context window management via middleware. UAP does not provide token estimation or model limits—developers are responsible for their model's constraints.

**Pattern 1: Prune Old Tool Outputs**

Tool outputs (file reads, command results) consume significant tokens and become stale. Prune them while protecting recent context:

```pseudocode
pruneToolOutputs: Middleware = {
  name: "prune-tool-outputs",

  before: async (ctx) => {
    // Simple token estimation: ~4 chars per token
    estimate = (msg) => JSON.stringify(msg).length / 4
    total = sum(ctx.state.messages.map(estimate))

    // Model-specific limit (developer knows their model)
    CONTEXT_LIMIT = 200000
    OUTPUT_RESERVE = 16000
    PROTECT_RECENT = 40000

    usable = CONTEXT_LIMIT - OUTPUT_RESERVE
    if (total <= usable) return ctx

    // Scan backwards, protect recent tokens, prune old tool outputs
    messages = [...ctx.state.messages]
    protected = 0

    for (i = messages.length - 1; i >= 0; i--) {
      msg = messages[i]
      msgTokens = estimate(msg)
      protected += msgTokens

      if (protected > PROTECT_RECENT && isToolResultMessage(msg)) {
        // Replace tool output with placeholder
        messages[i] = ToolResultMessage([{
          toolCallId: msg.results[0].toolCallId,
          result: "[Output cleared - context limit]"
        }])
      }
    }

    return { ...ctx, state: ctx.state.withContext(messages) }
  },
}
```

**Pattern 2: Sliding Window**

Keep only the N most recent messages:

```pseudocode
slidingWindow: Middleware = {
  name: "sliding-window",

  before: async (ctx) => {
    MAX_MESSAGES = 50
    messages = ctx.state.messages

    if (messages.length <= MAX_MESSAGES) return ctx

    // Keep most recent, ensuring we don't split user/assistant pairs
    truncated = messages.slice(-MAX_MESSAGES)
    return { ...ctx, state: ctx.state.withContext(truncated) }
  },
}
```

**Pattern 3: Summarize Old Context**

Use a smaller model to summarize old conversation before discarding:

```pseudocode
summarizeOldContext: Middleware = {
  name: "summarize-context",

  // Summarizer LLM passed at construction
  init: (summarizerLLM) => ({
    before: async (ctx) => {
      estimate = (msg) => JSON.stringify(msg).length / 4
      total = sum(ctx.state.messages.map(estimate))

      THRESHOLD = 150000
      KEEP_RECENT = 10

      if (total <= THRESHOLD) return ctx

      messages = ctx.state.messages
      old = messages.slice(0, -KEEP_RECENT)
      recent = messages.slice(-KEEP_RECENT)

      // Generate summary of old context
      summary = await summarizerLLM.query(
        "Summarize this conversation, preserving key facts:\n" +
        old.map(m => JSON.stringify(m)).join("\n")
      )

      // Replace with summary + recent messages
      return {
        ...ctx,
        state: ctx.state.withContext([
          UserMessage("[Previous conversation summary]\n" + summary.response.text),
          ...recent
        ])
      }
    },
  }),
}

// Usage
agent({
  middleware: [
    summarizeOldContext.init(
      llm({ model: anthropic("claude-3-5-haiku-latest"), params: { max_tokens: 500 } })
    ),
  ],
})
```

**Composing Strategies:**

Middleware composes naturally—apply multiple strategies in order:

```pseudocode
agent({
  middleware: [
    pruneToolOutputs(),      // First: clear stale tool outputs
    slidingWindow(100),      // Then: cap message count
    summarizeIfNeeded(llm),  // Finally: summarize if still over
  ],
})
```

### 6.3 State Flow Example

```pseudocode
// Initialize
s0 = AgentState.initial()
// s0 = { id: "uuid-1", messages: [], step: 0, metadata: {}, reasoning: [] }

// First interaction
{ turn: t1, state: s1 } = await agent.generate("Hello", s0)
// s1 = { id: "uuid-2", messages: [...t1.messages], step: 1, ... }

// s0 is unchanged - can branch
{ turn: t2a, state: s2a } = await agent.generate("Option A", s0)
{ turn: t2b, state: s2b } = await agent.generate("Option B", s0)

// Continue from s1
{ turn: t2, state: s2 } = await agent.generate("Continue", s1)

// Inspect any state at any time
print(s0.messages)  // []
print(s1.messages)  // [user, assistant from t1]
print(s2.messages)  // [user, assistant from t1, user, assistant from t2]
```

### 6.4 State Serialization

State serializes to JSON for persistence:

```pseudocode
// Save state
json = state.toJSON()
await storage.save(`state:${state.id}`, JSON.stringify(json))

// Restore state
saved = JSON.parse(await storage.load(`state:${state.id}`))
restored = AgentState.fromJSON(saved)

// Continue from restored state
{ turn, state: newState } = await agent.generate("Continue", restored)
```

### 6.5 MUST Requirements for State

1. `AgentState` MUST be immutable—operations return new instances
2. State operations MUST NOT mutate the original state
3. Each state MUST have a unique ID
4. State MUST be fully serializable via `toJSON()`
5. `fromJSON()` MUST restore exact state

---

## 7. Thread Trees

### 7.1 Thread Tree Structure

Thread trees provide optional tree-structured conversation management. They are built on `AgentState` and provide branching/merging utilities.

**ThreadTree Interface:**

| Property/Method | Type | Description |
|-----------------|------|-------------|
| `root` | ThreadNode | Root node |
| `current` | ThreadNode | Currently active node |
| `nodes` | Map<String, ThreadNode> | All nodes by ID |
| `branch(fromId, name?)` | Function | Create branch, returns node ID |
| `checkout(nodeId)` | Function | Switch active node |
| `history()` | Function | Get AgentState from root to current |
| `toJSON()` | Function | Serialize tree |

**ThreadNode Structure:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Node ID (UUIDv4) |
| `parentId` | String? | Parent node ID (null for root) |
| `state` | AgentState | State snapshot at this node |
| `name` | String? | Optional branch name |
| `children` | List<String> | Child node IDs |

### 7.2 Thread Tree Usage

```pseudocode
import { ThreadTree, AgentState } from "agents"

// Create tree
tree = new ThreadTree()

// Generate and update tree
{ turn: t1, state: s1 } = await agent.generate("First", tree.history())
tree.current.state = s1

// Branch for alternative
altId = tree.branch(tree.current.id, "alternative")
tree.checkout(altId)

{ turn: t2, state: s2 } = await agent.generate("Alternative path", tree.history())
tree.current.state = s2

// Switch back to main
tree.checkout(tree.root.id)
```

### 7.3 History Traversal

`history()` returns an `AgentState` containing all messages from root to current:

```pseudocode
// Tree: root -> A -> B (current)
tree.checkout(B.id)
state = tree.history()
// state.messages contains messages from root, A, B in order
```

---

## 8. Sub-Agent Protocol

### 8.1 Sub-Agents Are Tools

Sub-agents are agents used as tools by other agents. They are **not** special—they are regular UPP Tools with an implementation that calls another agent.

**Critical Requirement:** UAP MUST NOT auto-generate tool schemas from agents. All sub-agent tools require explicit schema declaration.

### 8.2 Explicit Tool Declaration

To use an agent as a sub-agent, the developer MUST create an explicit Tool:

```pseudocode
// Define the sub-agent
explorer = agent({
  model: anthropic("claude-haiku-4-20250514"),
  tools: [Glob, Grep, Read],
  system: "You explore codebases.",
})

// Explicitly define the tool interface
explorerTool: Tool = {
  name: "explore_codebase",
  description: "Explores codebase structure and finds relevant files",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "What to search for in the codebase",
      },
      fileTypes: {
        type: "array",
        items: { type: "string" },
        description: "File extensions to include (e.g., ['.ts', '.js'])",
      },
    },
    required: ["query"],
  },
  run: async (params) => {
    prompt = `Find: ${params.query}`
    if (params.fileTypes) {
      prompt += ` in files: ${params.fileTypes.join(", ")}`
    }
    turn = await explorer.query(prompt)
    return turn.response.text
  },
}

// Use in parent agent
coder = agent({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: [Bash, Write, explorerTool],
})
```

### 8.3 Why No Auto-Generation

Auto-generating tool schemas from agent definitions violates UAP principles:

1. **Leaky Abstraction**: System prompts may contain instructions not suitable for tool descriptions
2. **Unpredictable Schema**: No reliable way to infer parameter structure from an agent
3. **Hidden Coupling**: Changes to sub-agent system prompt would silently change tool interface
4. **Type Unsafety**: Auto-generated schemas can't be statically verified

The explicit approach ensures:

- Tool interface is intentionally designed
- Schema matches actual sub-agent capabilities
- Changes require explicit updates
- TypeScript/static typing can verify schemas

### 8.4 LLM Inheritance

Sub-agents inherit parent LLM configuration when not explicitly specified.

**Implementation Note:** UPP `Tool.run` functions receive only `params`. UAP's `ExecutionStrategy` MUST inject execution context when invoking tools. This is done by wrapping tool execution:

```pseudocode
// UAP ExecutionStrategy wraps tool invocation
async function executeTool(tool: Tool, params: Map, context: ExecutionContext) {
  // If tool needs context (e.g., for inheritance), wrap the call
  if (tool.run.length > 1) {
    // Tool expects context as second argument
    return tool.run(params, {
      parentModel: context.agent.model,
      parentConfig: context.agent.config,
      agentId: context.agent.id,
      stateId: context.state.id,
    })
  }
  // Standard UPP tool - params only
  return tool.run(params)
}
```

**Sub-agent tool with inheritance:**

```pseudocode
// Sub-agent without explicit model
helper = agent({
  // model not specified
  tools: [Read],
  system: "You help with tasks.",
})

// Tool explicitly handles inheritance via context
helperTool: Tool = {
  name: "helper",
  description: "...",
  parameters: { ... },
  run: async (params, context) => {
    // context injected by UAP ExecutionStrategy
    effectiveAgent = helper.model
      ? helper
      : agent({ ...helper, model: context.parentModel, config: context.parentConfig })
    return (await effectiveAgent.query(params.task)).response.text
  },
}
```

**MUST Requirements:**

1. If sub-agent has explicit `model`, MUST use that model
2. If sub-agent has no `model`, MAY inherit from parent execution context
3. Inheritance is resolved at execution time
4. ExecutionStrategy MUST inject context for tools that declare a second parameter

### 8.5 Execution Dependencies

Tools and sub-agents can declare execution dependencies:

**Tool Dependency Options:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `sequential` | Boolean | false | Must complete before other tools start |
| `dependsOn` | List<String> | [] | Tool names that must complete first |

```pseudocode
readTool: Tool = {
  name: "read_file",
  description: "Read a file",
  parameters: { ... },
  sequential: true,  // Other tools wait for this
  run: async (params) => { ... },
}

writeTool: Tool = {
  name: "write_file",
  description: "Write a file",
  parameters: { ... },
  dependsOn: ["read_file"],  // Only runs after read_file completes
  run: async (params) => { ... },
}
```

### 8.6 Model-Driven Execution Order

The model MAY signal execution dependencies in tool calls:

```pseudocode
// Model can return structured tool calls with dependencies
toolCalls = [
  { id: "call_1", name: "read_file", args: {...} },
  { id: "call_2", name: "process", args: {...}, after: ["call_1"] },
  { id: "call_3", name: "write_file", args: {...}, after: ["call_2"] },
]

// Execution respects declared order:
// 1. read_file executes
// 2. process executes (after call_1)
// 3. write_file executes (after call_2)
```

If the model does not specify dependencies, tools execute in parallel (default).

### 8.7 Sub-Agent Event Propagation

When sub-agents execute via streaming, their events SHOULD be propagated to the parent agent's stream. This enables observability into nested agent execution.

**SubagentEvent Structure:**

| Field | Type | Description |
|-------|------|-------------|
| `subagentId` | String | Unique ID of the sub-agent instance |
| `subagentType` | String | Type/name of the sub-agent (e.g., "explorer", "planner") |
| `parentToolCallId` | String | The tool call ID that spawned this sub-agent |

**Event Types:**

Sub-agent events use the following `UAPEventType` values:

| Type | Description |
|------|-------------|
| `subagent_start` | Sub-agent execution began |
| `subagent_event` | Forwarded event from sub-agent (wraps inner event) |
| `subagent_end` | Sub-agent execution completed |

**Event Data Structures:**

```pseudocode
// subagent_start event data
{
  subagentId: String,
  subagentType: String,
  parentToolCallId: String,
  prompt: String,           // The task given to the sub-agent
  timestamp: Integer,       // Start time in milliseconds
}

// subagent_event event data (forwarded events)
{
  subagentId: String,
  subagentType: String,
  parentToolCallId: String,
  innerEvent: AgentStreamEvent,  // The actual event from sub-agent
}

// subagent_end event data
{
  subagentId: String,
  subagentType: String,
  parentToolCallId: String,
  success: Boolean,
  result?: String,          // Sub-agent's response (if successful)
  error?: String,           // Error message (if failed)
  timestamp: Integer,       // End time in milliseconds
  toolExecutions?: List<{   // Tools used by sub-agent
    toolName: String,
    arguments: Map,
    result: String,
    duration?: Integer,     // Execution time in milliseconds
  }>,
  usage?: TokenUsage,       // Token usage for sub-agent execution
}
```

**Implementation Pattern:**

Tools that spawn sub-agents SHOULD accept an event callback and emit events during execution:

```pseudocode
interface SubagentToolOptions {
  onSubagentEvent?: (event: SubagentEvent) -> void
}

explorerTool: Tool = {
  name: "explore",
  description: "...",
  parameters: { ... },
  run: async (params, context) => {
    subagentId = generateId()

    // Emit start event
    context.onSubagentEvent?.({
      type: "subagent_start",
      subagentId,
      subagentType: "explorer",
      parentToolCallId: context.toolCallId,
      prompt: params.query,
      timestamp: Date.now(),
    })

    // Stream sub-agent execution
    stream = explorer.stream(params.query, AgentState.initial())

    for await (event of stream) {
      // Forward inner events
      context.onSubagentEvent?.({
        type: "subagent_event",
        subagentId,
        subagentType: "explorer",
        parentToolCallId: context.toolCallId,
        innerEvent: event,
      })
    }

    result = await stream.result

    // Emit end event
    context.onSubagentEvent?.({
      type: "subagent_end",
      subagentId,
      subagentType: "explorer",
      parentToolCallId: context.toolCallId,
      success: true,
      result: result.turn.response.text,
      timestamp: Date.now(),
      toolExecutions: result.turn.toolExecutions,
    })

    return result.turn.response.text
  },
}
```

**MUST Requirements:**

1. Sub-agent events MUST include `subagentId` to correlate events
2. Sub-agent events MUST include `parentToolCallId` to associate with parent tool call
3. `subagent_start` MUST be emitted before sub-agent execution begins
4. `subagent_end` MUST be emitted after sub-agent execution completes (success or failure)
5. `subagent_event` SHOULD forward all significant inner events (tool executions, text deltas)

**SHOULD Requirements:**

1. Implementations SHOULD provide helper utilities for creating sub-agent tools with event propagation
2. TUI/CLI implementations SHOULD display nested sub-agent events with visual indentation or hierarchy

### 8.8 Sub-Agent Trace Persistence

Sub-agent execution traces MUST be persisted in AgentState for checkpoint recovery. This enables full restoration of hierarchical agent execution including nested tool calls, durations, and token usage.

**SubagentExecutionTrace Structure:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `subagentId` | String | Yes | Unique ID of the sub-agent instance |
| `subagentType` | String | Yes | Type/name of the sub-agent |
| `parentToolCallId` | String | Yes | Tool call ID that spawned this sub-agent |
| `prompt` | String | Yes | The task given to the sub-agent |
| `startTime` | Integer | Yes | Start timestamp (ms since epoch) |
| `endTime` | Integer | Yes | End timestamp (ms since epoch) |
| `success` | Boolean | Yes | Whether execution succeeded |
| `result` | String | No | Sub-agent's response (if successful) |
| `error` | String | No | Error message (if failed) |
| `toolExecutions` | List<ToolExecutionTrace> | No | Tools used by sub-agent |
| `usage` | TokenUsage | No | Token usage for sub-agent |

**ToolExecutionTrace Structure:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `toolName` | String | Yes | Name of the tool |
| `toolCallId` | String | No | Tool call ID |
| `arguments` | Map | Yes | Arguments passed to tool |
| `result` | String | Yes | Tool result |
| `isError` | Boolean | No | Whether tool errored |
| `duration` | Integer | No | Execution time in milliseconds |

**AgentState Integration:**

```pseudocode
interface AgentState {
  // ... existing fields ...
  subagentTraces?: readonly SubagentExecutionTrace[]

  // Add a sub-agent trace to state
  withSubagentTrace(trace: SubagentExecutionTrace) -> AgentState
}
```

**Serialization:**

Sub-agent traces MUST be included in `AgentStateJSON` for checkpoint persistence:

```pseudocode
interface AgentStateJSON {
  // ... existing fields ...
  subagentTraces?: List<SubagentExecutionTraceJSON>
}
```

**MUST Requirements:**

1. Sub-agent traces MUST be collected when `subagent_end` events are emitted
2. Traces MUST include all tool executions from the sub-agent
3. Traces MUST be serialized in checkpoints
4. Traces MUST be restored when loading from checkpoint

---

## 9. Middleware

### 9.1 Middleware Interface

```pseudocode
interface Middleware {
  name: String
  before?(context: MiddlewareContext) -> Promise<MiddlewareContext | void>
  after?(context: MiddlewareContext, result: GenerateResult) -> Promise<GenerateResult>
  onError?(context: MiddlewareContext, error: Error) -> Promise<GenerateResult | void>
}
```

**MiddlewareContext Structure:**

| Field | Type | Description |
|-------|------|-------------|
| `agent` | Agent | The agent |
| `input` | Message | User input |
| `state` | AgentState | Current state |
| `metadata` | Map | Request metadata (mutable within middleware) |

### 9.2 Middleware Composition

Middleware executes in order for `before`, reverse order for `after`:

```pseudocode
agent({
  middleware: [first(), second(), third()],
})

// Execution order:
// 1. first.before()
// 2. second.before()
// 3. third.before()
// 4. Agent execution
// 5. third.after()
// 6. second.after()
// 7. first.after()
```

### 9.3 logging() Middleware (v1)

```pseudocode
logging(options?: LoggingOptions) -> Middleware
```

**LoggingOptions Structure:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `level` | String | "info" | Log level: "debug", "info", "warn", "error" |
| `logger` | Function | console.log | Custom logger function |
| `includeMessages` | Boolean | false | Log full message content |
| `includeTiming` | Boolean | true | Log execution timing |

### 9.4 Custom Middleware

```pseudocode
timing: Middleware = {
  name: "timing",

  before: async (context) => {
    context.metadata.startTime = Date.now()
    return context
  },

  after: async (context, result) => {
    duration = Date.now() - context.metadata.startTime
    print(`Execution took ${duration}ms`)
    return result
  },
}
```

---

## 10. Agent Strategy Hooks

### 10.1 AgentStrategy Structure

| Field | Type | Description |
|-------|------|-------------|
| `stopCondition` | Function | Evaluate if execution should stop |
| `onStepStart` | Function | Called when step begins |
| `onReason` | Function | Called during reasoning phase (ReAct) |
| `onAct` | Function | Called during action phase |
| `onObserve` | Function | Called during observation phase |
| `onStepEnd` | Function | Called when step completes |
| `onComplete` | Function | Called when execution completes |
| `onError` | Function | Called on execution error |

### 10.2 Hook Signatures

```pseudocode
interface AgentStrategy {
  stopCondition?: (state: AgentState) -> Boolean | Promise<Boolean>
  onStepStart?: (step: Integer, state: AgentState) -> void
  onReason?: (step: Integer, reasoning: String) -> void
  onAct?: (step: Integer, actions: List<ToolCall>) -> void
  onObserve?: (step: Integer, observations: List<ToolResult>) -> void
  onStepEnd?: (step: Integer, result: { turn: Turn, state: AgentState }) -> void
  onComplete?: (result: GenerateResult) -> void
  onError?: (error: Error, state: AgentState) -> void | GenerateResult
}
```

### 10.3 Stop Conditions

Since UAP defaults to infinite execution, `stopCondition` is the primary way to control termination:

```pseudocode
agent({
  model: anthropic("claude-sonnet-4-20250514"),
  execution: react(),  // Infinite by default
  strategy: {
    stopCondition: (state) => {
      // Stop on explicit completion signal
      if (state.metadata.taskComplete) return true

      // Stop on budget
      if (state.metadata.totalTokens > 50000) return true

      // Stop on time
      if (Date.now() - state.metadata.startTime > 300000) return true

      return false
    },
  },
})
```

### 10.4 ToolUseStrategy (UPP Passthrough)

UAP passes `toolStrategy` directly to the underlying `llm()` instance for UPP-level tool execution hooks. These hooks fire in real-time during tool execution, complementing the UAP-level `AgentStrategy` hooks.

**ToolUseStrategy Structure (from UPP-1.2):**

| Field | Type | Description |
|-------|------|-------------|
| `maxIterations` | Integer | Maximum tool execution rounds (default: Infinity) |
| `onToolCall` | Function | Called before each tool execution |
| `onBeforeCall` | Function | Called before execution, can cancel |
| `onAfterCall` | Function | Called after successful tool execution |
| `onError` | Function | Called on tool execution error |
| `onMaxIterations` | Function | Called when max iterations reached |

**Hook Signatures:**

```pseudocode
interface ToolUseStrategy {
  maxIterations?: Integer  // Default: Infinity
  onToolCall?: (tool: Tool, params: Map) -> void
  onBeforeCall?: (tool: Tool, params: Map) -> Boolean  // Return false to skip
  onAfterCall?: (tool: Tool, params: Map, result: Any) -> void
  onError?: (tool: Tool, params: Map, error: Error) -> void
  onMaxIterations?: (iterations: Integer) -> void
}
```

**Usage with UAP:**

```pseudocode
agent({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: [Bash, Read, Write],
  // UAP-level hooks (step lifecycle)
  strategy: {
    onStepStart: (step, state) => print(`Step ${step}`),
    onComplete: (result) => print("Done"),
  },
  // UPP-level hooks (real-time tool execution)
  toolStrategy: {
    maxIterations: Infinity,  // UAP standard
    onToolCall: (tool, params) => print(`Calling ${tool.name}`),
    onAfterCall: (tool, params, result) => print(`${tool.name} completed`),
  },
})
```

**Key Difference from AgentStrategy:**

- `AgentStrategy` hooks fire at step boundaries (after LLM inference completes)
- `ToolUseStrategy` hooks fire immediately during tool execution (real-time)

This distinction matters for logging and monitoring—`toolStrategy` provides visibility into tool calls as they happen, while `strategy` provides visibility into the agent's reasoning cycle.

---

## 11. Streaming

### 11.1 AgentStreamResult Interface

```pseudocode
interface AgentStreamResult {
  [Symbol.asyncIterator](): AsyncIterator<AgentStreamEvent>
  result: Promise<GenerateResult>  // Resolves after completion
  abort(): void
}
```

### 11.2 AgentStreamEvent Structure

UAP streaming provides both UAP-level events and UPP-level events:

```pseudocode
interface AgentStreamEvent {
  source: "uap" | "upp"

  // Present when source === "uap"
  uap?: {
    type: UAPEventType
    step: Integer
    agentId: String
    data: Map
  }

  // Present when source === "upp"
  upp?: StreamEvent  // Original UPP StreamEvent
}
```

**UAPEventType Values:**

| Type | Description |
|------|-------------|
| `step_start` | Step beginning |
| `step_end` | Step completed |
| `reasoning` | Reasoning output (ReAct) |
| `action` | Action taken |
| `observation` | Observation received |
| `subagent_start` | Sub-agent execution began |
| `subagent_event` | Forwarded event from sub-agent |
| `subagent_end` | Sub-agent execution completed |

### 11.3 Streaming Usage

```pseudocode
stream = agent.stream("Implement a feature", state)

for await (event of stream) {
  if (event.source === "uap") {
    // UAP step-level events
    if (event.uap.type === "step_start") {
      print(`Step ${event.uap.step}`)
    }
  } else {
    // UPP LLM events
    if (event.upp.type === "text_delta") {
      process.stdout.write(event.upp.delta.text ?? "")
    }
  }
}

{ turn, state: newState } = await stream.result
```

### 11.4 Streaming State Completeness

**Implementation Note:** The `state` returned by `stream.result` MUST include the complete execution history:

- All messages from all steps (reasoning, actions, observations)
- All tool call results
- Updated step counter
- All reasoning traces (for ReAct)
- Updated plan status (for Plan strategy)

The returned state MUST be identical to what `generate()` would return for the same execution. Streaming is an observation mechanism, not a different execution path.

```pseudocode
// These must produce equivalent final states:
{ turn: t1, state: s1 } = await agent.generate(input, state)

stream = agent.stream(input, state)
for await (event of stream) { /* consume */ }
{ turn: t2, state: s2 } = await stream.result

// s1 and s2 are structurally equivalent (different IDs, same content)
assert(s1.messages.length === s2.messages.length)
assert(s1.step === s2.step)
```

---

## 12. Serialization

### 12.1 AgentState Serialization

**AgentStateJSON Structure:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | String | Yes | UAP version |
| `id` | String | Yes | State ID |
| `messages` | List<MessageJSON> | Yes | UPP Message serialization |
| `step` | Integer | Yes | Step number |
| `metadata` | Map | Yes | User metadata |
| `reasoning` | List<String> | No | Reasoning traces |
| `plan` | List<PlanStepJSON> | No | Execution plan |
| `subagentTraces` | List<SubagentExecutionTraceJSON> | No | Sub-agent execution traces (see Section 8.8) |

### 12.2 Thread Tree Serialization

**ThreadTreeJSON Structure:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `rootId` | String | Yes | Root node ID |
| `currentId` | String | Yes | Current node ID |
| `nodes` | List<ThreadNodeJSON> | Yes | All nodes |

### 12.3 MUST Requirements

1. All IDs MUST be preserved exactly during round-trip
2. Message metadata MUST be preserved
3. Timestamps MUST use ISO 8601 format
4. Binary data MUST be base64 encoded
5. Version MUST be checked during deserialization

### 12.4 Checkpointing

Checkpointing enables step-level persistence for crash recovery and session resume. The SDK provides a pluggable `CheckpointStore` interface with a reference file-based implementation.

#### 12.4.1 CheckpointStore Interface

```pseudocode
interface CheckpointStore {
  /** Save a checkpoint at the current state */
  save(sessionId: String, state: AgentStateJSON): Promise<void>

  /** Load the most recent checkpoint for a session */
  load(sessionId: String): Promise<AgentStateJSON | null>

  /** Load metadata for a session without loading full state */
  loadMetadata(sessionId: String): Promise<CheckpointMetadata | null>

  /** Delete all checkpoints for a session */
  delete(sessionId: String): Promise<void>

  /** List all session IDs with checkpoints */
  list(): Promise<List<String>>
}
```

#### 12.4.2 Checkpoint Metadata

Each checkpoint MAY include additional metadata:

| Field | Type | Description |
|-------|------|-------------|
| `sessionId` | String | Session identifier (UUIDv4 or user-provided) |
| `checkpointId` | String | Unique checkpoint ID |
| `timestamp` | String | ISO 8601 timestamp |
| `step` | Integer | Step number at checkpoint |
| `agentId` | String | Agent instance ID |

#### 12.4.3 fileCheckpoints() Reference Implementation

```pseudocode
fileCheckpoints(options?: FileCheckpointOptions) -> CheckpointStore
```

**FileCheckpointOptions Structure:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `dir` | String | ".checkpoints" | Directory for checkpoint files |

**File Structure:**

```
{dir}/
  {sessionId}/
    checkpoint.json     # Latest state
    metadata.json       # Session metadata
```

**Usage:**

```pseudocode
import { agent, AgentState } from "agents"
import { fileCheckpoints } from "agents/checkpoint"

// Create checkpoint store
store = fileCheckpoints({ dir: "./checkpoints" })

// Create agent with checkpointing
coder = agent({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: [Bash, Read, Write],
  checkpoints: store,         // Enable checkpointing
  sessionId: "my-session",    // Optional: auto-generated if not provided
})

// Checkpoints are saved automatically at each step_end
{ turn, state } = await coder.generate("Fix the bug", AgentState.initial())
```

#### 12.4.4 Resume from Checkpoint

```pseudocode
// Resume from existing session
store = fileCheckpoints({ dir: "./checkpoints" })
saved = await store.load("my-session")

if (saved) {
  restored = AgentState.fromJSON(saved)
  { turn, state } = await coder.generate("Continue", restored)
} else {
  { turn, state } = await coder.generate("Start fresh", AgentState.initial())
}
```

#### 12.4.5 Checkpoint Strategy Integration

When `checkpoints` is provided to `agent()`, execution strategies MUST:

1. Call `store.save(sessionId, state.toJSON())` after each `step_end` event
2. Generate `sessionId` if not provided (UUIDv4)
3. Include `sessionId` in returned state metadata

```pseudocode
// Automatic checkpointing in loop strategy
while (!done) {
  // ... execute step ...

  strategy.onStepEnd?.(step, { turn, state: currentState })

  // Auto-checkpoint after step completes
  if (checkpointStore) {
    await checkpointStore.save(sessionId, currentState.toJSON())
  }
}
```

#### 12.4.6 Custom CheckpointStore Implementations

Developers MAY implement custom stores for different backends:

```pseudocode
// Redis checkpoint store
redisCheckpoints = (client: RedisClient): CheckpointStore => ({
  save: async (sessionId, state) => {
    await client.set(`checkpoint:${sessionId}`, JSON.stringify(state))
  },
  load: async (sessionId) => {
    data = await client.get(`checkpoint:${sessionId}`)
    return data ? JSON.parse(data) : null
  },
  delete: async (sessionId) => {
    await client.del(`checkpoint:${sessionId}`)
  },
  list: async () => {
    keys = await client.keys("checkpoint:*")
    return keys.map(k => k.replace("checkpoint:", ""))
  },
})

// Usage
agent({
  model: anthropic("claude-sonnet-4-20250514"),
  checkpoints: redisCheckpoints(redisClient),
  sessionId: "user-123-task-456",
})
```

#### 12.4.7 MUST Requirements for Checkpointing

1. Checkpoints MUST be saved after each `step_end` event when a store is configured
2. Checkpoint saves MUST NOT block execution (fire-and-forget with error logging)
3. `sessionId` MUST be preserved across checkpoint/restore cycles
4. Restored state MUST be indistinguishable from live state for execution purposes
5. Failed checkpoint saves SHOULD log errors but MUST NOT throw

#### 12.4.8 SHOULD Requirements for Checkpointing

1. Implementations SHOULD provide a file-based reference implementation
2. Checkpoint stores SHOULD handle concurrent access safely
3. Implementations SHOULD support checkpoint compression for large states

---

## 13. Data Type Definitions

### 13.1 Types from UPP-1.2 (Used Directly)

- `llm`, `LLMInstance`, `LLMOptions`, `ProviderConfig`, `ModelReference`
- `Message`, `UserMessage`, `AssistantMessage`, `ToolResultMessage`
- `Turn`, `TokenUsage`
- `Tool`, `ToolCall`, `ToolResult`, `ToolExecution`
- `StreamResult`, `StreamEvent`, `StreamEventType`
- `UPPError`, `ErrorCode`
- `Thread`, `ThreadJSON`

### 13.2 UAP-Specific Types

**Agent Types:**

```pseudocode
// AgentOptions extends LLMOptions for full UPP passthrough
interface AgentOptions extends Partial<LLMOptions> {
  // Required
  model: ModelReference

  // UAP-specific options
  execution?: ExecutionStrategy      // Default: loop()
  middleware?: List<Middleware>      // Ordered middleware pipeline
  strategy?: AgentStrategy           // Agent lifecycle hooks

  // Inherited from LLMOptions (passthrough to llm())
  // params?: Map                    // Model-specific parameters
  // config?: ProviderConfig         // Provider infrastructure
  // tools?: List<Tool>              // Available tools
  // system?: String                 // System prompt
  // structure?: JSONSchema          // Structured output schema
  // toolStrategy?: ToolUseStrategy  // Tool execution hooks
}

interface Agent {
  id: String
  model: ModelReference
  tools: List<Tool>
  system?: String
  generate(input, state): Promise<GenerateResult>
  stream(input, state): AgentStreamResult
  ask(input, state): Promise<GenerateResult>
  query(input): Promise<Turn>
}

interface GenerateResult {
  turn: Turn
  state: AgentState
}
```

**State Types:**

```pseudocode
interface AgentState {
  id: String
  messages: List<Message>
  step: Integer
  metadata: Map
  reasoning: List<String>
  plan?: List<PlanStep>

  static initial(): AgentState
  withMessage(message): AgentState
  withMessages(messages): AgentState
  withContext(messages): AgentState
  withStep(step): AgentState
  withMetadata(key, value): AgentState
  withReasoning(reasoning): AgentState
  withPlan(plan): AgentState
  toJSON(): AgentStateJSON
  static fromJSON(json): AgentState
}
```

**Execution Types:**

```pseudocode
interface ExecutionStrategy {
  name: String
  execute(context): Promise<ExecutionResult>
  stream(context): AgentStreamResult
}

interface LoopOptions {
  maxIterations?: Integer  // Default: Infinity
}

interface ReactOptions {
  maxSteps?: Integer  // Default: Infinity
  reasoningPrompt?: String
}

interface PlanOptions {
  maxPlanSteps?: Integer  // Default: Infinity
  allowReplan?: Boolean
  planSchema?: JSONSchema
}
```

**Tool Dependency Types:**

```pseudocode
interface ToolDependencyOptions {
  sequential?: Boolean      // Must complete before others
  dependsOn?: List<String>  // Tool names to wait for
}

// Extends UPP Tool
interface Tool {
  name: String
  description: String
  parameters: JSONSchema
  run: Function
  sequential?: Boolean
  dependsOn?: List<String>
}
```

**Checkpoint Types:**

```pseudocode
interface CheckpointStore {
  save(sessionId: String, state: AgentStateJSON): Promise<void>
  load(sessionId: String): Promise<AgentStateJSON | null>
  loadMetadata(sessionId: String): Promise<CheckpointMetadata | null>
  delete(sessionId: String): Promise<void>
  list(): Promise<List<String>>
}

interface FileCheckpointOptions {
  dir?: String  // Default: ".checkpoints"
}

interface CheckpointMetadata {
  sessionId: String
  checkpointId: String
  timestamp: String        // ISO 8601
  step: Integer
  agentId: String
}
```

### 13.3 Export List

**Entry Points:**
- `agent`
- `AgentState`

**Execution Strategies (from agents/execution):**
- `loop`
- `react`
- `plan`

**Middleware (from agents/middleware):**
- `logging`

**Checkpointing (from agents/checkpoint):**
- `fileCheckpoints`
- `CheckpointStore` (type)

**Classes:**
- `ThreadTree`
- `ThreadNode`

---

## 14. Conformance

### 14.1 Conformance Levels

**Level 1: Core Agent (Required)**
- `agent()` function
- `generate()`, `stream()`, `ask()`, `query()` methods
- `AgentState` immutable state
- `loop()` execution strategy
- Returns standard UPP Turn

**Level 2: Advanced Execution (Required)**
- `react()` strategy
- `plan()` strategy
- Custom strategy support
- Infinite defaults

**Level 3: Thread Trees (Optional)**
- `ThreadTree` implementation
- Branching and checkout
- History traversal

**Level 4: Middleware (Required)**
- Middleware pipeline
- `logging()` middleware
- Custom middleware support

### 14.2 MUST Requirements Summary

1. **Type Uniformity:** MUST use UPP-1.2 types directly without wrapping
2. **No Re-exports:** MUST NOT re-export UPP types
3. **Functional State:** `AgentState` MUST be immutable
4. **Infinite Defaults:** `maxIterations`/`maxSteps`/`toolStrategy.maxIterations` MUST default to Infinity
5. **Explicit Sub-Agents:** MUST NOT auto-generate tool schemas from agents
6. **Identity:** All IDs MUST be UUIDv4
7. **Serialization:** State MUST be fully serializable
8. **LLM Passthrough:** `AgentOptions` MUST extend `LLMOptions` for full UPP passthrough

### 14.3 MUST NOT Requirements

1. MUST NOT impose artificial execution limits by default
2. MUST NOT mutate state internally
3. MUST NOT auto-generate sub-agent tool schemas
4. MUST NOT hide conversation history in implicit state

---

## 15. Security Considerations

### 15.1 Developer Responsibility

UAP explicitly places security responsibility with the developer:

- **Runaway Agents:** Developer must implement `stopCondition` or explicit limits
- **Resource Exhaustion:** Developer must implement budget middleware or limits
- **Cost Control:** Developer must track token usage via state metadata

The protocol provides the pipe; the developer provides the valves.

### 15.2 Sub-Agent Security

- Sub-agent tools execute with whatever permissions their `run` function has
- Nested sub-agent calls can amplify access—developer must audit tool chains
- Stop conditions in parent do not automatically propagate to sub-agents

### 15.3 Serialization Security

- Serialized state may contain sensitive conversation data
- State SHOULD be encrypted at rest in production
- Deserialization MUST validate structure
- Untrusted serialized data SHOULD NOT be deserialized

### 15.4 Tool Execution Security

All UPP-1.2 tool security considerations apply. Additionally:

- Tools with `sequential: true` or `dependsOn` create execution ordering that may have security implications
- Model-driven execution order gives the model control over execution flow

---

## Appendix A: Migration from Previous Draft

### A.1 Breaking Changes

| Previous | Current | Rationale |
|----------|---------|-----------|
| `run()` | `generate()` | Consistency with UPP `llm.generate()` |
| `ask(agent, input)` | `agent.ask(input, state)` | Method on agent, explicit state |
| `query(agent, input)` | `agent.query(input)` | Method on agent |
| `session()` | Removed | Replaced by functional `AgentState` |
| `maxIterations: 10` | `maxIterations: Infinity` | Pipe not nanny |
| `agent.toTool()` | Explicit Tool | No magic schema generation |

### A.2 State Migration

```pseudocode
// Previous (implicit state)
session = session(agent)
turn1 = await session.run("Hello")
turn2 = await session.run("Continue")

// Current (explicit state)
s0 = AgentState.initial()
{ turn: t1, state: s1 } = await agent.generate("Hello", s0)
{ turn: t2, state: s2 } = await agent.generate("Continue", s1)
```

---

## Appendix B: Complete Example

```pseudocode
import { agent, AgentState } from "agents"
import { react } from "agents/execution"
import { logging } from "agents/middleware"
import { Tool } from "upp"
import anthropic from "upp/anthropic"

// Define a sub-agent
explorer = agent({
  model: anthropic("claude-haiku-4-20250514"),
  tools: [Glob, Grep, Read],
  system: "You explore codebases and report findings.",
})

// Explicitly define sub-agent as tool
explorerTool: Tool = {
  name: "explore",
  description: "Explore codebase to find relevant files and code",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "What to find" },
    },
    required: ["query"],
  },
  run: async (params) => {
    turn = await explorer.query(params.query)
    return turn.response.text
  },
}

// Main agent with explicit limits (developer's choice)
coder = agent({
  model: anthropic("claude-sonnet-4-20250514"),
  execution: react(),  // Infinite by default
  tools: [Bash, Read, Write, explorerTool],
  system: "You are an expert software engineer.",
  middleware: [logging({ level: "info" })],
  // UAP-level hooks (step lifecycle)
  strategy: {
    // Developer implements their own limits
    stopCondition: (state) => {
      if (state.metadata.taskComplete) return true
      if (state.step > 50) return true  // Explicit step limit
      return false
    },
    onStepStart: (step, state) => print(`Step ${step}`),
    onComplete: (result) => print(`Done: ${result.turn.usage.totalTokens} tokens`),
  },
  // UPP-level hooks (real-time tool execution)
  toolStrategy: {
    maxIterations: Infinity,  // UAP standard - no artificial limits
    onToolCall: (tool, params) => print(`🔧 ${tool.name}`),
    onAfterCall: (tool, params, result) => print(`✓ ${tool.name} completed`),
  },
})

// Functional execution
s0 = AgentState.initial()
s0 = s0.withMetadata("startTime", Date.now())

{ turn, state } = await coder.generate(
  "Find and fix all TypeScript errors",
  s0
)

// Save state for later
json = state.toJSON()
await storage.save("my-task", JSON.stringify(json))

// Restore and continue
saved = JSON.parse(await storage.load("my-task"))
restored = AgentState.fromJSON(saved)
{ turn: t2, state: s2 } = await coder.generate("Now add tests", restored)
```

---

*End of UAP-1.0 Specification*
