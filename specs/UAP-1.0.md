# UAP-1.0: Unified Agent Protocol Specification

**Version:** 1.0.0-draft
**Status:** Draft
**Built on:** UPP-1.2 (Unified Provider Protocol)
**Authors:** UAP Working Group

---

## Abstract

The Unified Agent Protocol (UAP) is a specification for building AI agents on top of the Unified Provider Protocol (UPP-1.2). This document defines the protocol semantics, data structures, and implementation requirements for building UAP-compliant agents, sessions, and execution strategies.

UAP extends UPP-1.2 with agent-level abstractions including decoupled execution strategies (ReAct, Plan, Loop), tree-structured thread management, session persistence with full recovery, sub-agent composition, and middleware pipelines. UAP preserves complete type uniformity with UPP-1.2, using all types from `@providerprotocol/ai` directly without abstraction or re-export.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Design Principles](#2-design-principles)
3. [Core Concepts](#3-core-concepts)
4. [Agent Interface](#4-agent-interface)
5. [Execution Strategies](#5-execution-strategies)
6. [Sessions](#6-sessions)
7. [Thread Trees](#7-thread-trees)
8. [Sub-Agent Protocol](#8-sub-agent-protocol)
9. [Communication](#9-communication)
10. [Middleware](#10-middleware)
11. [Agent Strategy Hooks](#11-agent-strategy-hooks)
12. [Streaming](#12-streaming)
13. [Serialization](#13-serialization)
14. [Data Type Definitions](#14-data-type-definitions)
15. [Conformance](#15-conformance)
16. [Security Considerations](#16-security-considerations)

---

## 1. Introduction

### 1.1 Purpose

AI agents require orchestration beyond simple LLM inference. UAP-1.0 establishes a standard protocol that:

- Provides agent abstractions built on UPP-1.2 primitives
- Decouples execution strategies from agent definitions
- Enables full session serialization and recovery
- Supports hierarchical agent composition (sub-agents)
- Provides middleware for cross-cutting concerns
- Maintains complete type uniformity with the underlying LLM library

### 1.2 Scope

This specification covers:

- The `agent()` function interface for defining agents
- Execution strategies (`react()`, `plan()`, `loop()`)
- Session management with checkpoints
- Thread tree structures for branching conversations
- Sub-agent communication patterns (`ask()`, `query()`)
- Middleware composition
- Agent strategy hooks
- Serialization format for persistence

### 1.3 Relationship to UPP-1.2

UAP-1.0 builds on UPP-1.2 and MUST use the following types directly from `@providerprotocol/ai`:

- `llm`, `LLMInstance`, `LLMOptions`
- `Thread`, `Turn`, `TokenUsage`
- `Message`, `UserMessage`, `AssistantMessage`, `ToolResultMessage`
- `Tool`, `ToolCall`, `ToolResult`, `ToolExecution`, `ToolUseStrategy`
- `StreamResult`, `StreamEvent`, `StreamEventType`
- `UPPError`, `ErrorCode`
- All provider factories (`anthropic`, `openai`, `google`, etc.)

UAP MUST NOT re-export, wrap, or abstract these types. Applications import directly from `@providerprotocol/ai` for these types.

### 1.4 Terminology

| Term | Definition |
|------|------------|
| **Agent** | An AI entity with a model, execution strategy, tools, and optional sub-agents |
| **Session** | A stateful wrapper around an agent containing thread tree, checkpoints, and metadata |
| **Thread Tree** | A tree-structured collection of threads with parent-child relationships |
| **Step** | A single cycle of an execution strategy (reason-act-observe in ReAct) |
| **Checkpoint** | A serialized snapshot of session state at a specific point |
| **Sub-Agent** | An agent invoked as a tool by a parent agent |
| **Middleware** | A composable function that wraps agent execution |
| **Turn** | A UPP Turn representing the complete result of one LLM inference call |

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
import { agent, session, ask, query } from "agents"
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

turn = await agent.run("Hello")
thread.append(turn)  // Standard UPP Turn

// INCORRECT: Creating wrapper types
import { AgentTurn } from "agents"  // DO NOT DO THIS
```

**Rationale:** Wrapping library types creates maintenance burden, obscures debugging, and prevents access to provider-specific metadata. UAP agents operate on the same data structures as raw LLM calls.

### 2.2 Decoupled Execution

Execution strategies are separate from agent definitions:

- Agents define WHAT (model, tools, system prompt)
- Strategies define HOW (ReAct loop, plan-then-execute, simple loop)
- Strategies are interchangeable without changing agent definition

```pseudocode
// Same agent, different execution strategies
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

### 2.3 First-Class Serialization

Session state MUST be fully serializable:

- Complete recovery from serialized state
- Per-step automatic checkpoints
- Sub-agent state included in parent serialization
- Thread tree structure preserved

```pseudocode
// Save session state
json = session.toJSON()
await storage.save(`session:${session.id}`, json)

// Restore later, even after process restart
saved = await storage.load(`session:${session.id}`)
restored = Session.fromJSON(saved, agent)
turn = await restored.run("Continue from where we left off")
```

**Rationale:** Long-running agent tasks need persistence. Checkpoints enable recovery from failures and support pause/resume workflows.

### 2.4 Explicit Control Flow

Like UPP-1.2, UAP favors explicit over magic:

- Clear step boundaries in execution
- Explicit sub-agent invocation patterns
- Observable middleware pipeline
- No hidden state mutations

### 2.5 Progressive Complexity

Simple agents require minimal code. Advanced features are opt-in:

```pseudocode
// Minimal agent - just model binding
simple = agent({
  model: anthropic("claude-haiku-4-20250514"),
})

// Full configuration with all features
advanced = agent({
  model: anthropic("claude-sonnet-4-20250514"),
  params: { max_tokens: 4096 },
  config: { apiKey: env.ANTHROPIC_API_KEY },
  execution: react({ maxSteps: 20 }),
  tools: [Bash, Read, Write],
  system: "You are a coding assistant.",
  middleware: [logging()],
  strategy: {
    stopCondition: (state) => state.metadata.taskComplete,
    onStepEnd: (step, result) => console.log(`Step ${step} complete`),
  },
})
```

### 2.6 Parallel Execution

Tool and sub-agent calls execute in parallel by default when multiple are requested simultaneously. This maximizes throughput for independent operations.

Tools MUST be thread-safe to support concurrent execution. Implementations MAY provide configuration to enforce sequential execution when needed.

---

## 3. Core Concepts

### 3.1 The Agent Architecture

```
+-----------------------------------------------------------------------+
|                        Application Code                                |
+-----------------------------------------------------------------------+
            |                    |                    |
            v                    v                    v
     +-------------+      +-------------+      +-------------+
     |   agent()   |      |  session()  |      | ask/query   |
     |             |      |             |      |             |
     +-------------+      +-------------+      +-------------+
            |                    |                    |
            v                    v                    v
+-----------------------------------------------------------------------+
|                       Middleware Pipeline                              |
|    +----------+  +------------+  +---------+  +---------+             |
|    | logging  |->| guardrails |->| memory  |->| budget  |             |
|    +----------+  +------------+  +---------+  +---------+             |
+-----------------------------------------------------------------------+
            |                    |
            v                    v
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
// Main entry point - core agent functions
import { agent, session, ask, query } from "agents"

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

1. Application calls `agent.run()` or `session.run()`
2. Middleware pipeline processes the request (pre-hooks)
3. Execution strategy determines step sequence
4. Each step invokes `llm.generate()` or `llm.stream()` from UPP-1.2
5. Tool calls trigger tool execution (including sub-agents)
6. Execution strategy evaluates stop conditions
7. Middleware pipeline processes the result (post-hooks)
8. Session creates checkpoint (if enabled)
9. Application receives standard UPP `Turn` result

### 3.4 Identity Model

All agent actions MUST have UUIDv4 identifiers for serialization and tracking:

| Entity | ID Field | Description |
|--------|----------|-------------|
| Agent | `agent.id` | Unique agent instance ID |
| Session | `session.id` | Unique session ID |
| Step | `step.id` | Unique step ID within execution |
| Thread | `thread.id` | Thread ID (from UPP Thread) |
| Checkpoint | `checkpoint.id` | Checkpoint ID |

**Turn Identity Extension:**

UAP extends turn tracking with parent-child relationships. This is tracked via metadata, not by modifying the Turn type:

```pseudocode
// Parent agent produces turn
parentTurn = await coder.run("Explore and implement")
// parentTurn returned as-is from UPP

// Track parent-child via execution context, not turn modification
// Sub-agent execution receives parentTurnId in context
subAgentContext = {
  parentTurnId: getContextTurnId(),
  agentId: subAgent.id,
}
```

---

## 4. Agent Interface

### 4.1 Function Signature

```pseudocode
agent(options: AgentOptions) -> Agent
```

### 4.2 AgentOptions Structure

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `model` | ModelReference | Yes | A model reference from a UPP provider factory |
| `params` | Map | No | Model-specific parameters (passed to llm()) |
| `config` | ProviderConfig | No | Provider infrastructure configuration |
| `execution` | ExecutionStrategy | No | Execution strategy (default: loop()) |
| `tools` | List<Tool \| Agent> | No | Tools and sub-agents available to the agent |
| `system` | String | No | System prompt |
| `structure` | JSONSchema | No | Structured output schema |
| `middleware` | List<Middleware> | No | Ordered middleware pipeline |
| `strategy` | AgentStrategy | No | Agent lifecycle hooks |

### 4.3 Agent Interface

| Property/Method | Type | Description |
|-----------------|------|-------------|
| `id` | String | Unique agent identifier (UUIDv4) |
| `model` | ModelReference | The bound model |
| `tools` | List<Tool \| Agent> | Available tools and sub-agents |
| `system` | String? | System prompt |
| `run(input)` | Function | Execute agent and return Turn |
| `stream(input)` | Function | Execute agent with streaming |
| `toTool()` | Function | Convert agent to Tool for use as sub-agent |

**run() Overloads:**

```pseudocode
// Without history
run(input: String | Message) -> Promise<Turn>

// With history
run(history: List<Message> | Thread, input: String | Message) -> Promise<Turn>
```

**stream() Overloads:**

```pseudocode
// Without history
stream(input: String | Message) -> AgentStreamResult

// With history
stream(history: List<Message> | Thread, input: String | Message) -> AgentStreamResult
```

### 4.4 Basic Usage

```pseudocode
import { agent } from "agents"
import anthropic from "upp/anthropic"

coder = agent({
  model: anthropic("claude-sonnet-4-20250514"),
  params: { max_tokens: 4096 },
  system: "You are a coding assistant.",
  tools: [Bash, Read, Write],
})

// Simple execution - returns standard UPP Turn
turn = await coder.run("Implement a fibonacci function in TypeScript")
print(turn.response.text)

// With history
history = []
turn1 = await coder.run(history, "My name is Alice")
history.push(...turn1.messages)
turn2 = await coder.run(history, "What is my name?")
```

### 4.5 Agent with Execution Strategy

```pseudocode
import { agent } from "agents"
import { react } from "agents/execution"
import anthropic from "upp/anthropic"

coder = agent({
  model: anthropic("claude-sonnet-4-20250514"),
  execution: react({ maxSteps: 20 }),
  tools: [Bash, Read, Write, Glob, Grep],
  system: "You are a coding assistant. Think step by step.",
})

turn = await coder.run("Find and fix all TypeScript errors in the project")
```

### 4.6 Agent with Structured Output

```pseudocode
import { agent } from "agents"
import anthropic from "upp/anthropic"

analyzer = agent({
  model: anthropic("claude-sonnet-4-20250514"),
  system: "You analyze code and report issues.",
  structure: {
    type: "object",
    properties: {
      issues: {
        type: "array",
        items: {
          type: "object",
          properties: {
            file: { type: "string" },
            line: { type: "number" },
            severity: { type: "string", enum: ["error", "warning", "info"] },
            message: { type: "string" },
          },
          required: ["file", "line", "severity", "message"],
        },
      },
      summary: { type: "string" },
    },
    required: ["issues", "summary"],
  },
})

turn = await analyzer.run("Analyze this code: ...")
print(turn.data)  // Structured data from UPP Turn
// { issues: [...], summary: "..." }
```

---

## 5. Execution Strategies

### 5.1 ExecutionStrategy Interface

```pseudocode
interface ExecutionStrategy {
  name: String                                              // Strategy identifier
  execute(context: ExecutionContext) -> Promise<Turn>       // Execute and return Turn
  stream(context: ExecutionContext) -> AgentStreamResult    // Streaming execution
}
```

**ExecutionContext Structure:**

| Field | Type | Description |
|-------|------|-------------|
| `agent` | Agent | The agent being executed |
| `llm` | LLMInstance | The bound LLM instance |
| `input` | Message | The user input message |
| `history` | List<Message> | Conversation history |
| `tools` | List<Tool> | Resolved tools (including sub-agent tools) |
| `strategy` | AgentStrategy | Agent lifecycle hooks |
| `signal` | AbortSignal? | Abort signal for cancellation |
| `state` | ExecutionState | Mutable execution state |

**ExecutionState Structure:**

| Field | Type | Description |
|-------|------|-------------|
| `step` | Integer | Current step number |
| `messages` | List<Message> | Messages accumulated in this execution |
| `metadata` | Map | User-defined metadata (for stop conditions) |
| `reasoning` | List<String>? | Reasoning traces (for ReAct) |
| `plan` | List<PlanStep>? | Execution plan (for Plan strategy) |

### 5.2 loop() Strategy

The simplest strategy - equivalent to UPP's tool loop behavior.

```pseudocode
loop(options?: LoopOptions) -> ExecutionStrategy
```

**LoopOptions Structure:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxIterations` | Integer | 10 | Maximum tool execution rounds |

**Behavior:**

1. Send input to LLM
2. If response has tool calls, execute tools and loop
3. Continue until no tool calls or max iterations
4. Return final response as UPP Turn

This strategy MUST behave identically to UPP's `llm.generate()` with `toolStrategy.maxIterations`.

```pseudocode
import { agent } from "agents"
import { loop } from "agents/execution"
import anthropic from "upp/anthropic"

simple = agent({
  model: anthropic("claude-haiku-4-20250514"),
  execution: loop({ maxIterations: 5 }),
  tools: [calculator],
})

turn = await simple.run("What is 2 + 2?")
```

### 5.3 react() Strategy

ReAct (Reason-Act-Observe) loop with explicit reasoning phases.

```pseudocode
react(options?: ReactOptions) -> ExecutionStrategy
```

**ReactOptions Structure:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxSteps` | Integer | 10 | Maximum reason-act-observe cycles |
| `reasoningPrompt` | String | (default) | Prompt suffix for reasoning phase |
| `observationFormat` | String | "markdown" | Format for observations |

**Behavior:**

1. **Reason**: LLM outputs reasoning about what to do next
2. **Act**: LLM selects and executes tool(s)
3. **Observe**: Tool results are formatted as observations
4. Repeat until stop condition or max steps

**Step Lifecycle:**

```pseudocode
for step in 1..maxSteps {
  state.step = step
  strategy.onStepStart?.(step, state)

  // Reason phase
  reasoningTurn = await llm.generate(
    buildHistory(state),
    "Think about what to do next. What is your reasoning?"
  )
  reasoning = reasoningTurn.response.text
  state.reasoning.push(reasoning)
  strategy.onReason?.(step, reasoning)

  // Act phase
  actionTurn = await llm.generate(
    buildHistory(state),
    "Based on your reasoning, take action using available tools."
  )

  if (actionTurn.response.hasToolCalls) {
    strategy.onAct?.(step, actionTurn.response.toolCalls)

    // Tools executed by UPP core, results in turn
    observations = formatObservations(actionTurn.toolExecutions)
    strategy.onObserve?.(step, observations)
  }

  state.messages.push(...actionTurn.messages)
  strategy.onStepEnd?.(step, { turn: actionTurn, state })

  // Check stop condition
  if (strategy.stopCondition?.(state)) break
  if (!actionTurn.response.hasToolCalls) break
}

return buildFinalTurn(state)
```

**MUST Requirements for react():**

1. MUST emit `onReason`, `onAct`, `onObserve` hooks at appropriate phases
2. MUST track reasoning in `state.reasoning` array
3. MUST respect `maxSteps` limit
4. MUST call `stopCondition` after each step
5. MUST return a valid UPP Turn

**SHOULD Requirements for react():**

1. SHOULD support custom reasoning prompts
2. SHOULD format observations consistently
3. SHOULD aggregate token usage across all steps

```pseudocode
import { agent } from "agents"
import { react } from "agents/execution"
import anthropic from "upp/anthropic"

researcher = agent({
  model: anthropic("claude-sonnet-4-20250514"),
  execution: react({ maxSteps: 15 }),
  tools: [WebSearch, Read, Summarize],
  system: "You are a research assistant. Think carefully before acting.",
  strategy: {
    onReason: (step, reasoning) => {
      print(`[Step ${step}] Reasoning: ${reasoning.substring(0, 100)}...`)
    },
    onAct: (step, actions) => {
      for (action in actions) {
        print(`[Step ${step}] Action: ${action.toolName}`)
      }
    },
  },
})
```

### 5.4 plan() Strategy

Plan-then-execute strategy with upfront planning phase.

```pseudocode
plan(options?: PlanOptions) -> ExecutionStrategy
```

**PlanOptions Structure:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxPlanSteps` | Integer | 10 | Maximum steps in a plan |
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

1. **Plan**: LLM generates structured plan with steps
2. **Execute**: Execute each plan step in order (respecting dependencies)
3. **Replan**: If a step fails and `allowReplan`, generate new plan

```pseudocode
// Planning phase
planTurn = await llm.generate(
  history,
  input,
  { structure: planSchema }
)
plan = planTurn.data.steps
state.plan = plan

// Execution phase
for step in topologicalSort(plan) {
  step.status = "in_progress"
  strategy.onStepStart?.(step.id, state)

  if (step.tool) {
    result = await executeTool(step.tool, step)
    if (result.isError && options.allowReplan) {
      // Generate new plan from current state
      plan = await replan(state, result.error)
      continue
    }
  }

  step.status = "completed"
  strategy.onStepEnd?.(step.id, result)
}
```

**MUST Requirements for plan():**

1. MUST produce structured plan via structured output
2. MUST respect step dependencies (topological order)
3. MUST track plan in `state.plan`
4. MUST update step status during execution
5. MUST return a valid UPP Turn

```pseudocode
import { agent } from "agents"
import { plan } from "agents/execution"
import anthropic from "upp/anthropic"

architect = agent({
  model: anthropic("claude-sonnet-4-20250514"),
  execution: plan({ maxPlanSteps: 10, allowReplan: true }),
  tools: [Read, Write, Bash, Test],
  system: "You are a software architect. Plan before implementing.",
})

turn = await architect.run("Refactor the authentication module")
```

### 5.5 Custom Strategies

Implementations MUST allow custom execution strategies:

```pseudocode
customStrategy: ExecutionStrategy = {
  name: "custom",

  execute: async (context) => {
    { agent, llm, input, history, strategy, state } = context

    strategy.onStepStart?.(1, state)

    // Custom execution logic
    turn = await llm.generate(history, input)
    state.messages.push(...turn.messages)

    strategy.onStepEnd?.(1, { turn, state })

    return turn  // Return standard UPP Turn
  },

  stream: (context) => {
    // Streaming implementation
    // Must return AgentStreamResult
  },
}

customAgent = agent({
  model: anthropic("claude-sonnet-4-20250514"),
  execution: customStrategy,
})
```

---

## 6. Sessions

### 6.1 Session Interface

Sessions wrap agents with persistent state and checkpoints.

```pseudocode
session(agent: Agent, options?: SessionOptions) -> Session
```

**SessionOptions Structure:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | String | (generated) | Session ID (UUIDv4) |
| `checkpoints` | Boolean | true | Enable automatic checkpoints |
| `checkpointInterval` | String | "step" | When to checkpoint: "step" or "turn" |
| `persistence` | PersistenceAdapter | (memory) | Storage adapter |
| `metadata` | Map | {} | Session metadata |

**Session Interface:**

| Property/Method | Type | Description |
|-----------------|------|-------------|
| `id` | String | Session ID (UUIDv4) |
| `agent` | Agent | The wrapped agent |
| `threadTree` | ThreadTree | The thread tree |
| `checkpoints` | List<Checkpoint> | All checkpoints |
| `currentCheckpoint` | Checkpoint? | Latest checkpoint |
| `run(input)` | Function | Run agent with session state |
| `stream(input)` | Function | Stream agent with session state |
| `fork(threadId)` | Function | Create branch from thread |
| `restore(checkpointId)` | Function | Restore to checkpoint |
| `save()` | Function | Explicitly save session |
| `toJSON()` | Function | Serialize session |

### 6.2 Session Usage

```pseudocode
import { agent, session } from "agents"
import anthropic from "upp/anthropic"

coder = agent({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: [Bash, Read, Write],
})

// Create session
sess = session(coder, {
  checkpoints: true,
  checkpointInterval: "step",
})

// Run with automatic state management
turn1 = await sess.run("Create a hello world program")
// Checkpoint automatically created after each step

turn2 = await sess.run("Add error handling")
// Another checkpoint created

// View checkpoints
print(sess.checkpoints.length)  // Multiple checkpoints

// Restore to earlier state
await sess.restore(sess.checkpoints[0].id)

// Continue from restored state (branches the thread tree)
turn3 = await sess.run("Add logging instead")
```

### 6.3 Session Persistence

```pseudocode
// Save session
json = sess.toJSON()
await storage.set(`session:${sess.id}`, json)

// Later: restore session
saved = await storage.get(`session:${sess.id}`)
restored = Session.fromJSON(saved, coder)

// Continue where we left off
turn = await restored.run("Continue from before")
```

### 6.4 Checkpoint Structure

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Checkpoint ID (UUIDv4) |
| `sessionId` | String | Parent session ID |
| `timestamp` | String | ISO 8601 timestamp |
| `step` | Integer | Step number at checkpoint |
| `threadId` | String | Active thread ID |
| `state` | ExecutionState | Serialized execution state |
| `subAgentStates` | Map | Sub-agent session states |
| `metadata` | Map | Checkpoint metadata |

### 6.5 MUST Requirements for Sessions

1. Sessions MUST serialize all state including sub-agent state
2. Sessions MUST preserve thread tree structure across serialization
3. Checkpoints MUST capture complete recoverable state
4. `restore()` MUST bring session to exact checkpoint state
5. `checkpointInterval: "step"` MUST checkpoint after every execution step
6. All session IDs MUST be UUIDv4
7. Timestamps MUST use ISO 8601 format

---

## 7. Thread Trees

### 7.1 Thread Tree Structure

UAP extends UPP's Thread with tree structure for branching conversations.

**ThreadTree Interface:**

| Property/Method | Type | Description |
|-----------------|------|-------------|
| `root` | ThreadNode | Root thread node |
| `current` | ThreadNode | Currently active thread node |
| `nodes` | Map<String, ThreadNode> | All nodes by ID |
| `branch(fromId, name?)` | Function | Create branch from node |
| `checkout(nodeId)` | Function | Switch active node |
| `merge(sourceId, targetId)` | Function | Merge threads |
| `history()` | Function | Get messages from root to current |
| `toJSON()` | Function | Serialize tree |

**ThreadNode Structure:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Node ID (UUIDv4) |
| `parentId` | String? | Parent node ID (null for root) |
| `thread` | Thread | UPP Thread instance |
| `name` | String? | Optional branch name |
| `metadata` | Map | Node metadata |
| `children` | List<String> | Child node IDs |

### 7.2 Thread Tree Usage

```pseudocode
import { ThreadTree } from "agents"

// Create thread tree
tree = new ThreadTree()

// Messages go to current node's thread
turn1 = await agent.run(tree.history(), "Create a web server")
tree.current.thread.append(turn1)

// Branch for alternative approach
altBranchId = tree.branch(tree.current.id, "alternative-framework")
tree.checkout(altBranchId)

// This continues from the branch point
turn2 = await agent.run(tree.history(), "Use Express instead")
tree.current.thread.append(turn2)

// Switch back to original branch
tree.checkout(tree.root.id)

// Continue original approach
turn3 = await agent.run(tree.history(), "Add middleware")
tree.current.thread.append(turn3)
```

### 7.3 History Traversal

The `history()` method returns all messages from root to current node:

```pseudocode
// Tree structure:
//   root -> A -> B (current)
//        -> C -> D

tree.checkout(B.id)
history = tree.history()
// Returns messages from: root, A, B

tree.checkout(D.id)
history = tree.history()
// Returns messages from: root, C, D
```

### 7.4 MUST Requirements for Thread Trees

1. Thread trees MUST use UPP Thread instances directly
2. `history()` MUST return messages in chronological order from root to current
3. All node IDs MUST be UUIDv4
4. `branch()` MUST create a new node with the specified parent
5. `checkout()` MUST switch the current node
6. Serialization MUST preserve complete tree structure

---

## 8. Sub-Agent Protocol

### 8.1 Sub-Agent as Tool

When an agent is added to another agent's tools, it MUST be converted to a UPP Tool:

```pseudocode
explorer = agent({
  model: anthropic("claude-haiku-4-20250514"),
  system: "You explore and analyze codebases.",
  tools: [Glob, Grep, Read],
})

// Automatic conversion when passed as tool
coder = agent({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: [
    Bash,
    Write,
    explorer,  // Automatically converted via toTool()
  ],
})
```

### 8.2 Tool Conversion

**toTool() Method:**

```pseudocode
agent.toTool(options?: ToToolOptions) -> Tool
```

**ToToolOptions Structure:**

| Field | Type | Description |
|-------|------|-------------|
| `name` | String? | Custom tool name (default: agent ID) |
| `description` | String? | Custom description |
| `parameterSchema` | JSONSchema? | Custom parameter schema |

**Generated Tool Structure:**

```pseudocode
{
  name: options.name ?? `agent_${agent.id}`,

  description: options.description ?? generateFromSystem(agent.system),

  parameters: options.parameterSchema ?? {
    type: "object",
    properties: {
      task: {
        type: "string",
        description: "The task for the sub-agent to perform"
      }
    },
    required: ["task"]
  },

  run: async (params) => {
    turn = await agent.run(params.task)
    return turn.response.text
  }
}
```

### 8.3 LLM Inheritance

Sub-agents inherit the parent's LLM configuration by default:

```pseudocode
// Sub-agent without explicit model - inherits from parent
helper = agent({
  // model not specified
  system: "You help with small tasks.",
  tools: [Read],
})

// Parent with explicit model
main = agent({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: [helper],  // helper will use claude-sonnet-4-20250514
})

// Sub-agent with explicit model - never inherits
researcher = agent({
  model: anthropic("claude-haiku-4-20250514"),  // Always uses haiku
  system: "You research topics.",
})
```

**MUST Requirements for LLM Inheritance:**

1. If sub-agent has explicit `model`, MUST use that model
2. If sub-agent has no `model`, MUST inherit from parent execution context
3. Inheritance MUST be resolved at execution time, not definition time
4. Inherited config (apiKey, baseUrl, etc.) MUST also flow from parent

### 8.4 Parent-Child Tracking

Sub-agent execution is tracked via the execution context:

```pseudocode
// When parent agent executes
parentContext = {
  agentId: parent.id,
  turnId: generateUUID(),
}

// When sub-agent executes (as tool)
subContext = {
  agentId: subAgent.id,
  turnId: generateUUID(),
  parentAgentId: parentContext.agentId,
  parentTurnId: parentContext.turnId,
}
```

This tracking enables:
- Debugging hierarchical agent calls
- Cost attribution per agent
- Serialization of complete execution tree

### 8.5 Concurrent Sub-Agent Execution

When the LLM requests multiple tool calls, sub-agents execute concurrently:

```pseudocode
// LLM returns:
// [
//   { toolName: "explorer", args: { task: "Find tests" } },
//   { toolName: "researcher", args: { task: "Research testing patterns" } }
// ]

// Both execute in parallel:
results = await Promise.all([
  explorer.run("Find tests"),
  researcher.run("Research testing patterns"),
])
```

Sub-agent tools MUST be safe for concurrent execution.

---

## 9. Communication

### 9.1 ask() - Multi-turn History

```pseudocode
ask(agent: Agent, input: String | Message, thread?: Thread) -> Promise<Turn>
```

`ask()` executes an agent and appends the result to the provided thread (or creates a new one):

```pseudocode
import { ask } from "agents"
import { Thread } from "upp"

thread = new Thread()

// First question
turn1 = await ask(explorer, "Find all TypeScript files", thread)
// turn1.messages appended to thread

// Follow-up (has context from turn1)
turn2 = await ask(explorer, "Which ones have errors?", thread)
// turn2.messages appended to thread

// Thread now contains full conversation
print(thread.messages.length)  // All messages from both turns
```

**MUST Requirements for ask():**

1. MUST append turn messages to the provided thread
2. MUST use thread history for context
3. MUST return standard UPP Turn
4. If no thread provided, MUST create a new Thread

### 9.2 query() - Reusable Branch

```pseudocode
query(agent: Agent, input: String | Message) -> Promise<QueryResult>
```

`query()` creates a separate conversation thread that can be continued later without affecting the main conversation:

```pseudocode
import { query } from "agents"

// Start a query - creates isolated thread
result = await query(researcher, "What are best practices for error handling?")

// Access the response
print(result.turn.response.text)

// Continue the query thread later
followup = await result.continue("What about async errors specifically?")
print(followup.turn.response.text)

// Can continue indefinitely
moreFollowup = await followup.continue("Show me examples")
```

**QueryResult Structure:**

| Field | Type | Description |
|-------|------|-------------|
| `turn` | Turn | The result turn |
| `threadId` | String | The query thread ID |
| `thread` | Thread | The query thread (for inspection) |
| `continue(input)` | Function | Continue this query thread |

**MUST Requirements for query():**

1. MUST create an isolated thread for the query
2. MUST NOT affect the caller's conversation state
3. `continue()` MUST use the query thread's history
4. MUST return QueryResult with continuation capability
5. Query threads MUST be serializable within sessions

### 9.3 Comparison

| Aspect | ask() | query() |
|--------|-------|---------|
| History | Appends to provided thread | Creates isolated thread |
| Context | Shares caller's context | Independent context |
| Continuation | Via same thread | Via `continue()` method |
| Use Case | Multi-turn in main flow | Side conversations, research |

```pseudocode
// ask() - part of main conversation
mainThread = new Thread()
await ask(coder, "Create a function", mainThread)
await ask(coder, "Add tests for it", mainThread)  // Has context

// query() - isolated research
result = await query(researcher, "What testing framework is best?")
await result.continue("Compare Jest and Vitest")  // Continues query
// mainThread is not affected
```

---

## 10. Middleware

### 10.1 Middleware Interface

```pseudocode
interface Middleware {
  name: String
  before?(context: MiddlewareContext) -> Promise<MiddlewareContext | void>
  after?(context: MiddlewareContext, result: Turn) -> Promise<Turn>
  onError?(context: MiddlewareContext, error: Error) -> Promise<Turn | void>
}
```

**MiddlewareContext Structure:**

| Field | Type | Description |
|-------|------|-------------|
| `agent` | Agent | The agent |
| `input` | Message | User input |
| `history` | List<Message> | Conversation history |
| `metadata` | Map | Request metadata (mutable) |
| `session` | Session? | Session if executing within one |

### 10.2 Middleware Composition

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

This "onion" pattern allows outer middleware to wrap inner middleware behavior.

### 10.3 logging() Middleware (v1)

The only required middleware for v1:

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

**Logged Events:**

- Agent execution start (input, agent ID)
- Step start/end (for multi-step strategies)
- Tool calls (tool name, arguments)
- Agent execution end (output summary, timing, token usage)
- Errors (error details, stack trace at debug level)

```pseudocode
import { agent } from "agents"
import { logging } from "agents/middleware"
import anthropic from "upp/anthropic"

coder = agent({
  model: anthropic("claude-sonnet-4-20250514"),
  middleware: [
    logging({
      level: "debug",
      includeTiming: true,
    }),
  ],
})

await coder.run("Hello")
// Logs:
// [INFO] Agent abc-123 starting execution
// [DEBUG] Input: "Hello"
// [INFO] Agent abc-123 completed in 1.2s (150 tokens)
```

### 10.4 Future Middleware (Post-v1)

The following middleware are specified but not required for v1:

**guardrails() - Content Safety**

```pseudocode
guardrails(options?: GuardrailsOptions) -> Middleware
```

Filters input/output for safety. Can reject requests or transform responses.

**memory() - Context Management**

```pseudocode
memory(options?: MemoryOptions) -> Middleware
```

Manages context window via summarization, retrieval, or truncation.

**budget() - Resource Limits**

```pseudocode
budget(options: BudgetOptions) -> Middleware
```

Enforces token limits, step limits, or time limits.

### 10.5 Custom Middleware

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

  onError: async (context, error) => {
    duration = Date.now() - context.metadata.startTime
    print(`Failed after ${duration}ms: ${error.message}`)
    // Return undefined to propagate error
    // Return Turn to recover
  },
}
```

### 10.6 MUST Requirements for Middleware

1. `before` hooks MUST execute in array order
2. `after` hooks MUST execute in reverse array order
3. `onError` hooks MUST execute in reverse array order
4. Middleware MUST NOT modify Turn types (use UPP Turn as-is)
5. `before` returning modified context MUST pass modifications downstream
6. `after` MUST return a valid UPP Turn

---

## 11. Agent Strategy Hooks

### 11.1 AgentStrategy Structure

| Field | Type | Description |
|-------|------|-------------|
| `stopCondition` | Function | Evaluate if execution should stop |
| `onStepStart` | Function | Called when step begins |
| `onReason` | Function | Called during reasoning phase (ReAct) |
| `onAct` | Function | Called during action phase (ReAct) |
| `onObserve` | Function | Called during observation phase (ReAct) |
| `onStepEnd` | Function | Called when step completes |
| `onComplete` | Function | Called when execution completes |
| `onError` | Function | Called on execution error |

### 11.2 Hook Signatures

```pseudocode
interface AgentStrategy {
  // Stop condition - checked after each step
  stopCondition?: (state: ExecutionState) -> Boolean | Promise<Boolean>

  // Step lifecycle
  onStepStart?: (step: Integer, state: ExecutionState) -> void
  onStepEnd?: (step: Integer, result: StepResult) -> void

  // ReAct phases (only called by react() strategy)
  onReason?: (step: Integer, reasoning: String) -> void
  onAct?: (step: Integer, actions: List<ToolCall>) -> void
  onObserve?: (step: Integer, observations: List<ToolResult>) -> void

  // Completion
  onComplete?: (turn: Turn) -> void

  // Error handling
  onError?: (error: Error, state: ExecutionState) -> void | Turn
}
```

**StepResult Structure:**

| Field | Type | Description |
|-------|------|-------------|
| `turn` | Turn | The turn from this step |
| `state` | ExecutionState | Current execution state |

### 11.3 Stop Conditions

The `stopCondition` hook evaluates after each step to determine if execution should stop early:

```pseudocode
agent({
  model: anthropic("claude-sonnet-4-20250514"),
  execution: react({ maxSteps: 50 }),
  strategy: {
    stopCondition: (state) => {
      // Stop if task marked complete in metadata
      if (state.metadata.taskComplete) return true

      // Stop if specific output detected
      if (state.messages.some(m =>
        m.type === "assistant" &&
        m.content.some(c => c.text?.includes("TASK COMPLETE"))
      )) return true

      // Stop if too many tokens used
      if (state.metadata.totalTokens > 10000) return true

      return false
    },
  },
})
```

### 11.4 Hook Execution Order

For a single step in react() strategy:

```
onStepStart(step, state)
  │
  ├─> onReason(step, reasoning)
  │
  ├─> onAct(step, toolCalls)
  │
  ├─> onObserve(step, results)
  │
  v
onStepEnd(step, { turn, state })
  │
  ├─> stopCondition(state) -> if true, stop
  │
  v
[next step or completion]
  │
  v
onComplete(finalTurn)
```

### 11.5 Error Handling Hook

The `onError` hook can recover from errors:

```pseudocode
strategy: {
  onError: (error, state) => {
    if (error.code === "RATE_LIMITED") {
      // Log and let it propagate
      console.error("Rate limited, will retry via UPP retry strategy")
      return  // undefined = propagate error
    }

    if (error.code === "CONTEXT_LENGTH_EXCEEDED") {
      // Could return a Turn to gracefully complete
      return createSummaryTurn(state, "Context limit reached")
    }

    // Other errors propagate
    throw error
  },
}
```

### 11.6 MUST Requirements for Hooks

1. Hooks MUST be called in the documented order
2. `stopCondition` MUST be evaluated after every step
3. `onError` returning Turn MUST cause graceful completion
4. `onError` returning undefined/void MUST propagate the error
5. Async hooks MUST be awaited before proceeding

---

## 12. Streaming

### 12.1 AgentStreamResult Interface

```pseudocode
interface AgentStreamResult {
  [Symbol.asyncIterator](): AsyncIterator<AgentStreamEvent>
  turn: Promise<Turn>  // Resolves after stream completes
  abort(): void        // Cancel the stream
}
```

### 12.2 AgentStreamEvent Structure

UAP streaming provides both UAP-level events and UPP-level events via a discriminated union:

```pseudocode
interface AgentStreamEvent {
  source: "uap" | "upp"  // Discriminator for filtering

  // Present when source === "uap"
  uap?: {
    type: UAPEventType
    step: Integer
    agentId: String
    data: Map
  }

  // Present when source === "upp"
  upp?: StreamEvent  // Original UPP StreamEvent, unchanged
}
```

**UAPEventType Values:**

| Type | Description | Data |
|------|-------------|------|
| `step_start` | Step beginning | `{ stepNumber: Integer }` |
| `step_end` | Step completed | `{ stepNumber: Integer, usage: TokenUsage }` |
| `reasoning` | Reasoning output (ReAct) | `{ text: String }` |
| `action` | Action taken | `{ toolCalls: List<ToolCall> }` |
| `observation` | Observation received | `{ results: List<ToolResult> }` |
| `checkpoint` | Checkpoint created | `{ checkpointId: String }` |

### 12.3 Streaming Usage

```pseudocode
stream = coder.stream("Implement a feature")

for await (event of stream) {
  if (event.source === "uap") {
    // UAP step-level events
    switch (event.uap.type) {
      case "step_start":
        print(`Starting step ${event.uap.step}`)
        break
      case "reasoning":
        print(`Reasoning: ${event.uap.data.text}`)
        break
      case "action":
        for (call of event.uap.data.toolCalls) {
          print(`Calling: ${call.toolName}`)
        }
        break
      case "step_end":
        print(`Step ${event.uap.step} complete`)
        break
    }
  } else {
    // UPP LLM-level events (passthrough)
    switch (event.upp.type) {
      case "text_delta":
        process.stdout.write(event.upp.delta.text ?? "")
        break
      case "tool_call_delta":
        // Tool call streaming
        break
    }
  }
}

// Get final turn after stream completes
turn = await stream.turn
print(`Total tokens: ${turn.usage.totalTokens}`)
```

### 12.4 Filtering Events

```pseudocode
// Only UAP events
for await (event of stream) {
  if (event.source === "uap") {
    handleUAPEvent(event.uap)
  }
}

// Only UPP text deltas
for await (event of stream) {
  if (event.source === "upp" && event.upp.type === "text_delta") {
    process.stdout.write(event.upp.delta.text ?? "")
  }
}

// Both with different handling
for await (event of stream) {
  if (event.source === "uap") {
    logToPanel(event.uap)
  } else {
    renderToTerminal(event.upp)
  }
}
```

### 12.5 MUST Requirements for Streaming

1. MUST emit UPP events unchanged with `source: "upp"`
2. MUST emit UAP events with `source: "uap"`
3. Events MUST be emitted in chronological order
4. `turn` promise MUST resolve to valid UPP Turn after completion
5. `abort()` MUST cancel the stream and resolve `turn` with partial results
6. UAP events MUST include `step` and `agentId`

---

## 13. Serialization

### 13.1 Session Serialization

**SessionJSON Structure:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | String | Yes | UAP version (e.g., "1.0.0") |
| `id` | String | Yes | Session ID (UUIDv4) |
| `agentId` | String | Yes | Agent ID |
| `createdAt` | String | Yes | ISO 8601 timestamp |
| `updatedAt` | String | Yes | ISO 8601 timestamp |
| `threadTree` | ThreadTreeJSON | Yes | Serialized thread tree |
| `checkpoints` | List<CheckpointJSON> | Yes | All checkpoints |
| `metadata` | Map | No | Session metadata |

### 13.2 Thread Tree Serialization

**ThreadTreeJSON Structure:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `rootId` | String | Yes | Root node ID |
| `currentId` | String | Yes | Current active node ID |
| `nodes` | List<ThreadNodeJSON> | Yes | All nodes |

**ThreadNodeJSON Structure:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | String | Yes | Node ID (UUIDv4) |
| `parentId` | String? | No | Parent node ID (null for root) |
| `name` | String? | No | Branch name |
| `thread` | ThreadJSON | Yes | UPP Thread serialization |
| `children` | List<String> | Yes | Child node IDs |
| `metadata` | Map | No | Node metadata |

### 13.3 Checkpoint Serialization

**CheckpointJSON Structure:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | String | Yes | Checkpoint ID (UUIDv4) |
| `sessionId` | String | Yes | Parent session ID |
| `timestamp` | String | Yes | ISO 8601 timestamp |
| `step` | Integer | Yes | Step number at checkpoint |
| `threadId` | String | Yes | Active thread node ID |
| `state` | ExecutionStateJSON | Yes | Execution state |
| `subAgentStates` | Map<String, SessionJSON> | No | Sub-agent session states |
| `metadata` | Map | No | Checkpoint metadata |

### 13.4 Execution State Serialization

**ExecutionStateJSON Structure:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `step` | Integer | Yes | Current step number |
| `messages` | List<MessageJSON> | Yes | UPP Message serialization |
| `metadata` | Map | Yes | User-defined metadata |
| `reasoning` | List<String>? | No | Reasoning traces (ReAct) |
| `plan` | List<PlanStepJSON>? | No | Execution plan (Plan strategy) |

**PlanStepJSON Structure:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | String | Yes | Step ID |
| `description` | String | Yes | Step description |
| `tool` | String? | No | Tool to use |
| `dependsOn` | List<String> | Yes | Dependency step IDs |
| `status` | String | Yes | "pending" \| "in_progress" \| "completed" \| "failed" |

### 13.5 Example Serialized Session

```json
{
  "version": "1.0.0",
  "id": "sess_abc123",
  "agentId": "agent_xyz789",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:35:00.000Z",
  "threadTree": {
    "rootId": "node_root",
    "currentId": "node_branch1",
    "nodes": [
      {
        "id": "node_root",
        "parentId": null,
        "name": "main",
        "thread": {
          "id": "thread_001",
          "messages": [...]
        },
        "children": ["node_branch1"],
        "metadata": {}
      },
      {
        "id": "node_branch1",
        "parentId": "node_root",
        "name": "alternative",
        "thread": {
          "id": "thread_002",
          "messages": [...]
        },
        "children": [],
        "metadata": {}
      }
    ]
  },
  "checkpoints": [
    {
      "id": "cp_001",
      "sessionId": "sess_abc123",
      "timestamp": "2024-01-15T10:32:00.000Z",
      "step": 3,
      "threadId": "node_root",
      "state": {
        "step": 3,
        "messages": [...],
        "metadata": { "taskComplete": false },
        "reasoning": ["First, I need to...", "Now I should..."]
      },
      "subAgentStates": {},
      "metadata": {}
    }
  ],
  "metadata": {
    "task": "Implement feature X"
  }
}
```

### 13.6 MUST Requirements for Serialization

1. All IDs MUST be preserved exactly during round-trip
2. Message metadata MUST be preserved (including provider namespaces)
3. Thread tree structure MUST be fully recoverable
4. Sub-agent session states MUST be included in checkpoint serialization
5. `Session.fromJSON()` MUST return a session that behaves identically to the original
6. Timestamps MUST use ISO 8601 format with timezone
7. Binary data (images, audio) MUST be base64 encoded
8. Version field MUST be checked during deserialization

---

## 14. Data Type Definitions

### 14.1 Types from UPP-1.2 (Used Directly)

The following types are imported from `@providerprotocol/ai` and used without modification:

**Core:**
- `llm`, `LLMInstance`, `LLMOptions`
- `ProviderConfig`, `ModelReference`

**Messages:**
- `Message`, `UserMessage`, `AssistantMessage`, `ToolResultMessage`
- `ContentBlock`, `TextBlock`, `ImageBlock`

**Turns:**
- `Turn`, `TokenUsage`

**Tools:**
- `Tool`, `ToolCall`, `ToolResult`, `ToolExecution`
- `ToolUseStrategy`

**Streaming:**
- `StreamResult`, `StreamEvent`, `StreamEventType`

**Errors:**
- `UPPError`, `ErrorCode`

**Utilities:**
- `Thread`, `ThreadJSON`

### 14.2 UAP-Specific Types

**Agent Types:**

```pseudocode
interface AgentOptions {
  model: ModelReference           // Required
  params?: Map
  config?: ProviderConfig
  execution?: ExecutionStrategy   // Default: loop()
  tools?: List<Tool | Agent>
  system?: String
  structure?: JSONSchema
  middleware?: List<Middleware>
  strategy?: AgentStrategy
}

interface Agent {
  id: String                      // UUIDv4
  model: ModelReference
  tools: List<Tool | Agent>
  system?: String
  run(input): Promise<Turn>
  run(history, input): Promise<Turn>
  stream(input): AgentStreamResult
  stream(history, input): AgentStreamResult
  toTool(options?): Tool
}

interface ToToolOptions {
  name?: String
  description?: String
  parameterSchema?: JSONSchema
}
```

**Execution Types:**

```pseudocode
interface ExecutionStrategy {
  name: String
  execute(context: ExecutionContext): Promise<Turn>
  stream(context: ExecutionContext): AgentStreamResult
}

interface ExecutionContext {
  agent: Agent
  llm: LLMInstance
  input: Message
  history: List<Message>
  tools: List<Tool>
  strategy: AgentStrategy
  signal?: AbortSignal
  state: ExecutionState
}

interface ExecutionState {
  step: Integer
  messages: List<Message>
  metadata: Map
  reasoning?: List<String>
  plan?: List<PlanStep>
}

interface LoopOptions {
  maxIterations?: Integer         // Default: 10
}

interface ReactOptions {
  maxSteps?: Integer              // Default: 10
  reasoningPrompt?: String
  observationFormat?: String      // Default: "markdown"
}

interface PlanOptions {
  maxPlanSteps?: Integer          // Default: 10
  allowReplan?: Boolean           // Default: true
  planSchema?: JSONSchema
}

interface PlanStep {
  id: String
  description: String
  tool?: String
  dependsOn: List<String>
  status: "pending" | "in_progress" | "completed" | "failed"
}

interface StepResult {
  turn: Turn
  state: ExecutionState
}
```

**Session Types:**

```pseudocode
interface SessionOptions {
  id?: String                     // Default: generated UUIDv4
  checkpoints?: Boolean           // Default: true
  checkpointInterval?: String     // Default: "step"
  persistence?: PersistenceAdapter
  metadata?: Map
}

interface Session {
  id: String
  agent: Agent
  threadTree: ThreadTree
  checkpoints: List<Checkpoint>
  currentCheckpoint?: Checkpoint
  run(input): Promise<Turn>
  stream(input): AgentStreamResult
  fork(threadId): String
  restore(checkpointId): Promise<void>
  save(): Promise<void>
  toJSON(): SessionJSON
}

interface Checkpoint {
  id: String
  sessionId: String
  timestamp: String
  step: Integer
  threadId: String
  state: ExecutionState
  subAgentStates: Map<String, Session>
  metadata: Map
}

interface PersistenceAdapter {
  save(key: String, data: String): Promise<void>
  load(key: String): Promise<String?>
  delete(key: String): Promise<void>
}
```

**Thread Tree Types:**

```pseudocode
interface ThreadTree {
  root: ThreadNode
  current: ThreadNode
  nodes: Map<String, ThreadNode>
  branch(fromId: String, name?: String): String
  checkout(nodeId: String): void
  merge(sourceId: String, targetId: String): void
  history(): List<Message>
  toJSON(): ThreadTreeJSON
}

interface ThreadNode {
  id: String
  parentId?: String
  thread: Thread                  // UPP Thread
  name?: String
  metadata: Map
  children: List<String>
}

interface QueryResult {
  turn: Turn
  threadId: String
  thread: Thread
  continue(input: String | Message): Promise<QueryResult>
}
```

**Middleware Types:**

```pseudocode
interface Middleware {
  name: String
  before?(context: MiddlewareContext): Promise<MiddlewareContext | void>
  after?(context: MiddlewareContext, result: Turn): Promise<Turn>
  onError?(context: MiddlewareContext, error: Error): Promise<Turn | void>
}

interface MiddlewareContext {
  agent: Agent
  input: Message
  history: List<Message>
  metadata: Map
  session?: Session
}

interface LoggingOptions {
  level?: String                  // Default: "info"
  logger?: Function
  includeMessages?: Boolean       // Default: false
  includeTiming?: Boolean         // Default: true
}
```

**Strategy Types:**

```pseudocode
interface AgentStrategy {
  stopCondition?: (state: ExecutionState) -> Boolean | Promise<Boolean>
  onStepStart?: (step: Integer, state: ExecutionState) -> void
  onReason?: (step: Integer, reasoning: String) -> void
  onAct?: (step: Integer, actions: List<ToolCall>) -> void
  onObserve?: (step: Integer, observations: List<ToolResult>) -> void
  onStepEnd?: (step: Integer, result: StepResult) -> void
  onComplete?: (turn: Turn) -> void
  onError?: (error: Error, state: ExecutionState) -> void | Turn
}
```

**Streaming Types:**

```pseudocode
interface AgentStreamResult {
  [Symbol.asyncIterator](): AsyncIterator<AgentStreamEvent>
  turn: Promise<Turn>
  abort(): void
}

interface AgentStreamEvent {
  source: "uap" | "upp"
  uap?: UAPEvent
  upp?: StreamEvent               // UPP StreamEvent
}

interface UAPEvent {
  type: UAPEventType
  step: Integer
  agentId: String
  data: Map
}

type UAPEventType =
  | "step_start"
  | "step_end"
  | "reasoning"
  | "action"
  | "observation"
  | "checkpoint"
```

### 14.3 Complete Export List

UAP implementations MUST export:

**Entry Points:**
- `agent`
- `session`
- `ask`
- `query`

**Execution Strategies (from agents/execution):**
- `loop`
- `react`
- `plan`

**Middleware (from agents/middleware):**
- `logging`

**Classes:**
- `ThreadTree`
- `ThreadNode`
- `Session`
- `Checkpoint`

**Type Exports (TypeScript):**
- All interfaces defined in section 14.2

---

## 15. Conformance

### 15.1 Conformance Levels

**Level 1: Core Agent (Required)**
- `agent()` function with model binding
- Basic `run()` and `stream()` methods
- Tool execution via UPP
- `loop()` execution strategy
- Returns standard UPP Turn

**Level 2: Sessions (Required)**
- `session()` function
- Checkpoint creation (automatic per-step)
- Checkpoint restoration via `restore()`
- `toJSON()` and `fromJSON()` serialization

**Level 3: Thread Trees (Required)**
- `ThreadTree` implementation
- Branching via `branch()`
- Checkout via `checkout()`
- `history()` traversal

**Level 4: Communication (Required)**
- `ask()` function with thread integration
- `query()` function with continuation
- `QueryResult.continue()` method

**Level 5: Advanced Execution (Required)**
- `react()` strategy with reasoning phases
- `plan()` strategy with structured plans
- Custom strategy support via ExecutionStrategy interface

**Level 6: Middleware (Required)**
- Middleware pipeline (ordered array)
- `logging()` middleware implementation
- Custom middleware support

### 15.2 MUST Requirements Summary

1. **Type Uniformity:** MUST use UPP-1.2 types directly without wrapping
2. **No Re-exports:** MUST NOT re-export UPP types
3. **Identity:** All IDs MUST be UUIDv4
4. **Serialization:** Session serialization MUST be fully recoverable
5. **Sub-agents:** MUST track parent-child relationships in context
6. **Middleware:** MUST execute in specified order (forward for before, reverse for after)
7. **Strategies:** MUST respect stop conditions after each step
8. **Streaming:** MUST emit both UAP and UPP events with source discriminator
9. **Checkpoints:** MUST capture complete state including sub-agent state

### 15.3 SHOULD Requirements Summary

1. Implementations SHOULD support all standard execution strategies
2. Implementations SHOULD support concurrent tool execution
3. Implementations SHOULD support LLM inheritance for sub-agents
4. `logging()` SHOULD support configurable log levels
5. Strategies SHOULD aggregate token usage across steps

### 15.4 MAY Requirements

1. Implementations MAY provide additional execution strategies
2. Implementations MAY provide additional middleware
3. Implementations MAY provide persistence adapters for various backends
4. Implementations MAY support strategy-specific optimizations

---

## 16. Security Considerations

### 16.1 Sub-Agent Execution

- Sub-agents execute with parent's permissions unless explicitly restricted
- Tool approval handlers from UPP MUST be respected for sub-agent tools
- Nested sub-agent calls can amplify permissions - implement depth limits
- Stop conditions prevent unbounded execution loops

### 16.2 Serialization Security

- Serialized sessions may contain sensitive conversation data
- Checkpoint data SHOULD be encrypted at rest in production
- Deserialization MUST validate structure before hydrating
- Untrusted serialized data SHOULD NOT be deserialized

### 16.3 Middleware Security

- Middleware has full access to conversation content
- `logging()` middleware may expose sensitive data - configure carefully
- Guardrails middleware (post-v1) SHOULD be first in pipeline
- Budget middleware prevents resource exhaustion attacks

### 16.4 Tool Execution Security

All UPP-1.2 tool security considerations apply. Additionally:

- Sub-agents as tools have full tool capabilities
- Nested sub-agent calls can create permission escalation paths
- Stop conditions and max step limits prevent runaway execution
- Parallel tool execution requires thread-safe tool implementations

### 16.5 Context Injection

- User input flows through execution strategies to LLM
- Middleware can modify context before LLM calls
- System prompts SHOULD be protected from user modification
- Tool results flow back through the same pipeline

---

## Appendix A: Example Implementation

### A.1 Complete Agent Example

```pseudocode
import { agent, session, ask, query } from "agents"
import { react } from "agents/execution"
import { logging } from "agents/middleware"
import { Thread } from "upp"
import anthropic from "upp/anthropic"

// Define sub-agents
explorer = agent({
  model: anthropic("claude-haiku-4-20250514"),
  system: "You explore codebases and report findings concisely.",
  tools: [Glob, Grep, Read],
})

// Define main agent with sub-agent as tool
coder = agent({
  model: anthropic("claude-sonnet-4-20250514"),
  params: { max_tokens: 4096 },
  execution: react({ maxSteps: 20 }),
  tools: [
    Bash,
    Read,
    Write,
    explorer,  // Sub-agent as tool
  ],
  system: `You are an expert software engineer.
Use the explorer tool to understand code structure before making changes.
Think step by step and explain your reasoning.`,
  middleware: [
    logging({ level: "info", includeTiming: true }),
  ],
  strategy: {
    stopCondition: (state) => state.metadata.taskComplete === true,
    onStepStart: (step, state) => {
      print(`--- Step ${step} ---`)
    },
    onReason: (step, reasoning) => {
      print(`Reasoning: ${reasoning.substring(0, 200)}...`)
    },
    onAct: (step, actions) => {
      for (action of actions) {
        print(`Action: ${action.toolName}`)
      }
    },
    onStepEnd: (step, result) => {
      print(`Step ${step} used ${result.turn.usage.totalTokens} tokens`)
    },
    onComplete: (turn) => {
      print(`Completed in ${turn.cycles} cycles`)
    },
  },
})

// Create session for persistence
sess = session(coder, {
  checkpoints: true,
  checkpointInterval: "step",
})

// Run task
turn = await sess.run("Find all TODO comments and create issues for them")

// Save session for later
json = sess.toJSON()
await storage.save(`session:${sess.id}`, json)

// Later: restore and continue
saved = await storage.load(`session:${sess.id}`)
restored = Session.fromJSON(saved, coder)
turn2 = await restored.run("Now prioritize those issues")
```

### A.2 Query Pattern Example

```pseudocode
import { agent, query } from "agents"
import anthropic from "upp/anthropic"

researcher = agent({
  model: anthropic("claude-sonnet-4-20250514"),
  system: "You are a technical researcher. Provide detailed, accurate information.",
})

// Start a research query
result = await query(researcher, "What are the best practices for error handling in TypeScript?")
print(result.turn.response.text)

// Continue the query thread
followup1 = await result.continue("How does this apply to async/await?")
print(followup1.turn.response.text)

// Continue further
followup2 = await followup1.continue("Show me examples with try-catch-finally")
print(followup2.turn.response.text)

// The main conversation is unaffected
// Each query/continue builds on previous context in isolated thread
```

### A.3 Streaming Example

```pseudocode
import { agent } from "agents"
import { react } from "agents/execution"
import anthropic from "upp/anthropic"

coder = agent({
  model: anthropic("claude-sonnet-4-20250514"),
  execution: react({ maxSteps: 10 }),
  tools: [Read, Write],
})

stream = coder.stream("Implement a simple HTTP server")

// Process events as they arrive
for await (event of stream) {
  if (event.source === "uap") {
    // Agent-level events
    switch (event.uap.type) {
      case "step_start":
        print(`\n=== Step ${event.uap.step} ===\n`)
        break
      case "reasoning":
        print(`[Thinking] ${event.uap.data.text}\n`)
        break
      case "action":
        for (call of event.uap.data.toolCalls) {
          print(`[Action] ${call.toolName}(${JSON.stringify(call.arguments)})\n`)
        }
        break
      case "observation":
        print(`[Result] ${event.uap.data.results.length} results\n`)
        break
      case "step_end":
        print(`[Tokens] ${event.uap.data.usage.totalTokens}\n`)
        break
    }
  } else {
    // LLM-level events (text streaming)
    if (event.upp.type === "text_delta") {
      process.stdout.write(event.upp.delta.text ?? "")
    }
  }
}

// Get final result
turn = await stream.turn
print(`\n\nFinal response: ${turn.response.text}`)
print(`Total tokens: ${turn.usage.totalTokens}`)
```

---

## Appendix B: Migration from Raw UPP

### B.1 Before: Raw UPP Code

```pseudocode
import { llm, Thread, Tool } from "upp"
import anthropic from "upp/anthropic"

model = llm({
  model: anthropic("claude-sonnet-4-20250514"),
  system: "You are a coding assistant.",
  tools: [Read, Write, Bash],
  toolStrategy: { maxIterations: 10 },
})

thread = new Thread()

// Manual loop for multi-step tasks
while (true) {
  turn = await model.generate(thread.messages, userInput)
  thread.append(turn)

  if (!turn.response.hasToolCalls) break
  if (thread.messages.length > 100) break

  // Manual stop condition checking
  if (turn.response.text.includes("DONE")) break
}
```

### B.2 After: UAP Agent

```pseudocode
import { agent, session } from "agents"
import { react } from "agents/execution"
import { logging } from "agents/middleware"
import anthropic from "upp/anthropic"

coder = agent({
  model: anthropic("claude-sonnet-4-20250514"),
  execution: react({ maxSteps: 50 }),
  tools: [Read, Write, Bash],
  system: "You are a coding assistant.",
  middleware: [logging()],
  strategy: {
    stopCondition: (state) => {
      if (state.messages.length > 100) return true
      return state.messages.some(m =>
        m.type === "assistant" &&
        m.content.some(c => c.text?.includes("DONE"))
      )
    },
  },
})

sess = session(coder)
turn = await sess.run(userInput)
// Automatic checkpointing, logging, stop conditions
// Can restore later with sess.restore()
```

---

## Appendix C: Glossary

| Term | Definition |
|------|------------|
| **Agent** | An AI entity combining model, tools, execution strategy, and middleware |
| **Checkpoint** | A serialized snapshot of session state for recovery |
| **Execution Strategy** | Algorithm for running agent steps (loop, react, plan) |
| **Middleware** | Composable functions wrapping agent execution |
| **QueryResult** | Result of `query()` with continuation capability |
| **Session** | Stateful wrapper with persistence and checkpoints |
| **Step** | One cycle of an execution strategy |
| **Sub-Agent** | An agent used as a tool by another agent |
| **Thread Tree** | Tree-structured conversation branches |
| **Turn** | UPP Turn - complete result of one LLM inference |
| **UAP** | Unified Agent Protocol (this specification) |
| **UPP** | Unified Provider Protocol (@providerprotocol/ai) |

---

*End of UAP-1.0 Specification*
