# CORA Harness (`@cora/cora-base`)

Collaborative Reasoning Agents as a **dsh profile layer**: a group of specialists solves one mathematics or physics problem by debate, and the coordinator agent consolidates their final solutions.

This is an out-of-tree bundle, not a fork. It adds one plugin row over `@deepseek-ai/dsh-base` and reuses the harness for everything else — session log, subagents, tools, LLM adapters, telemetry, UI.

## Status

Proof of concept. Three roles, round-robin refinement, token-overlap convergence metrics. See [Known Limitations and Deferred Work](#known-limitations-and-deferred-work).

## How it maps onto the harness

| CORA concept | Harness mechanism |
|---|---|
| specialist agent with its own system prompt | one-shot child on `ctx.subagents` with a per-child `persona` |
| per-specialist model diversity | `agentOptions.provider` / `agentOptions.model` on each role |
| shared debate history | each child's own session log; the coordinator sees the canonical tool result |
| GroupChatManager | the `cora-debate` round driver |
| consensus `C_r` / oscillation `O_r` | `consensus()` / `oscillation()` measured per round |
| stopping criteria | `convergence` config: `consensusThreshold`, `stabilityThreshold`, `maxRounds` |
| cost accounting | the harness token meter and session telemetry, unchanged |

## The debate

Round 1 asks every role to solve the problem independently. Each later round hands a role its own previous solution plus every peer solution, and asks it to review them and restate its complete solution. Roles within a round run concurrently; rounds are sequential.

After each round the driver measures:

- **consensus** — mean pairwise Jaccard similarity over case-folded word and number tokens of the round's solutions.
- **oscillation** — mean distance between each role's consecutive solutions; absent in round 1.

It stops on `consensus` (agreement reached), `stability` (the roles stopped moving), `max-rounds`, or `role-failed` (a child ended without a usable solution).

## Configuration

| Key | Meaning |
|---|---|
| `provider` | the `ctx.subagents` provider role turns start on; it must support per-child personas (`spawn` in `dsh-base`) |
| `roles[]` | `name`, `persona`, and optional `provider` / `model` per specialist; at least two, with distinct names |
| `convergence` | `maxRounds`, `consensusThreshold`, `stabilityThreshold` |
| `toolName` | model-facing name, default `cora_debate` |

## Model Experience

The coordinator sees one tool, `cora_debate`, taking a single `problem` string. Its result is the canonical record of every round: each role's full solution text, the child session id holding that role's reasoning, and the round's agreement and change measurements. The rendered text states why the debate ended, one line per round with its measurements, and the final round's solutions under role headings.

Token cost scales with roles × rounds: each role turn is a complete child agent request, and every refinement turn carries the previous round's full solutions. The default roster (3 roles, 3 rounds) is up to 9 child turns. Nothing is added to the coordinator's own KV-cache prefix — only the tool schema and the results it requests.

## Installing the profile

```sh
# 1. Build/install dsh, then create the profile directory
mkdir -p "$DSH_HOME/profiles/cora"
cp profile/package.json profile/cordis.patch.yml "$DSH_HOME/profiles/cora/"

# 2. Point the profile at this package (published, or a local path during development)
cd "$DSH_HOME/profiles/cora" && pnpm install

# 3. Run it
dsh --profile cora "A block slides down a 30 degree incline with mu = 0.2. Find its acceleration."
```

## Development

```sh
../node_modules/.bin/vitest run          # unit tests for the driver and metrics
../node_modules/.bin/tsc -p tsconfig.json  # typecheck against the harness sources
```

Both resolve `@deepseek-ai/*` through the checkout's `tsconfig.base.json` path facade, so the bundle is developed against harness source and shipped against harness packages.

## Known Limitations and Deferred Work

- **Similarity is lexical.** Token overlap cannot tell `v = 2 m/s` from a differently worded but equivalent derivation, so `consensus` is a coarse proxy. A symbolic or embedding comparison belongs behind the same two functions.
- **No real-composition test.** The driver and metrics have unit coverage; the tool is not yet booted through the Loader over a test `cordis.yml`, which is what the harness requires of a product-visible plugin.
- **Per-role temperature is unavailable.** `AgentOptions` carries `provider`, `model`, and `maxTokens`; diversity currently comes from personas and model choice, not sampling parameters.
- **No debate events in the session log.** Rounds are reconstructable from the tool result and each child's session, but the coordinator's log holds no per-round event of its own, so a UI cannot follow a debate live.
- **Roles are fixed for the deployment.** The roster comes from configuration; there is no per-problem role selection, no hierarchical sub-debate, and no human intervention point mid-debate.
